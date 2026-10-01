import { exists, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  listSessions as sdkListSessions,
  type ListSessionsOptions,
  type SDKSessionInfo,
} from '@anthropic-ai/claude-agent-sdk';
import z from 'zod';

export const SessionUuidSchema = z
  .uuid()
  .meta({ id: 'SessionUuid', description: 'Full session UUID, usable with claude --resume' });
export type SessionUuid = z.infer<typeof SessionUuidSchema>;

/** The `<project>` segment under `${CLAUDE_CONFIG_DIR}/projects/`. */
export const ProjectKeySchema = z.string().startsWith('-');
export type ProjectKey = z.infer<typeof ProjectKeySchema>;

/** Full path of the directory in which a project's sessions run. */
export const ProjectCwdSchema = z.string();
export type ProjectCwd = z.infer<typeof ProjectCwdSchema>;

export const ProjectSchema = z.object({
  /** MUST exist in the Claude Code projects directory. */
  key: ProjectKeySchema,
  /** MAY no longer exist locally; null when no session record supplies it. */
  cwd: ProjectCwdSchema.nullable(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** Contents of `~/.claude/projects/<key>/sessions-index.json`. */
export const ProjectSessionIndexSchema = z.object({
  version: z.literal(1),
  entries: z.array(
    z.object({
      sessionId: SessionUuidSchema.describe('Session UUID'),
      fullPath: z.string().describe('Session JSONL transcript path'),
      fileMtime: z.number(),
      firstPrompt: z.string().describe('Defaults to "No prompt"'),
      summary: z.string(),
      messageCount: z.number(),
      created: z.string().describe('ISO datetime'),
      modified: z.string().describe('ISO datetime'),
      gitBranch: z.string().optional(),
      projectPath: ProjectCwdSchema,
      isSidechain: z.boolean(),
    }),
  ),
  originalPath: ProjectCwdSchema,
});
export type ProjectSessionIndex = z.infer<typeof ProjectSessionIndexSchema>;

export type ProjectsEnv = {
  /** User-scoped Claude Code config directory. @default `~/.claude` */
  CLAUDE_CONFIG_DIR: string;
};

export type ProjectsDependencies = {
  /** Injectable for deterministic consumers and tests. */
  listSessions: (options?: ListSessionsOptions) => Promise<SDKSessionInfo[]>;
};

/** Every character outside `[A-Za-z0-9-]` becomes `-`; nothing is collapsed. */
const UNSAFE_IN_PROJECT_KEY = /[^a-zA-Z0-9-]/g;

/** Adapter for Claude Code's `${CLAUDE_CONFIG_DIR}/projects` state. */
export class Projects {
  readonly env: ProjectsEnv;
  private cwds: Map<ProjectKey, ProjectCwd> | null = null;
  private readonly dependencies: ProjectsDependencies;

  constructor(env?: Partial<ProjectsEnv>, dependencies?: Partial<ProjectsDependencies>) {
    this.env = {
      CLAUDE_CONFIG_DIR: expandHome(
        env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? '~/.claude',
      ),
    };
    this.dependencies = {
      listSessions: dependencies?.listSessions ?? sdkListSessions,
    };
  }

  get projectsDir(): string {
    return path.join(this.env.CLAUDE_CONFIG_DIR, 'projects');
  }

  /** Convert a cwd to Claude Code's exact, lossy project-key encoding. */
  toProjectKey(cwd: ProjectCwd): ProjectKey {
    return path.resolve(expandHome(cwd)).replace(UNSAFE_IN_PROJECT_KEY, '-');
  }

  /**
   * Look up a project key's cwd from surviving session records.
   *
   * The key encoding is many-to-one, so this is not a lexical inverse of
   * {@link toProjectKey} and may return null.
   */
  async toCwd(projectKey: ProjectKey): Promise<ProjectCwd | null> {
    return (await this.loadCwds()).get(projectKey) ?? null;
  }

  /** Build the cached `projectKey -> cwd` index from Agent SDK sessions. */
  async loadCwds({ refresh = false } = {}): Promise<ReadonlyMap<ProjectKey, ProjectCwd>> {
    if (this.cwds && !refresh) return this.cwds;
    const cwds = new Map<ProjectKey, ProjectCwd>();
    for (const session of await this.dependencies.listSessions()) {
      if (session.cwd) cwds.set(this.toProjectKey(session.cwd), session.cwd);
    }
    this.cwds = cwds;
    return cwds;
  }

  async projectKeyExists(projectKey: ProjectKey): Promise<boolean> {
    return await exists(path.join(this.projectsDir, projectKey));
  }

  /** List project directory names, excluding non-directory debris. */
  async listProjectKeys(): Promise<ProjectKey[]> {
    const entries = await readdir(this.projectsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }

  async listProjects(): Promise<Project[]> {
    const [projectKeys, cwds] = await Promise.all([this.listProjectKeys(), this.loadCwds()]);
    return projectKeys.map((key) => ({ key, cwd: cwds.get(key) ?? null }));
  }

  /**
   * List default auto-memory directories. Custom settings-based locations are
   * outside this filesystem-only lookup.
   */
  async listAutoMemoryDirs(): Promise<Array<{ path: string; projectKey: ProjectKey }>> {
    const projectKeys = await this.listProjectKeys();
    const candidates = await Promise.all(
      projectKeys.map(async (projectKey) => {
        const memoryDir = path.join(this.projectsDir, projectKey, 'memory');
        return (await exists(memoryDir)) ? { path: memoryDir, projectKey } : null;
      }),
    );
    return candidates.filter((entry) => entry !== null);
  }

  /**
   * Read the legacy `sessions-index.json`, returning undefined when absent.
   * Pass `{ strict: true }` to validate it and throw a ZodError on drift.
   */
  async getSessionIndex(
    projectKey: ProjectKey,
    opts?: { strict: boolean },
  ): Promise<ProjectSessionIndex | undefined> {
    const file = Bun.file(path.join(this.projectsDir, projectKey, 'sessions-index.json'));
    if (!(await file.exists())) return undefined;
    const json: unknown = await file.json();
    return opts?.strict ? ProjectSessionIndexSchema.parse(json) : (json as ProjectSessionIndex);
  }

  async listSessionsByProjectCwd(params?: ListSessionsOptions): Promise<SDKSessionInfo[]> {
    return await this.dependencies.listSessions(params);
  }
}

/** Node path/fs APIs do not expand home-relative paths. */
export const expandHome = (value: string): string =>
  value.replace(/^~(?=\/|$)/, homedir());

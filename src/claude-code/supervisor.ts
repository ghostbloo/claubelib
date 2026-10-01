/**
 * Read-only types and adapters for Claude Code's Supervisor protocol.
 *
 * Claude's UI calls this "agent view", its prose calls the entries "background
 * sessions", and its on-disk layout calls them jobs. This module follows the
 * protocol and storage vocabulary; Familiar's selected tmux orchestration is
 * a separate application concern.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import z from 'zod';
import { SessionUuidSchema } from './projects';

export const SessionKindSchema = z
  .enum(['background', 'interactive'])
  .meta({ id: 'SessionKind', description: "session file spells 'background' as 'bg'" });
export type SessionKind = z.infer<typeof SessionKindSchema>;

const UnixMsSchema = z.number().describe('epoch ms');

export const SessionShortIdSchema = z.string().meta({
  id: 'SessionShortId',
  description: 'Session short ID, usable with `claude attach`, `claude logs`, and `claude stop`.',
});
export type SessionShortId = z.infer<typeof SessionShortIdSchema>;

/** An element of `claude agents --json`. */
export const AgentsJsonRowSchema = z.object({
  sessionId: SessionUuidSchema.optional(),
  cwd: z.string(),
  name: z.string().optional(),
  kind: z.enum(['interactive', 'background']),
  startedAt: z.number(),
  id: SessionShortIdSchema.optional(),
  state: z.enum(['working', 'blocked', 'done', 'failed', 'stopped']).optional(),
  status: z.string().optional(),
  pid: z.number().optional(),
});
export type AgentsJsonRow = z.infer<typeof AgentsJsonRowSchema>;

/** `~/.claude/sessions/<pid>.json`, one file per live Claude Code session. */
export const LiveSessionFileSchema = z.object({
  pid: z.number(),
  sessionId: SessionUuidSchema,
  cwd: z.string(),
  startedAt: z.number(),
  procStart: z.string().describe('Platform-dependent process start time; compare on one host only'),
  version: z.string(),
  peerProtocol: z.number(),
  kind: z.enum(['interactive', 'bg']),
  entrypoint: z.string(),
  name: z.string(),
  nameSource: z.string().optional(),
  status: z.string().optional(),
  updatedAt: z.number().optional(),
  statusUpdatedAt: z.number().optional(),
  jobId: z.string().optional(),
  bridgeSessionId: z.string().nullable().optional(),
  agent: z.string().optional(),
});
export type LiveSessionFile = z.infer<typeof LiveSessionFileSchema>;

/** A normalized `claude agents --json` row. */
export const BackgroundSessionSchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    name: z.string().nullable(),
    cwd: z.string(),
    kind: SessionKindSchema,
    state: z.string().nullable(),
    status: z.string().nullable(),
    startedAt: UnixMsSchema.nullable(),
    pid: z.number().nullable(),
    pidAlive: z.boolean().nullable().describe('Computed with signal 0; not in the CLI output'),
  })
  .meta({ id: 'BackgroundSession' });
export type BackgroundSession = z.infer<typeof BackgroundSessionSchema>;

export const DaemonStatusSchema = z
  .object({
    running: z.boolean(),
    pid: z.number().nullable(),
    version: z.string().nullable(),
    uptimeS: z.number().nullable(),
    origin: z.string().nullable(),
    sockDir: z.string().nullable(),
    controlSock: z.string().nullable(),
    workersRunning: z.number().nullable(),
    workersInRoster: z.number().nullable(),
  })
  .meta({ id: 'DaemonStatus' });
export type DaemonStatus = z.infer<typeof DaemonStatusSchema>;

export const DaemonSummarySchema = DaemonStatusSchema.extend({
  bgSessions: z.number().nullable(),
}).meta({ id: 'DaemonSummary' });
export type DaemonSummary = z.infer<typeof DaemonSummarySchema>;

export const DaemonHealthSchema = z
  .object({
    running: z.boolean(),
    pid: z.number().nullable(),
    pidAlive: z.boolean(),
    controlSock: z.string().nullable(),
    controlSockReachable: z.boolean(),
    workersAlive: z.number().nullable(),
    workersInRoster: z.number().nullable(),
    rosterUpdatedAt: UnixMsSchema.nullable().describe('Inventory timestamp, not a heartbeat'),
  })
  .meta({ id: 'DaemonHealth' });
export type DaemonHealth = z.infer<typeof DaemonHealthSchema>;

export type SupervisorReaderEnv = {
  CLAUDE_BIN: string;
  CLAUDE_DIR: string;
};

export interface SupervisorRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface SupervisorReaderIo {
  run: (cmd: string[]) => Promise<SupervisorRunResult>;
  readJson: (file: string) => Promise<unknown>;
  pidAlive: (pid: number) => boolean;
  socketReachable: (path: string) => Promise<boolean>;
}

const RosterSchema = z.object({
  supervisorPid: z.number().optional(),
  updatedAt: z.number().optional(),
  workers: z
    .record(
      z.string(),
      z.object({ pid: z.number().optional(), rendezvousSock: z.string().optional() }),
    )
    .optional(),
});

const SUPERVISOR_OFFLINE: DaemonStatus = {
  running: false,
  pid: null,
  version: null,
  uptimeS: null,
  origin: null,
  sockDir: null,
  controlSock: null,
  workersRunning: null,
  workersInRoster: null,
};

/** Read Claude's Supervisor CLI and on-disk roster; does not launch or stop sessions. */
export class SupervisorReader {
  protected readonly claudeBin: string;
  protected readonly claudeDir: string;
  private readonly io: SupervisorReaderIo;
  private readonly onWarning: ((message: string, context: object) => void) | undefined;

  constructor(
    config: {
      env?: Partial<SupervisorReaderEnv>;
      io?: Partial<SupervisorReaderIo>;
      onWarning?: (message: string, context: object) => void;
    } = {},
  ) {
    this.claudeBin =
      config.env?.CLAUDE_BIN || process.env.CLAUDE_BIN || `${homedir()}/.local/bin/claude`;
    this.claudeDir =
      config.env?.CLAUDE_DIR || process.env.CLAUDE_CONFIG_DIR || `${homedir()}/.claude`;
    this.io = { ...defaultIo, ...config.io };
    this.onWarning = config.onWarning;
  }

  async listSessions(params?: { all?: boolean; cwd?: string }): Promise<BackgroundSession[]> {
    const args = [this.claudeBin, 'agents', '--json'];
    if (params?.all) args.push('--all');
    if (params?.cwd) args.push('--cwd', params.cwd);

    const result = await this.io.run(args);
    if (result.code !== 0) throw commandError(args, result);
    const rows = z.array(AgentsJsonRowSchema).parse(JSON.parse(result.stdout));
    return rows.map((row) => ({
      id: row.id ?? row.sessionId ?? 'unknown',
      sessionId: row.sessionId ?? row.id ?? 'unknown',
      name: row.name ?? null,
      cwd: row.cwd,
      kind: row.kind,
      state: row.state ?? null,
      status: row.status ?? null,
      startedAt: row.startedAt,
      pid: row.pid ?? null,
      pidAlive: typeof row.pid === 'number' ? this.io.pidAlive(row.pid) : null,
    }));
  }

  /**
   * Parse `claude daemon status`. Note that Claude may start its on-demand
   * Supervisor while answering this command; use {@link health} for a wake-free probe.
   */
  async status(): Promise<DaemonStatus> {
    const result = await this.io.run([this.claudeBin, 'daemon', 'status']);
    if (result.code !== 0) return { ...SUPERVISOR_OFFLINE };

    const grab = (pattern: RegExp) => result.stdout.match(pattern)?.[1] ?? null;
    const grabNumber = (pattern: RegExp) => {
      const value = grab(pattern);
      return value === null ? null : Number(value);
    };
    const pid = grabNumber(/pid:\s+(\d+)/);
    return {
      running: pid !== null,
      pid,
      version: grab(/version:\s+(\S+)/),
      uptimeS: grabNumber(/uptime:\s+(\d+)s/),
      origin: grab(/origin:\s+(\S+)/),
      sockDir: grab(/sock dir:\s+(\S+)/),
      controlSock: grab(/control\.sock:\s+(\S+)/),
      workersRunning: grabNumber(/bg workers:\s+(\d+) running/),
      workersInRoster: grabNumber(/(\d+) in roster\.json/),
    };
  }

  /** Read-only and wake-free liveness from the roster, signal 0, and a socket connect. */
  async health(): Promise<DaemonHealth> {
    const roster = await this.readRoster();
    const pid = roster?.supervisorPid ?? null;
    const alive = pid !== null && this.io.pidAlive(pid);
    const workers = Object.values(roster?.workers ?? {});
    const workerPids = workers.map((worker) => worker.pid).filter((value): value is number =>
      typeof value === 'number'
    );
    const controlSock = controlSockPath(workers);
    const socketOk = controlSock ? await this.io.socketReachable(controlSock) : false;

    return {
      running: alive && (controlSock === null || socketOk),
      pid,
      pidAlive: alive,
      controlSock,
      controlSockReachable: socketOk,
      workersAlive: roster ? workerPids.filter(this.io.pidAlive).length : null,
      workersInRoster: roster ? workers.length : null,
      rosterUpdatedAt: roster?.updatedAt ?? null,
    };
  }

  async getDaemon(): Promise<DaemonSummary> {
    const [daemon, sessions] = await Promise.allSettled([this.status(), this.listSessions()]);
    const bgSessions =
      sessions.status === 'fulfilled'
        ? sessions.value.filter(
            (session) => session.kind === 'background' && session.pidAlive !== false,
          ).length
        : null;
    return {
      ...(daemon.status === 'fulfilled' ? daemon.value : SUPERVISOR_OFFLINE),
      bgSessions,
    };
  }

  private async readRoster(): Promise<z.infer<typeof RosterSchema> | null> {
    const path = `${this.claudeDir}/daemon/roster.json`;
    try {
      const parsed = RosterSchema.safeParse(await this.io.readJson(path));
      if (parsed.success) return parsed.data;
      this.onWarning?.('roster.json did not parse as expected', { path });
      return null;
    } catch {
      return null;
    }
  }
}

const defaultIo: SupervisorReaderIo = {
  run: runProcess,
  readJson: async (file) => JSON.parse(await readFile(file, 'utf8')),
  pidAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  socketReachable: async (path) => {
    try {
      const socket = await Bun.connect({
        unix: path,
        socket: { data() {}, open() {}, error() {}, close() {} },
      });
      socket.end();
      return true;
    } catch {
      return false;
    }
  },
};

async function runProcess(cmd: string[]): Promise<SupervisorRunResult> {
  const process = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  const timer = setTimeout(() => process.kill(), 30_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

function commandError(cmd: string[], result: SupervisorRunResult): Error {
  return new Error(
    `${cmd.slice(0, 2).join(' ')} exited ${result.code}: ${result.stderr.trim().slice(0, 300)}`,
  );
}

function controlSockPath(workers: { rendezvousSock?: string }[]): string | null {
  const rendezvous = workers.find((worker) => worker.rendezvousSock)?.rendezvousSock;
  if (!rendezvous) return null;
  const dir = rendezvous.split('/').slice(0, -2).join('/');
  return dir ? `${dir}/control.sock` : null;
}

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { Projects } from './projects';

const tempDirs: string[] = [];

async function fixture(): Promise<{ configDir: string; projectsDir: string }> {
  const configDir = await mkdtemp(path.join(tmpdir(), 'claude-code-shared-'));
  tempDirs.push(configDir);
  const projectsDir = path.join(configDir, 'projects');
  await mkdir(projectsDir);
  return { configDir, projectsDir };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Projects', () => {
  it('encodes project keys without collapsing replacement characters', () => {
    const projects = new Projects({ CLAUDE_CONFIG_DIR: '/tmp/unused' });
    expect(projects.toProjectKey('/home/alex/.config/example')).toBe(
      '-home-alex--config-example',
    );
  });

  it('lists only project directories and joins surviving cwd records', async () => {
    const { configDir, projectsDir } = await fixture();
    await mkdir(path.join(projectsDir, '-home-alex-work-one'));
    await mkdir(path.join(projectsDir, '-home-alex-work-stale'));
    await writeFile(path.join(projectsDir, '.DS_Store'), '');
    const sessions: SDKSessionInfo[] = [
      {
        sessionId: '1a57abac-bd0b-4cec-b0de-e26c388f3d0e',
        summary: '',
        lastModified: 1,
        cwd: '/home/alex/work/one',
      },
    ];
    const projects = new Projects({ CLAUDE_CONFIG_DIR: configDir }, { listSessions: async () => sessions });

    expect(await projects.listProjects()).toEqual([
      { key: '-home-alex-work-one', cwd: '/home/alex/work/one' },
      { key: '-home-alex-work-stale', cwd: null },
    ]);
  });

  it('discovers only project directories containing default auto memory', async () => {
    const { configDir, projectsDir } = await fixture();
    await mkdir(path.join(projectsDir, '-home-alex-work-one', 'memory'), { recursive: true });
    await mkdir(path.join(projectsDir, '-home-alex-work-two'));
    const projects = new Projects({ CLAUDE_CONFIG_DIR: configDir }, { listSessions: async () => [] });

    expect(await projects.listAutoMemoryDirs()).toEqual([
      {
        path: path.join(projectsDir, '-home-alex-work-one', 'memory'),
        projectKey: '-home-alex-work-one',
      },
    ]);
  });

  it('returns undefined for a missing legacy session index', async () => {
    const { configDir, projectsDir } = await fixture();
    await mkdir(path.join(projectsDir, '-home-alex-work-one'));
    const projects = new Projects({ CLAUDE_CONFIG_DIR: configDir });

    expect(await projects.getSessionIndex('-home-alex-work-one')).toBeUndefined();
  });

  it('throws on a malformed strict legacy session index', async () => {
    const { configDir, projectsDir } = await fixture();
    const projectDir = path.join(projectsDir, '-home-alex-work-one');
    await mkdir(projectDir);
    await writeFile(path.join(projectDir, 'sessions-index.json'), JSON.stringify({ version: 2 }));
    const projects = new Projects({ CLAUDE_CONFIG_DIR: configDir });

    expect(projects.getSessionIndex('-home-alex-work-one', { strict: true })).rejects.toThrow();
  });

  it('scopes session reads with the caller options', async () => {
    let received: unknown;
    const projects = new Projects(
      { CLAUDE_CONFIG_DIR: '/tmp/unused' },
      {
        listSessions: async (options) => {
          received = options;
          return [];
        },
      },
    );

    await projects.listSessionsByProjectCwd({ dir: '/home/alex/work/one', includeWorktrees: false });
    expect(received).toEqual({ dir: '/home/alex/work/one', includeWorktrees: false });
  });
});

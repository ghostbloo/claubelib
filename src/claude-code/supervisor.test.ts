import { describe, expect, it } from 'bun:test';
import { SupervisorReader, type SupervisorReaderIo } from './supervisor';

const row = {
  sessionId: '1a57abac-bd0b-4cec-b0de-e26c388f3d0e',
  cwd: '/work/example',
  name: 'example-aa',
  kind: 'interactive' as const,
  startedAt: 1_700_000_000_000,
  status: 'idle',
  pid: 42,
};

function reader(io: Partial<SupervisorReaderIo>): SupervisorReader {
  return new SupervisorReader({
    env: { CLAUDE_BIN: '/bin/claude', CLAUDE_DIR: '/claude' },
    io: {
      run: async () => ({ code: 0, stdout: '[]', stderr: '' }),
      readJson: async () => ({}),
      pidAlive: () => false,
      socketReachable: async () => false,
      ...io,
    },
  });
}

describe('SupervisorReader', () => {
  it('normalizes agent rows without touching the filesystem', async () => {
    const commands: string[][] = [];
    const supervisor = reader({
      run: async (command) => {
        commands.push(command);
        return { code: 0, stdout: JSON.stringify([row]), stderr: '' };
      },
      pidAlive: (pid) => pid === 42,
    });

    expect(await supervisor.listSessions({ all: true })).toEqual([
      {
        id: row.sessionId,
        sessionId: row.sessionId,
        name: row.name,
        cwd: row.cwd,
        kind: row.kind,
        state: null,
        status: row.status,
        startedAt: row.startedAt,
        pid: row.pid,
        pidAlive: true,
      },
    ]);
    expect(commands).toEqual([['/bin/claude', 'agents', '--json', '--all']]);
  });

  it('parses the daemon status text through an injected reader', async () => {
    const supervisor = reader({
      run: async () => ({
        code: 0,
        stderr: '',
        stdout:
          'pid: 123\nversion: 2.1.220\nuptime: 9s\norigin: foreground\n' +
          'sock dir: /tmp/cc\ncontrol.sock: reachable\nbg workers: 2 running, 3 in roster.json\n',
      }),
    });

    expect(await supervisor.status()).toEqual({
      running: true,
      pid: 123,
      version: '2.1.220',
      uptimeS: 9,
      origin: 'foreground',
      sockDir: '/tmp/cc',
      controlSock: 'reachable',
      workersRunning: 2,
      workersInRoster: 3,
    });
  });

  it('checks wake-free health using only injected reads and probes', async () => {
    const read: string[] = [];
    const sockets: string[] = [];
    const supervisor = reader({
      readJson: async (file) => {
        read.push(file);
        return {
          supervisorPid: 10,
          updatedAt: 20,
          workers: {
            a: { pid: 11, rendezvousSock: '/tmp/cc/hash/workers/a.sock' },
            b: { pid: 12 },
          },
        };
      },
      pidAlive: (pid) => pid !== 12,
      socketReachable: async (path) => {
        sockets.push(path);
        return true;
      },
    });

    expect(await supervisor.health()).toEqual({
      running: true,
      pid: 10,
      pidAlive: true,
      controlSock: '/tmp/cc/hash/control.sock',
      controlSockReachable: true,
      workersAlive: 1,
      workersInRoster: 2,
      rosterUpdatedAt: 20,
    });
    expect(read).toEqual(['/claude/daemon/roster.json']);
    expect(sockets).toEqual(['/tmp/cc/hash/control.sock']);
  });
});

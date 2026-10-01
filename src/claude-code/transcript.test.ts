import { describe, expect, it } from 'bun:test';
import {
  contentBlocks,
  isBridgeSessionEntry,
  isCompactBoundaryEntry,
  isCompactSummaryEntry,
  parseTranscriptLine,
  type TranscriptEntry,
} from './transcript';

/** `entrypoint` is intentionally omitted to cover older valid entries. */
const envelope = {
  uuid: 'f0c1e2d3-0000-4000-8000-000000000001',
  parentUuid: null,
  isSidechain: false,
  timestamp: '2026-08-30T12:00:00.000Z',
  userType: 'external',
  cwd: '/home/alex/work/example',
  sessionId: '1a57abac-bd0b-4cec-b0de-e26c388f3d0e',
  version: '2.0.1',
  gitBranch: 'main',
};
const line = (value: object) => JSON.stringify(value);

describe('parseTranscriptLine', () => {
  it('parses the conversational kinds', () => {
    const user = parseTranscriptLine(
      line({ ...envelope, type: 'user', message: { content: 'hi' } }),
    );
    expect(user?.type).toBe('user');
    const assistant = parseTranscriptLine(
      line({
        ...envelope,
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello' }] },
      }),
    );
    expect(assistant?.type).toBe('assistant');
    const system = parseTranscriptLine(
      line({ ...envelope, type: 'system', subtype: 'turn_duration' }),
    );
    expect(system?.type).toBe('system');
  });

  it('parses summary, which carries no envelope', () => {
    const entry = parseTranscriptLine(line({ type: 'summary', summary: 's', leafUuid: 'u' }));
    expect(entry?.type).toBe('summary');
  });

  it('distinguishes a compact boundary from other system entries', () => {
    const entry = parseTranscriptLine(
      line({
        ...envelope,
        type: 'system',
        subtype: 'compact_boundary',
        logicalParentUuid: 'f0c1e2d3-0000-4000-8000-000000000000',
        compactMetadata: {
          trigger: 'manual',
          preTokens: 100,
          postTokens: 40,
          preservedSegment: {
            headUuid: 'f0c1e2d3-0000-4000-8000-000000000002',
            anchorUuid: 'f0c1e2d3-0000-4000-8000-000000000003',
            tailUuid: 'f0c1e2d3-0000-4000-8000-000000000004',
          },
          preservedMessages: {
            anchorUuid: 'f0c1e2d3-0000-4000-8000-000000000003',
            uuids: ['f0c1e2d3-0000-4000-8000-000000000002'],
            allUuids: [
              'f0c1e2d3-0000-4000-8000-000000000002',
              'unresolved-runtime-id',
            ],
          },
        },
      }),
    ) as TranscriptEntry;
    expect(isCompactBoundaryEntry(entry)).toBe(true);
    if (isCompactBoundaryEntry(entry)) {
      expect(entry.logicalParentUuid).toBe('f0c1e2d3-0000-4000-8000-000000000000');
      expect(entry.compactMetadata.preservedMessages?.allUuids).toHaveLength(2);
    }

    const ordinary = parseTranscriptLine(
      line({ ...envelope, type: 'system', subtype: 'turn_duration' }),
    ) as TranscriptEntry;
    expect(isCompactBoundaryEntry(ordinary)).toBe(false);
  });


  it('distinguishes summarize-to-position memory from an ordinary user entry', () => {
    const entry = parseTranscriptLine(
      line({
        ...envelope,
        type: 'user',
        parentUuid: 'f0c1e2d3-0000-4000-8000-000000000000',
        isCompactSummary: true,
        summarizeMetadata: {
          direction: 'up_to',
          messagesSummarized: 999,
          userContext: 'what do you remember from earlier?',
        },
        message: { role: 'user', content: 'first-person memory' },
      }),
    ) as TranscriptEntry;
    expect(isCompactSummaryEntry(entry)).toBe(true);
    if (isCompactSummaryEntry(entry)) {
      expect(entry.summarizeMetadata?.direction).toBe('up_to');
      expect(entry.summarizeMetadata?.messagesSummarized).toBe(999);
    }

    const ordinary = parseTranscriptLine(
      line({ ...envelope, type: 'user', message: { content: 'ordinary prompt' } }),
    ) as TranscriptEntry;
    expect(isCompactSummaryEntry(ordinary)).toBe(false);
  });

  it('keeps unmodelled kinds instead of dropping them', () => {
    const entry = parseTranscriptLine(line({ type: 'attachment', foo: 1 }));
    expect(entry?.type).toBe('attachment');
    expect((entry as { foo?: number }).foo).toBe(1);
  });

  it('keeps a known kind whose body is malformed', () => {
    const entry = parseTranscriptLine(line({ type: 'user', message: 'not an object' }));
    expect(entry?.type).toBe('user');
  });

  it('returns null for non-JSON, blank, and truncated lines', () => {
    expect(parseTranscriptLine('')).toBeNull();
    expect(parseTranscriptLine('   ')).toBeNull();
    expect(parseTranscriptLine('{"type":"user"')).toBeNull();
  });

  it('preserves unknown envelope fields', () => {
    const entry = parseTranscriptLine(
      line({ ...envelope, type: 'user', message: { content: 'x' }, agentId: 'a1' }),
    );
    expect((entry as { agentId?: string }).agentId).toBe('a1');
  });
});

describe('contentBlocks', () => {
  it('normalises bare-string content into one text block', () => {
    const entry = parseTranscriptLine(
      line({ ...envelope, type: 'user', message: { content: 'plain' } }),
    );
    expect(contentBlocks(entry as TranscriptEntry)).toEqual([{ type: 'text', text: 'plain' }]);
  });

  it('passes array content through and drops typeless junk', () => {
    const entry = parseTranscriptLine(
      line({
        ...envelope,
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }, { nope: true }],
        },
      }),
    );
    const blocks = contentBlocks(entry as TranscriptEntry);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('tool_use');
  });

  it('returns empty for entries with no message', () => {
    expect(
      contentBlocks(parseTranscriptLine(line({ type: 'attachment' })) as TranscriptEntry),
    ).toEqual([]);
  });
});

describe('bridge-session', () => {
  it('parses the relay claim record and narrows', () => {
    const entry = parseTranscriptLine(
      line({
        type: 'bridge-session',
        sessionId: '368cbb3a-1f3c-4743-acde-b394cde2e69d',
        bridgeSessionId: 'cse_01LJzLvMq38HpVKPMciPnDja',
        lastSequenceNum: 0,
      }),
    ) as TranscriptEntry;
    expect(isBridgeSessionEntry(entry)).toBe(true);
    if (isBridgeSessionEntry(entry)) {
      expect(entry.bridgeSessionId.replace(/^cse_/, '')).toBe('01LJzLvMq38HpVKPMciPnDja');
    }
  });
});

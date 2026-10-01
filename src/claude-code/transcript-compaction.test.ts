import { describe, expect, it } from 'bun:test';
import { inspectCompactCrossings } from './transcript-compaction';
import { parseTranscriptLine, type TranscriptEntry } from './transcript';

const base = {
  parentUuid: null,
  isSidechain: false,
  timestamp: '2026-09-10T00:00:00.000Z',
  userType: 'external',
  cwd: '/tmp/example',
  sessionId: '11111111-1111-4111-8111-111111111111',
  version: '2.1.238',
  gitBranch: 'main',
};

const parse = (value: object) =>
  parseTranscriptLine(JSON.stringify(value)) as TranscriptEntry;

function fixture(): TranscriptEntry[] {
  return [
    parse({ ...base, uuid: 'old', type: 'user', message: { content: 'old' } }),
    parse({ ...base, uuid: 'keep-head', parentUuid: 'old', type: 'assistant', message: { content: 'kept' } }),
    parse({
      ...base,
      uuid: 'boundary',
      type: 'system',
      subtype: 'compact_boundary',
      logicalParentUuid: 'old',
      compactMetadata: {
        trigger: 'manual',
        preservedSegment: { headUuid: 'keep-head', anchorUuid: 'summary', tailUuid: 'keep-head' },
        preservedMessages: {
          anchorUuid: 'summary',
          uuids: ['keep-head'],
          allUuids: ['keep-head', 'opaque-runtime-id'],
        },
      },
    }),
    parse({
      ...base,
      uuid: 'summary',
      parentUuid: 'boundary',
      type: 'user',
      isCompactSummary: true,
      summarizeMetadata: { direction: 'up_to' },
      message: { content: 'memory' },
    }),
  ];
}

describe('inspectCompactCrossings', () => {
  it('resolves the structural seam and preserves opaque references', () => {
    const [crossing] = inspectCompactCrossings(fixture());
    expect(crossing?.boundaryIndex).toBe(2);
    expect(crossing?.logicalParent?.index).toBe(0);
    expect(crossing?.summaryChildren.map(x => x.index)).toEqual([3]);
    expect(crossing?.preserved.resolved.map(x => x.index)).toEqual([1]);
    expect(crossing?.allPreserved.unresolved).toEqual(['opaque-runtime-id']);
    expect(crossing?.allUuidsOnly).toEqual(['opaque-runtime-id']);
    expect(crossing?.head?.index).toBe(1);
    expect(crossing?.anchor?.index).toBe(3);
    expect(crossing?.tail?.index).toBe(1);
    expect(crossing?.issues).toEqual([]);
  });

  it('reports missing required references without inventing replacements', () => {
    const entries = fixture();
    const boundary = entries[2] as Record<string, any>;
    boundary.logicalParentUuid = 'missing-parent';
    boundary.compactMetadata.preservedMessages.uuids = ['missing-preserved'];
    entries.pop();

    const [crossing] = inspectCompactCrossings(entries);
    expect(crossing?.logicalParent).toBeNull();
    expect(crossing?.preserved.unresolved).toEqual(['missing-preserved']);
    expect(crossing?.issues).toEqual([
      'missing_summary_child',
      'missing_logical_parent',
      'missing_preserved_uuid',
    ]);
  });
});

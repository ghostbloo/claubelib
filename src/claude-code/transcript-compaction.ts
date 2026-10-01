import {
  isCompactBoundaryEntry,
  isCompactSummaryEntry,
  type CompactBoundaryEntry,
  type TranscriptEntry,
} from './transcript';

export interface ResolvedTranscriptReference {
  uuid: string;
  /** Zero-based index in the caller-provided entry sequence. */
  index: number;
}

export interface ReferenceSetInspection {
  recorded: number;
  resolved: ResolvedTranscriptReference[];
  unresolved: string[];
}

export type CompactCrossingIssue =
  | 'duplicate_uuid'
  | 'missing_logical_parent'
  | 'missing_summary_child'
  | 'multiple_summary_children'
  | 'missing_preserved_uuid';

/** A structural view of one compact boundary; it does not reconstruct a prompt. */
export interface CompactCrossingInspection {
  boundaryIndex: number;
  boundary: CompactBoundaryEntry;
  logicalParent: ResolvedTranscriptReference | null;
  summaryChildren: ResolvedTranscriptReference[];
  preserved: ReferenceSetInspection;
  allPreserved: ReferenceSetInspection;
  /** `allUuids` members absent from `uuids`; these may be opaque runtime ids. */
  allUuidsOnly: string[];
  anchor: ResolvedTranscriptReference | null;
  head: ResolvedTranscriptReference | null;
  tail: ResolvedTranscriptReference | null;
  issues: CompactCrossingIssue[];
}

function stringField(entry: TranscriptEntry, key: string): string | null {
  const value = (entry as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function inspectReferences(
  values: readonly string[],
  byUuid: ReadonlyMap<string, number>,
): ReferenceSetInspection {
  const resolved: ResolvedTranscriptReference[] = [];
  const unresolved: string[] = [];
  for (const uuid of values) {
    const index = byUuid.get(uuid);
    if (index === undefined) unresolved.push(uuid);
    else resolved.push({ uuid, index });
  }
  return { recorded: values.length, resolved, unresolved };
}

function resolveOne(
  uuid: string | undefined,
  byUuid: ReadonlyMap<string, number>,
): ResolvedTranscriptReference | null {
  if (!uuid) return null;
  const index = byUuid.get(uuid);
  return index === undefined ? null : { uuid, index };
}

/**
 * Inspect Claude Code summarize-to-position seams without assigning semantic
 * meaning to the summary or inventing references absent from the transcript.
 *
 * The result intentionally stops short of producing an effective context.
 * Claude Code's ordering/coverage semantics need independent evidence first.
 */
export function inspectCompactCrossings(
  entries: readonly TranscriptEntry[],
): CompactCrossingInspection[] {
  const byUuid = new Map<string, number>();
  const duplicateUuids = new Set<string>();
  const children = new Map<string, number[]>();

  for (const [index, entry] of entries.entries()) {
    const uuid = stringField(entry, 'uuid');
    if (uuid) {
      if (byUuid.has(uuid)) duplicateUuids.add(uuid);
      else byUuid.set(uuid, index);
    }
    const parentUuid = stringField(entry, 'parentUuid');
    if (parentUuid) {
      const indexes = children.get(parentUuid) ?? [];
      indexes.push(index);
      children.set(parentUuid, indexes);
    }
  }

  const inspections: CompactCrossingInspection[] = [];
  for (const [boundaryIndex, entry] of entries.entries()) {
    if (!isCompactBoundaryEntry(entry)) continue;

    const issues = new Set<CompactCrossingIssue>();
    if (duplicateUuids.size > 0) issues.add('duplicate_uuid');

    const boundaryUuid = stringField(entry, 'uuid');
    const summaryChildren = (boundaryUuid ? children.get(boundaryUuid) ?? [] : [])
      .filter(index => isCompactSummaryEntry(entries[index]!))
      .map(index => ({ uuid: stringField(entries[index]!, 'uuid')!, index }));
    if (summaryChildren.length === 0) issues.add('missing_summary_child');
    if (summaryChildren.length > 1) issues.add('multiple_summary_children');

    const logicalParent = resolveOne(entry.logicalParentUuid, byUuid);
    if (entry.logicalParentUuid && !logicalParent) issues.add('missing_logical_parent');

    const metadata = entry.compactMetadata;
    const uuids = metadata.preservedMessages?.uuids ?? [];
    const allUuids = metadata.preservedMessages?.allUuids ?? [];
    const preserved = inspectReferences(uuids, byUuid);
    const allPreserved = inspectReferences(allUuids, byUuid);
    if (preserved.unresolved.length > 0) issues.add('missing_preserved_uuid');

    const uuidSet = new Set(uuids);
    inspections.push({
      boundaryIndex,
      boundary: entry,
      logicalParent,
      summaryChildren,
      preserved,
      allPreserved,
      allUuidsOnly: allUuids.filter(uuid => !uuidSet.has(uuid)),
      anchor: resolveOne(
        metadata.preservedMessages?.anchorUuid ?? metadata.preservedSegment?.anchorUuid,
        byUuid,
      ),
      head: resolveOne(metadata.preservedSegment?.headUuid, byUuid),
      tail: resolveOne(metadata.preservedSegment?.tailUuid, byUuid),
      issues: [...issues],
    });
  }

  return inspections;
}

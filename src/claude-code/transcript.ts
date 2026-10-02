/**
 * Transcript JSONL entries — one per line of
 * `~/.claude/projects/<project>/<sessionId>.jsonl`.
 *
 * The Agent SDK's `getSessionMessages` returns `message: unknown`, so this is
 * where a body gets a shape. Content blocks come from
 * `./vendor/claude-devtools`; the entry layer is open by construction because
 * Claude Code can add entry kinds independently of this package.
 *
 * For reading transcripts prefer the Agent SDK (`listSessions`,
 * `getSessionMessages`). Reach for these schemas when you need the body.
 */
import { z } from 'zod';
import { expectType } from '../lib/zod-utils';
import type { ContentBlock } from '../anthropic-api/content-blocks';
import { SessionUuidSchema } from './projects';
import { BridgeSessionIdSchema } from './bridge';

/**
 * Fields carried by conversational entries. `entrypoint` is deliberately
 * absent because older valid entries do not carry it.
 */
export const EntryEnvelopeSchema = z.looseObject({
  uuid: z.string(),
  parentUuid: z.string().nullable(),
  isSidechain: z.boolean(),
  type: z.string(),
  timestamp: z.string(),
  userType: z.string(),
  cwd: z.string(),
  sessionId: z.string(),
  /** Claude Code version */
  version: z.string(),
  gitBranch: z.string(),
});

/** `message.content` may be a bare string or an array of content blocks. */
const MessageSchema = z.looseObject({
  content: z.union([z.string(), z.array(z.unknown())]),
});

/** Metadata carried by Claude Code's summarize-to-position memory entry. */
export const SummarizeMetadataSchema = z.looseObject({
  direction: z.string().optional(),
  messagesSummarized: z.number().optional(),
  userContext: z.string().optional(),
});

/**
 * A manual/default compaction memory. Claude Code stores this as a `user`
 * entry, not as top-level `type: "summary"`, so it must be checked before
 * the broader UserEntrySchema.
 */
export const CompactSummaryEntrySchema = EntryEnvelopeSchema.extend({
  type: z.literal('user'),
  isCompactSummary: z.literal(true),
  message: MessageSchema,
  summarizeMetadata: SummarizeMetadataSchema.optional(),
});

export const UserEntrySchema = EntryEnvelopeSchema.extend({
  type: z.literal('user'),
  message: MessageSchema,
});

export const AssistantEntrySchema = EntryEnvelopeSchema.extend({
  type: z.literal('assistant'),
  message: MessageSchema,
});

/** References describing the raw suffix preserved across a compaction. */
export const PreservedSegmentSchema = z.looseObject({
  headUuid: z.string().optional(),
  anchorUuid: z.string().optional(),
  tailUuid: z.string().optional(),
});

/** Ordered entry references recorded by Claude Code at compaction time. */
export const PreservedMessagesSchema = z.looseObject({
  anchorUuid: z.string().optional(),
  uuids: z.array(z.string()).optional(),
  allUuids: z.array(z.string()).optional(),
});

/** Metadata carried by a `system:compact_boundary` entry. */
export const CompactMetadataSchema = z.looseObject({
  trigger: z.string().optional(), // 'manual' | 'auto', possibly more
  preTokens: z.number().optional(),
  postTokens: z.number().optional(),
  messagesSummarized: z.number().optional(),
  durationMs: z.number().optional(),
  cumulativeDroppedTokens: z.number().optional(),
  preservedSegment: PreservedSegmentSchema.optional(),
  preservedMessages: PreservedMessagesSchema.optional(),
  preCompactDiscoveredTools: z.array(z.string()).optional(),
  userContext: z.string().optional(),
});

/**
 * The root marker for a Claude Code compaction. Its ordinary parent may reset
 * to null; `logicalParentUuid` and compact metadata carry the coverage seam.
 */
export const CompactBoundaryEntrySchema = EntryEnvelopeSchema.extend({
  type: z.literal('system'),
  subtype: z.literal('compact_boundary'),
  logicalParentUuid: z.string().optional(),
  compactMetadata: CompactMetadataSchema,
});

export const SystemEntrySchema = EntryEnvelopeSchema.extend({
  type: z.literal('system'),
  subtype: z.string(),
});

export const SystemInformationalMessage = z.looseObject({
  type: z.literal('system'),
  subtype: z.literal('informational'),
  uuid: z.uuid(),
  content: z.string(),
  level: z.string(),
  preventContinuation: z.boolean().optional(),
});

/** A summary entry has no conversational envelope. */
export const SummaryEntrySchema = z.looseObject({
  type: z.literal('summary'),
  summary: z.string(),
  leafUuid: z.string(),
});

/**
 * Written when a session is claimed by the Remote Control relay.
 *
 * `bridgeSessionId` is the id behind a Claude Code web session. The relay may
 * spell the same id body with either a `cse_` or `session_` prefix.
 */
export const BridgeSessionEntrySchema = z.looseObject({
  type: z.literal('bridge-session'),
  sessionId: SessionUuidSchema,
  bridgeSessionId: BridgeSessionIdSchema,
  lastSequenceNum: z.number().optional(),
  ownerAccountUuid: z.string().optional(),
  ownerOrganizationUuid: z.string().optional(),
});

export const ATTACHMENT_TYPE = [
  'file',
  'deferred_tools_delta',
  'agent_listing_delta',
  'mcp_instructions_delta',
  'skill_listing',
  'total_tokens_reminder',
  'hook_success',
  'directory',
];

/** Anything we have not modelled. Kept whole rather than dropped. */
export const UnknownEntrySchema = z.looseObject({ type: z.string() });

const KNOWN = [
  CompactSummaryEntrySchema,
  UserEntrySchema,
  AssistantEntrySchema,
  CompactBoundaryEntrySchema,
  SystemEntrySchema,
  SummaryEntrySchema,
  BridgeSessionEntrySchema,
] as const;

export type CompactSummaryEntry = z.infer<typeof CompactSummaryEntrySchema>;
export type UserEntry = z.infer<typeof UserEntrySchema>;
export type AssistantEntry = z.infer<typeof AssistantEntrySchema>;
export type CompactBoundaryEntry = z.infer<typeof CompactBoundaryEntrySchema>;
export type SystemEntry = z.infer<typeof SystemEntrySchema>;
export type SummaryEntry = z.infer<typeof SummaryEntrySchema>;
export type BridgeSessionEntry = z.infer<typeof BridgeSessionEntrySchema>;
export type UnknownEntry = z.infer<typeof UnknownEntrySchema>;
export type TranscriptEntry =
  | CompactSummaryEntry
  | UserEntry
  | AssistantEntry
  | CompactBoundaryEntry
  | SystemEntry
  | SummaryEntry
  | BridgeSessionEntry
  | UnknownEntry;

/**
 * Parse one JSONL line. Returns null only when the line is not JSON at all.
 * Unknown or malformed known entry kinds come back as {@link UnknownEntry}.
 */
export function parseTranscriptLine(line: string): TranscriptEntry | null {
  if (!line.trim()) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  for (const schema of KNOWN) {
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
  }
  const unknown = UnknownEntrySchema.safeParse(raw);
  return unknown.success ? unknown.data : null;
}

/** Normalize a bare-string `message.content` into one synthetic text block. */
export function contentBlocks(entry: TranscriptEntry): ContentBlock[] {
  const message = (entry as { message?: { content?: unknown } }).message;
  const content = message?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  return content.filter((block): block is ContentBlock =>
    typeof (block as ContentBlock)?.type === 'string'
  );
}

export function isCompactBoundaryEntry(
  entry: TranscriptEntry,
): entry is CompactBoundaryEntry {
  return CompactBoundaryEntrySchema.safeParse(entry).success;
}

export function isCompactSummaryEntry(entry: TranscriptEntry): entry is CompactSummaryEntry {
  return entry.type === 'user' &&
    (entry as { isCompactSummary?: unknown }).isCompactSummary === true;
}

export function isBridgeSessionEntry(entry: TranscriptEntry): entry is BridgeSessionEntry {
  return entry.type === 'bridge-session';
}

expectType<ContentBlock[]>(contentBlocks({ type: 'x' } as TranscriptEntry));

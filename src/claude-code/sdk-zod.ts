/** Zod schemas pinned to Claude Agent SDK type exports. */

import type {
  ResolvedSettings,
  ResolveSettingsOptions,
  SDKSessionInfo,
  Settings,
} from '@anthropic-ai/claude-agent-sdk';
import { resolveSettings } from '@anthropic-ai/claude-agent-sdk';
import z from 'zod';
import { expectType } from '../lib/zod-utils';
import { SessionUuidSchema } from './projects';

export const SDKSessionInfoSchema = z
  .object({
    sessionId: SessionUuidSchema,
    summary: z.string(),
    lastModified: z.number(),
    fileSize: z.number().optional(),
    customTitle: z.string().optional(),
    firstPrompt: z.string().optional(),
    gitBranch: z.string().optional(),
    cwd: z.string().optional(),
    tag: z.string().optional(),
    createdAt: z.number().optional(),
  })
  .meta({ id: 'SDKSessionInfo' });

expectType<SDKSessionInfo>({} as z.infer<typeof SDKSessionInfoSchema>);

const ClaudeSettingsSchema = z.custom<Settings>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  'expected a Claude Code settings object',
);

const SettingSourceSchema = z.enum(['user', 'project', 'local']);
const ResolvedSettingSourceSchema = z.enum(['user', 'project', 'local', 'managed', 'flag']);
const PolicySettingsOriginSchema = z.enum([
  'helper',
  'remote',
  'plist',
  'hklm',
  'file',
  'parent',
  'hkcu',
]);

/** Runtime schema pinned to the Agent SDK's settings resolver options. */
export const ResolveSettingsOptionsSchema = z.object({
  cwd: z.string().optional(),
  settingSources: z.array(SettingSourceSchema).optional(),
  managedSettings: ClaudeSettingsSchema.optional(),
  serverManagedSettings: ClaudeSettingsSchema.optional(),
});

expectType<ResolveSettingsOptions>({} as z.infer<typeof ResolveSettingsOptionsSchema>);

const ProvenanceEntrySchema = z.object({
  source: ResolvedSettingSourceSchema,
  path: z.string().optional(),
  policyOrigin: PolicySettingsOriginSchema.optional(),
});

/** Serializable result of the Agent SDK's `resolveSettings`. */
export const ResolvedSettingsSchema = z.object({
  effective: ClaudeSettingsSchema,
  provenance: z.record(z.string(), ProvenanceEntrySchema),
  sources: z.array(ProvenanceEntrySchema.extend({ settings: ClaudeSettingsSchema })),
});
export type ClaudeResolvedSettings = z.infer<typeof ResolvedSettingsSchema>;

expectType<ResolvedSettings>({} as z.infer<typeof ResolvedSettingsSchema>);

/** The SDK implementation, named explicitly for consumers of this broader package. */
export const resolveClaudeSettings = resolveSettings;

/**
 * This file is for anything involving the kind of session identifiers tagged with `cse_` or `session_`.
 * 
 * A remote-controlled session registers a `bridgeSessionId` with the relay — `session_…` for
 * interactive RC sessions, `cse_…` on the bridged background record. It is recorded in both the
 * live registry and the transcript.
 *
 * The transcript's copy is a `bridge-session` entry — `{sessionId, bridgeSessionId, lastSequenceNum, ownerAccountUuid, ownerOrganizationUuid}`
 * — and it is the authoritative record of that transcript's own* bridge id. A `session_…` string
 * found anywhere else in a transcript is a mention of someone else's session, which is common:
 * one transcript here cites another instance's id three times as often as its own.
 * 
 * The two prefixes wrap the same body — `cse_01LJzLvMq38HpVKPMciPnDja` and
`session_01LJzLvMq38HpVKPMciPnDja` are one id — so the transcript entry and the
claude.ai URL convert by prefix swap.
 *
 * **Neither side is a key.** Measured over 1,903 transcripts: 176 were ever bridged
 * (9%); of those, 173 carry one bridge id and 3 carry two — the `/rc` toggle and
 * resume case below. In the other direction 161 ids map to one transcript and 9 map
to two, which is what `--fork-session` looks like from the id's side. Any index
over this needs an edge table, not a foreign key.
 * 
 * **A resumed session reuses the stored bridge id, and the relay will not accept a second
 * claim on one it still holds.** Resuming a conversation whose bridge id belonged to a process
 * that was just killed produces a session that looks healthy locally — RC reports active, the
 * pane is idle at the prompt — while every message sent from the app hangs forever.
 *
 * Resume with `--fork-session` to avoid it: forking mints a new `sessionId` and therefore a new
 * bridge id, while carrying the conversation history over. Check which one you got before
 * handing out the URL:
 * 
 * ```bash
 * python3 -c "import json;print(json.load(open('$HOME/.claude/sessions/<pid>.json'))['bridgeSessionId'])"
 * ```
 * 
 * The old URL dies with the old bridge id — reopen the session from the app's list rather than the stale link.
 */
import { z } from 'zod';

export const UntaggedBridgeSessionIdSchema = z.string().meta({ example: '01LJzLvMq38HpVKPMciPnDja' });

export const InfraSessionTagSchema = z.literal('cse_');
export const UrlSessionTagSchema = z.literal('session_');

/**
 * Expected by endpoints such as `/v1/code/sessions/{id}/worker/`.
 */
export const InfraSessionIdSchema = z.templateLiteral([InfraSessionTagSchema, UntaggedBridgeSessionIdSchema]);

/**
 * @see [Git commit attribution trailers](https://code.claude.com/docs/en/settings-reference#attribution-sessionurl) (retrieved 2026-09-10)
 * @see [`claude remote-control --session-id`](https://code.claude.com/docs/en/remote-control#resume-sessions-after-stopping-the-server) (retrieved 2026-09-10)
 * @see {SessionUrlSchema} - Used for endpoints starting with `https://claude.ai/code/`.
 */
export const UrlSessionIdSchema = z.templateLiteral([UrlSessionTagSchema, UntaggedBridgeSessionIdSchema]);

/**
 * Claude Code sets this as the value for the `CLAUDE_CODE_BRIDGE_SESSION_ID` environment variable for Remote Control enabled sessions.
 */
export const BridgeSessionIdSchema = z.union([InfraSessionIdSchema, UrlSessionIdSchema]).meta({
  id: 'ClaudeCodeBridgeSessionIdSchema'
});

/**
 * URL for linking to cloud and Remote Control sessions.
 * 
 * @see https://code.claude.com/docs/en/cloud-environments#link-output-back-to-the-session
 */
export const SessionUrlSchema = z.templateLiteral([
  z.literal('https://claude.ai/code/'),
  UrlSessionIdSchema,
]);

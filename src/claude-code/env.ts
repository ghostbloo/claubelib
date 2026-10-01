import { SessionUuidSchema } from "./projects";
import { InfraSessionIdSchema, BridgeSessionIdSchema } from "./bridge";

/**
 * Quoted docblocks below are pasted VERBATIM from Anthropic's env-var docs
 * (the `@see` link on each) — don't edit the quotes to match local usage;
 * re-retrieve and update the retrieval date instead.
 *
 * Gotcha the quotes bury: `CLAUDE_CODE_REMOTE_SESSION_ID` is `cse_`-form
 * (infra), never the `session_`-form seen in claude.ai trailer URLs — the
 * cloud docs' own link recipe does the prefix swap:
 * `${CLAUDE_CODE_REMOTE_SESSION_ID/#cse_/session_}`. We don't use cloud
 * environments (as of 2026-09), so that var is a distinction to watch for,
 * not a surface we exercise.
 */
export const ClaudeCodeEnvVars = {
  /**
   * Transcript UUID.
   * 
   * @see {SessionUuidSchema}
   */
  'CLAUDE_CODE_SESSION_ID': SessionUuidSchema,
  /**
   * "Set automatically in Bash tool and hook command subprocesses while the session has an active [Remote Control](https://code.claude.com/docs/en/remote-control) connection, and removed when the connection ends. The value is the session’s ID in `session_` form, the same identifier that appears in the session’s `claude.ai/code` URL, so a script can link back to the session that ran it. Requires Claude Code v2.1.199 or later. In [cloud sessions](https://code.claude.com/docs/en/claude-code-on-the-web), read `CLAUDE_CODE_REMOTE_SESSION_ID` instead"
   * 
   * @see https://code.claude.com/docs/en/env-vars Last retrieved: 2026-09-05
   */
  'CLAUDE_CODE_BRIDGE_SESSION_ID': BridgeSessionIdSchema,
  /**
   * "Set automatically in [cloud sessions](https://code.claude.com/docs/en/claude-code-on-the-web) to the current session’s ID. Read this to construct a link back to the session transcript. See [Link output back to the session](https://code.claude.com/docs/en/cloud-environments#link-output-back-to-the-session)"
   * 
   * @see https://code.claude.com/docs/en/env-vars Last retrieved: 2026-09-05
   */
  'CLAUDE_CODE_REMOTE_SESSION_ID': InfraSessionIdSchema,
} as const;

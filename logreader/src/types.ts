/**
 * Subset of the PRD §6 interaction record that the agent *logs* can supply.
 * Read-only spike: this is what we can recover from on-disk session logs, no
 * more. Fields the logs cannot give (e.g. SSO identity) are left out here.
 */
export interface LoggedInteraction {
  agent: 'claude_code' | 'opencode';
  /** Authoritative model id from the log (§4.2), or null if absent. */
  model: string | null;
  /** First user prompt text of the turn, or null. */
  prompt: string | null;
  workspace: string | null;
  gitBranch: string | null;
  sessionId: string | null;
  timestamp: string | null;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreate: number;
  };
  /** Where this record came from, and how trustworthy the parse is. */
  source: string;
  confidence: 'authoritative' | 'inferred';
}

export function emptyTokens(): LoggedInteraction['tokens'] {
  return { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
}

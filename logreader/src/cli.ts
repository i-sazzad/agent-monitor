/**
 * Node CLI runner for the log-reader spike (so it can be verified without VS
 * Code). Read-only: prints a summary to stdout, stores/sends nothing. Prompt
 * text is truncated in output to keep the spike from echoing full content.
 *
 *   node out/cli.js
 */
import { readAllClaudeSessions } from './claude';
import { readAllOpencodeSessions } from './opencode';
import { LoggedInteraction } from './types';

function summarize(label: string, rows: LoggedInteraction[]): void {
  console.log(`\n=== ${label}: ${rows.length} session(s) ===`);
  for (const r of rows.slice(0, 10)) {
    const tok = r.tokens;
    const promptPreview = r.prompt ? r.prompt.slice(0, 60).replace(/\s+/g, ' ') : '(none)';
    console.log(
      `[${r.confidence}] model=${r.model ?? '?'} ` +
        `tok(in/out/cacheR/cacheC)=${tok.input}/${tok.output}/${tok.cacheRead}/${tok.cacheCreate} ` +
        `branch=${r.gitBranch ?? '-'} prompt="${promptPreview}..."`
    );
  }
  if (rows.length > 10) {
    console.log(`  ... and ${rows.length - 10} more`);
  }
}

function main(): void {
  const claude = readAllClaudeSessions();
  const opencode = readAllOpencodeSessions();
  summarize('Claude Code (verified format)', claude);
  summarize('OpenCode (best-effort, unverified)', opencode);
  console.log('\nNothing was stored or sent. Prompt previews are truncated.');
}

main();

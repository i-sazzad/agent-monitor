# Log-Reader Spike — Findings

Follow-up to [../spike/FINDINGS.md](../spike/FINDINGS.md). Answers the second
recommended spike: *can we read Claude Code's / OpenCode's session logs to recover
the things the terminal alone cannot — full prompt text and authoritative model
ID (and, it turns out, token counts)?*

## What this spike is

A read-only reader for the two agents' on-disk session logs. No backend, no
storage, no network — same property as the terminal spike. Parsed records are
printed to an output channel (VS Code) or stdout (CLI) and then discarded; prompt
text is truncated in output.

Run it:
```bash
cd logreader
npm install
npm run compile
npm run cli          # parses your real local logs, prints a summary
# or open logreader/ in VS Code → F5 → click "$(book) Agent Log Reader (spike)"
```

## Findings

### Claude Code — VERIFIED ✅

Logs live at `~/.claude/projects/<project-slug>/<sessionId>.jsonl`, one JSON
object per line. Running the spike on this machine parsed **17 real sessions** and
recovered, per session:

- **Authoritative model id** — e.g. `claude-opus-4-8`, `claude-sonnet-4-6`
  (satisfies §4.2 "authoritative" model detection — no heuristics needed).
- **Full token usage** — `input_tokens`, `output_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens`. Richer than the PRD
  assumed; enables real cost analysis incl. cache effects.
- **Prompt text** — the user message content (§4.1).
- **Context** — `cwd` (workspace), `gitBranch`, `sessionId`, `timestamp`,
  `version`, `promptSource`.

So the three things the terminal spike said it could NOT get are all here.

### OpenCode — UNVERIFIED ⚠️

OpenCode is **not installed** on the spike machine (no binary on PATH, no data in
any XDG path). The reader (`src/opencode.ts`) is written defensively against
expected layouts but **must be confirmed against a real install** before use. It
returned 0 sessions here, as expected. This is the one open item.

## Limits / notes to carry forward

- **Per-machine, in the user's home dir.** Capture means reading each engineer's
  local logs. This makes the §7 transparency/consent requirement mandatory, not
  optional.
- **Some records have no model** (`?`) or a `<synthetic>` model marker (e.g.
  empty/aborted sessions, internal turns). Filter these out when aggregating.
- **Slash-command / injected prompts** appear in the stream (e.g. text beginning
  `<local-command-caveat>` / `<command-message>`). A real capture path should skip
  or tag these so they don't pollute task classification.
- **Secret redaction not done here** (out of scope for this spike — it was scoped
  to log reading only). Prompts can contain credentials; redact before any storage.
- Session is rolled up into one interaction (first prompt + summed tokens). Switch
  to per-turn if the analytics need finer granularity.

## Recommendation

Claude Code log reading is a **solid, authoritative data source** — it unblocks
prompt text, model ID, and token counts for that agent today. The remaining
prerequisite before building any ingestion/storage is to **confirm OpenCode's log
format on a real install** and finish `src/opencode.ts` against it.

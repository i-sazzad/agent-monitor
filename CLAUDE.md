# CLAUDE.md

Guidance for Claude Code (and future sessions) working in this repo.

## What this project is

An **internal** tool to observe how the engineering team uses its two AI coding
agents — **Claude Code** (for critical/complex work) and **OpenCode** (a
Chinese-hosted model, for routine work). The product is a VS Code extension plus a
backend that captures agent interactions, classifies task complexity, and reports
**aggregate usage trends** to leadership.

### Scope guardrail (important — do not drift from this)

This is **monitoring and analytics only**. It must **never** flag, score, warn,
block, or take punitive action against an individual engineer. There is no policy
engine and no enforcement phase, in v1 or later. When extending the product, keep
every feature on the "observe and report in aggregate" side of that line. The one
feature that touches an engineer's workflow — the optional agent *suggestion*
(§4.6) — is advisory, dismissible, defaults **off**, and following/ignoring it is
never recorded as compliance or a violation.

See [AI_Agent_Monitoring_PRD.md](AI_Agent_Monitoring_PRD.md) for the full spec.

## Repository layout

- `AI_Agent_Monitoring_PRD.md` — the product requirements document (the source of
  truth for scope). Monitoring-only; v1.1.
- `spike/` — feasibility spike answering PRD §10 Q1 (can we hook the agents?).
  Self-contained VS Code extension, **no backend, no storage, no network**. See
  [spike/FINDINGS.md](spike/FINDINGS.md) for results.

Nothing else is built yet. The backend (ingestion API, classification service,
analytics/aggregation, data store, dashboard) described in PRD §5 is not started.

## Key findings so far (from the spike)

The realistic v1 hook point is the **VS Code integrated terminal**, not a clean
agent API — both agents run as terminal CLIs. `onDidStartTerminalShellExecution`
(stable since VS Code 1.93) reliably captures agent **invocations and output
volume**, but **not**:
- full **interactive prompt text** typed inside a running agent TUI (needs an
  agent-side log/config source), or
- the **model identity** (terminal sees the agent, not the model).

Two follow-up spikes are recommended in `spike/FINDINGS.md`: measure
shell-integration coverage, and read agent session logs for prompt text + model ID.

## Working on the spike

```bash
cd spike
npm install
npm run compile      # tsc; must stay clean
# then open spike/ in VS Code and press F5 to launch the Extension Host
```

- Target VS Code engine: `^1.93.0` (for the stable shell-execution API).
- TypeScript strict mode is on — keep it compiling clean.
- The spike intentionally retains/sends nothing; preserve that property unless the
  task is explicitly to add a backend.

## Conventions

- Windows host; Git normalizes LF→CRLF on checkout (the warning is benign).
- Match the existing doc's monitoring-only framing in any PRD edits.

# Feasibility Spike — Findings

Addresses **§10 Q1** of the PRD: *Do Claude Code and OpenCode expose stable APIs the
extension can hook, or is terminal/log parsing required?*

## What this spike is

A minimal VS Code extension (no backend, no storage, no network) that instruments
the integrated terminal and logs what is observable when an AI agent CLI runs. It
exists to prove or disprove the core capture premise before any further build.

Run it: open `spike/` in VS Code → **F5** ("Run Spike") → in the Extension Host
window run `claude` or `opencode` in an integrated terminal → click the
`$(eye) Agent Monitor (spike)` status-bar item to see the capture log.

## Findings

1. **Both agents are terminal CLIs.** The installed `anthropic.claude-code`
   extension launches `claude` in an integrated terminal; OpenCode is the same shape.
   There is no clean, documented "agent event API" to subscribe to in v1. So the
   realistic hook point is the terminal — confirming the PRD's framing that this is
   the highest technical risk.

2. **The terminal shell-integration API is available and stable.**
   `window.onDidStartTerminalShellExecution` and `TerminalShellExecution.read()` are
   stable since VS Code 1.93 (we target 1.93+; local VS Code is 1.124). The spike
   compiles against the real `@types/vscode` and uses them directly — they are not
   proposed APIs.

3. **What we CAN capture this way:**
   - The command line that started the agent (e.g. `claude "fix the auth bug"`),
     with a `confidence` level telling us whether VS Code parsed it (High) or
     inferred it.
   - The full streamed output of the execution (for response metadata: byte/token
     volume, duration, success/error).
   - Terminal name, timestamp, and — combined with SSO — the authenticated user.

## Limits found (feed these back into the PRD)

- **Capture depends on shell integration being active.** If the user's shell lacks
  VS Code shell integration, command-line `confidence` drops and `read()` may yield
  nothing. Coverage (§8, target >95%) is therefore shell/OS dependent and must be
  measured, not assumed.
- **Interactive (TUI) prompts are not on the command line.** When an agent is run
  interactively and the engineer types prompts *inside* the running TUI, those
  prompts are not in the launching command line. Capturing them means parsing the
  output stream (brittle) or getting cooperation from the agent (an API/log file).
  → This sharpens §10 Q1: terminal hooking reliably captures *invocations and
  output volume*, but **full interactive prompt text** likely needs an agent-side
  source (config-pointed log file, or an official hook).
- **No model identity from the terminal alone.** The launch command rarely names the
  model, so §4.2 "authoritative" model detection still needs to read agent/session
  config or metadata — terminal capture gives the agent, not the model.

## Recommendation

Terminal shell-execution hooking is a **viable Phase 1 foundation** for capturing
agent invocations and response volume. Before committing, run two follow-ups:
1. Measure shell-integration coverage across the team's actual shells/OSes.
2. Spike reading Claude Code's / OpenCode's session log or config to recover full
   interactive prompt text and authoritative model ID — the two things the terminal
   alone cannot give.

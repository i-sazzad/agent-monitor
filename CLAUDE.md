# CLAUDE.md

Guidance for Claude Code (and future sessions) working in this repo.

## What this project is

An **internal** tool to observe how the engineering team uses its two AI coding
agents — **Claude Code** (for critical/complex work) and **OpenCode** (a
Chinese-hosted model, for routine work). It captures agent interactions, classifies
task complexity, and reports **aggregate usage trends** to leadership via a web
dashboard.

### Scope guardrail (important — do not drift from this)

This is **monitoring and analytics only**. It must **never** flag, score, warn,
block, or take punitive action against an individual engineer. There is no policy
engine and no enforcement phase, in v1 or later. When extending the product, keep
every feature on the "observe and report in aggregate" side of that line.

See [AI_Agent_Monitoring_PRD.md](AI_Agent_Monitoring_PRD.md) for the full spec.

## Repository layout

```
backend/      Node.js + SQLite server (port 4319)
  src/        TypeScript source (auth, config, db, server)
  public/     Dashboard UI (index.html, coder.html, chart.min.js)
  Dockerfile

monitor/      Standalone capture agent — drop on any coder's machine
  agent.js          Zero-dependency Node.js capture script
  agent.env.example Config template (copy to .env)
  start.sh / start.bat   Cron / Task Scheduler launchers
  setup-terminal-hook.sh Shell hook installer for terminal-only users

AI_Agent_Monitoring_PRD.md   Product requirements (source of truth)
docker-compose.yml
```

## How the capture works

`monitor/agent.js` is a **zero-npm-dependency** Node.js script. Each coder (or
their admin) drops it in any folder alongside a `.env` file:

```
INGEST_URL=http://<server>:4319
INGEST_TOKEN=<token>
CODER_NAME=<name>
CLAUDE_ACCOUNT_EMAIL=<optional>
```

On each run it:
1. Reads Claude Code session JSONL logs (`~/.claude/projects/**/*.jsonl`) — one
   interaction per **user turn** (not per session file).
2. Reads OpenCode session logs.
3. Runs `git diff --numstat HEAD` in the current workspace for file-change data.
4. POSTs new interactions to the backend `/ingest` endpoint.

Run manually, via cron (Linux/macOS), or Task Scheduler (Windows). For coders who
only use the CLI, `setup-terminal-hook.sh` wraps the `claude`/`opencode` commands
to auto-trigger a capture after each session.

## Backend

```bash
cd backend
npm install
npm run build    # tsc → out/
node out/server.js
# or: docker compose up
```

- SQLite database at `backend/data/monitor.db` (created on first run).
- Environment variables in `.env` at repo root (see `.env.example`).
- Dashboard at `http://localhost:4319` (login with ADMIN_TOKEN).

## Conventions

- Windows host; Git normalizes LF→CRLF on checkout (the warning is benign).
- Match the existing doc's monitoring-only framing in any PRD edits.
- `monitor/agent.js` must remain zero-dependency (no `require()` of npm packages).

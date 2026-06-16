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

## Repository layout

```
backend/      Node.js + SQLite server (port 4319)
  src/        TypeScript source (auth, config, db, server)
    auth.ts       Cookie-based session auth (SameSite=Strict HttpOnly)
    config.ts     LIMITS config (CLAUDE/OPENCODE daily/weekly env vars)
    db.ts         better-sqlite3 queries (summaryByCoder, tokensByModel, etc.)
    server.ts     HTTP server, API routes, ingest endpoint
  public/     Dashboard UI
    index.html    Main dashboard (KPIs, charts, coder table)
    coder.html    Coder detail page (tokens, daily activity, projects, file changes)
    chart.min.js  Chart.js (bundled)
  Dockerfile

monitor/      Standalone capture agent — drop on any coder's machine
  agent.js          Zero-dependency Node.js capture script
  agent.env.example Config template (copy to .env)
  start.sh          Cron launcher (Linux/macOS)
  start.bat         Task Scheduler launcher (Windows)
  setup-terminal-hook.sh  Shell hook installer for terminal-only users

docker-compose.yml
.env.example       Root env template (INGEST_TOKEN, ADMIN_TOKEN, limits, etc.)
```

## How the capture works

`monitor/agent.js` is a **zero-npm-dependency** Node.js script. Each coder (or
their admin) drops it in any folder alongside a `.env` file:

```
INGEST_URL=http://<server>:4319
INGEST_TOKEN=<token>
CODER_NAME=<name>
CLAUDE_ACCOUNT_EMAIL=<optional>
OPENCODE_ACCOUNT_EMAIL=<optional>
```

On each run it:
1. Reads Claude Code session JSONL logs (`~/.claude/projects/**/*.jsonl`) — one
   interaction per **user turn** (not per session file).
2. Reads OpenCode session logs from its SQLite DB (`~/.local/share/opencode/opencode.db`
   on Linux, `C:\Users\<name>\.local\share\opencode\opencode.db` on Windows) using
   a **pure-JS SQLite binary parser** (no external tools needed).
3. Runs `git diff --numstat HEAD` in the current workspace for file-change data,
   tagged per agent.
4. POSTs new interactions to the backend `/ingest` endpoint (deduped by interaction_id).

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

## Key API endpoints

| Endpoint | Description |
|---|---|
| `POST /ingest` | Receive interactions from agent.js (Bearer token auth) |
| `GET /api/report` | Coder summary table data |
| `GET /api/tokens` | Token spend by model |
| `GET /api/activity` | Daily activity timeline |
| `GET /api/complexity` | Task class breakdown |
| `GET /api/coder/:name` | Full drilldown for one coder |
| `GET /api/limits` | Shared account limit config + per-coder usage |

All dashboard APIs require session cookie auth (`/login` → `POST {token}`).

## Data flow

```
agent.js (coder's PC) → POST /ingest → interactions table → dashboard APIs → browser
```

Each row in `interactions` is one user prompt turn, with: `coder`, `agent`
(`claude_code` | `opencode`), `model`, `workspace`, `session_id`, `prompt`
(truncated), `task_class` (`simple`/`moderate`/`critical`), token counts,
git branch, and timestamp.

## Coder detail page — KPI card order

Projects → Sessions → Prompts → Input tokens → Output tokens

- **Sessions** = `COUNT(DISTINCT COALESCE(session_id, interaction_id))` per day (not prompt count)
- **Prompts** = `COUNT(*)` per day (every user turn)
- Token table excludes rows where model IS NULL and all token counts are zero
  (interrupted sessions where Claude never responded)

## Conventions

- Windows host; Git normalizes LF→CRLF on checkout (the warning is benign).
- `monitor/agent.js` must remain zero-dependency (no `require()` of npm packages).
- IP filtering: only `192.168.x.x` addresses stored/displayed.

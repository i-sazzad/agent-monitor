# Agent Monitor

Internal dashboard for observing how your engineering team uses AI coding agents — **Claude Code** and **OpenCode** — across all their projects. Captures usage in the background, classifies task complexity, and shows aggregate trends in a web UI.

> **Monitoring only.** No flagging, scoring, or enforcement of individual engineers — ever.

---

## What it tracks

- Sessions and prompts per coder, per agent, per project
- Token consumption by model (input / output / cache)
- Task complexity classification (simple / moderate / critical)
- Which files each agent modified (`git diff --numstat`)
- Daily and weekly activity timelines

## Architecture

```
┌─────────────────────┐        ┌──────────────────────────┐
│  Coder's PC         │        │  Server (Docker)         │
│                     │        │                          │
│  monitor/agent.js   │──POST──▶  backend (Node + SQLite) │
│  (runs every 15min) │        │  port 4319               │
└─────────────────────┘        └────────────┬─────────────┘
                                            │
                                     browser dashboard
```

- **agent.js** — zero-npm-dependency capture script, reads Claude Code JSONL logs and OpenCode SQLite DB, POSTs to the backend
- **backend** — TypeScript + better-sqlite3, serves the dashboard and ingest API
- **Dashboard** — main view (KPIs + charts + coder table) + per-coder drilldown

## Quick start

### 1. Run the backend

```bash
cp .env.example .env
# Fill in INGEST_TOKEN and ADMIN_TOKEN
docker compose up -d
```

Dashboard → `http://<server>:4319` (login with `ADMIN_TOKEN`)

### 2. Deploy the capture agent

On each coder's machine, copy `monitor/` and create a `.env`:

```
INGEST_URL=http://192.168.x.x:4319
INGEST_TOKEN=<same token as backend>
CODER_NAME=alice
CLAUDE_ACCOUNT_EMAIL=alice@company.com
OPENCODE_ACCOUNT_EMAIL=alice@company.com
```

**Windows** — run `start.bat` once to test, then add it to Task Scheduler (every 15 min).

**Linux/macOS** — run `start.sh` once to test, then add to cron:
```
*/15 * * * * /path/to/monitor/start.sh
```

**Terminal hook** (optional) — auto-captures after each `claude` or `opencode` session:
```bash
bash monitor/setup-terminal-hook.sh
```

### 3. (Optional) Set shared account limits

In `.env`, set the daily/weekly session limits for your Claude and OpenCode accounts:

```
CLAUDE_DAILY_LIMIT=50
CLAUDE_WEEKLY_LIMIT=200
OPENCODE_DAILY_LIMIT=100
OPENCODE_WEEKLY_LIMIT=500
```

## Dashboard pages

### Main dashboard (`/`)
- KPI cards: active coders, projects, sessions, tokens, complexity signal
- Activity timeline, model distribution, task complexity, agent breakdown
- Coder table with sessions, prompts, token spend, IPs — click any row for drilldown

### Coder detail (`/coder.html?coder=name`)
- Token spend by model
- Daily activity table
- Projects with file-change breakdown (which agent modified which file)
- Full prompt history (date-filtered)

## Environment variables

| Variable | Description |
|---|---|
| `INGEST_TOKEN` | Secret token agents use to POST data |
| `ADMIN_TOKEN` | Dashboard login token |
| `RETENTION_DAYS` | How many days of data to keep (default 90) |
| `CLAUDE_DAILY_LIMIT` | Claude account daily session limit |
| `CLAUDE_WEEKLY_LIMIT` | Claude account weekly session limit |
| `OPENCODE_DAILY_LIMIT` | OpenCode account daily session limit |
| `OPENCODE_WEEKLY_LIMIT` | OpenCode account weekly session limit |

## OpenCode support

agent.js reads OpenCode's SQLite database directly using a **built-in pure-JS parser** — no `sqlite3` CLI or npm packages required. It parses the binary `.db` and `.db-wal` files and extracts sessions, prompts, model info, and token counts.

Default DB paths:
- Linux: `~/.local/share/opencode/opencode.db`
- Windows: `C:\Users\<name>\.local\share\opencode\opencode.db`
- Snap: `~/snap/opencode/current/.local/share/opencode/opencode.db`

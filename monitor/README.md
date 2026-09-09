# Agent Monitor — Capture Agent

Drop this folder on your machine to report your Claude Code / OpenCode usage
to the team dashboard. It's a single zero-dependency script (`agent.js`) —
no npm install needed, just Node.js.

Everything it reads (session logs, file diffs) stays local except the
summarized data it POSTs to the monitor backend.

## 1. Requirements

- [Node.js](https://nodejs.org) installed and on your `PATH`.
- The monitor backend URL and an ingest token (ask your admin).

## 2. Set up `.env`

Copy the example and fill it in:

```bash
cp env.example .env
```

```
INGEST_URL=http://<server>:4319
INGEST_TOKEN=<token from your admin>
CODER_NAME=<your name>              # optional, defaults to OS username
TEAM_NAME=<your team>               # optional
CLAUDE_ACCOUNT_EMAIL=<you@company>  # optional
OPENCODE_ACCOUNT_EMAIL=<you@company>  # optional
```

`.env` must sit right next to `agent.js`.

## 3. Install it (do this first)

This registers the capture to run automatically at login/boot and every
15 minutes after that — you don't babysit it.

**Windows** — run `install.bat`. Registers two Task Scheduler entries
(`AgentMonitorLogon`, `AgentMonitor`). Uninstall with `uninstall.bat`.

**Linux / macOS**

```bash
bash install.sh
```

Uses a systemd user timer if available, otherwise falls back to cron
(`@reboot` + every 15 min). Uninstall with `bash uninstall.sh`.

## 4. Verify it worked

Run it once by hand and confirm it reports data.

**Windows** — double-click `start.bat` (or run it from a terminal). It runs
the capture once and shows the last log lines.

**Linux / macOS**

```bash
bash start.sh
```

You should see something like:

```
[2026-09-09T08:06:18.733Z] coder="you" prompts=447
Sent: received=447, newly stored=447
```

If it errors with "Set INGEST_URL and INGEST_TOKEN in .env", your `.env`
wasn't found or is missing values.

## 5. CLI-only workflow? Add the terminal hook (Linux/macOS only)

There's no Windows equivalent of this step — on Windows, step 4's 15-minute
Task Scheduler timer is what covers CLI-only usage.

If you mostly live in a terminal and don't want to wait for the 15-minute
timer, `setup-terminal-hook.sh` wraps your `claude` and `opencode` shell
commands so a capture fires automatically right after each session:

```bash
INGEST_URL=http://<server>:4319 \
INGEST_TOKEN=<token> \
CLAUDE_ACCOUNT_EMAIL=you@company.com \
bash setup-terminal-hook.sh

source ~/.bashrc   # or ~/.zshrc
```

Use this **in addition to** `install.sh`, not instead of it — the timer
still catches sessions run outside the terminal (e.g. via an IDE).

## What it actually captures

- Claude Code session logs (`~/.claude/projects/**/*.jsonl`) — one entry per
  user prompt turn.
- OpenCode session logs from its local SQLite DB.
- `git diff --numstat HEAD` in the current workspace, tagged per agent.

Runs are deduped server-side by `interaction_id`, so running it repeatedly
(manually, via the timer, and via the terminal hook) never double-counts.

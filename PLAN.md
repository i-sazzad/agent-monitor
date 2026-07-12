# Agent Monitor — Review Findings & Roadmap

Reviewed: backend (`server.ts`, `db.ts`, `auth.ts`), capture agent (`monitor/agent.js`),
launchers, dashboard, spike folders. Date: 2026-07-09.

> Scope guardrail applies to everything below: **monitoring and aggregate reporting
> only** — no flagging, scoring, or enforcement against individual engineers.

Note: the VS Code suggestion extension (`suggest/`) and the finished feasibility
spikes (`spike/`, `logreader/`) have been removed from the repo — no longer needed.
Their code and findings remain available in git history.

---

## Part 1 — Gaps in the current implementation

### Capture agent (`monitor/agent.js`)

1. **No incremental capture state.** Every run re-reads and re-parses *all* Claude
   JSONL files and the whole OpenCode DB, and POSTs the complete history every time.
   Dedup only happens server-side (`INSERT OR IGNORE`). Payloads grow unbounded and
   will eventually hit the backend's 50 MB body cap; runs get slower every week.
   Fix: local `state.json` watermark (per-file byte offset / last-seen timestamp)
   so only new interactions are sent.
2. **File-change data is weak and double-counted.** `gitDiffStat()` snapshots the
   *current* uncommitted diff at capture time and attaches the same diff to **every**
   interaction in that workspace. The backend then sums it across interactions
   (`fileChangesByProject`), so added/removed line counts are inflated by roughly
   (number of prompts × same diff). The diff also reflects "now", not what the agent
   actually touched. See Phase 1, item 1 for the proper fix.
3. **Prompt truncation is claimed but not implemented.** CLAUDE.md says prompts are
   truncated; agent.js sends the full redacted prompt and the backend stores it
   verbatim. Enforce truncation (e.g. 2,000 chars) server-side.
4. **No retry / offline queue / heartbeat.** If the server is down the run just
   fails (data isn't lost since logs persist, but nobody knows a machine went
   silent). No "agent last seen" signal → coverage gaps are invisible.
5. **OpenCode token skew.** Session-level tokens are assigned entirely to the first
   message of each session, distorting daily token charts.
6. **No agent version field** in the payload — can't tell which machines run stale
   agents once updates ship.
7. Minor: only the first OpenCode DB found is read; only `192.168.*` IPv4 captured
   (VPN/other-subnet machines report no IP); classifier is naive keyword counting
   baked into the agent — improving it requires redeploying every machine.

### Backend

8. **No input validation on `/ingest`** — any JSON shape with the right token is
   inserted; a malformed record can throw mid-transaction. No rate limiting on
   `/login` (admin token is brute-forceable).
9. **Sessions are in-memory** — every backend restart logs all viewers out.
10. **`access_log` is never pruned**, unlike interactions.
11. **N+1 queries** in `summaryByCoder` (3 extra queries per coder per request) —
    fine at 10 coders, will hurt at 100.
12. **No tests, no CI, no lint** anywhere in the repo.
13. **No SQLite backup strategy** — `monitor.db` is the single copy of all data.
14. Drilldown hard-capped at 200 rows with no pagination.

### Repo hygiene

15. ~~`spike/` and `logreader/` contain committed build output.~~ **Done** — both
    folders removed (superseded experiments; recoverable from git history).
16. README/CLAUDE.md still reference `agent.env.example` but the file was renamed
    to `env.example` — docs drift.

---

## Part 2 — Roadmap

### Phase 1 — Requested features

**1. Authoritative per-agent project/file tracking**
Replace the git-diff heuristic with the real source of truth:
- Claude Code JSONL contains every `tool_use` block — `Edit`, `Write`, `MultiEdit`,
  `NotebookEdit` calls include the exact `file_path` modified; `Read`/`Grep` show
  files consulted. Parse these per user-turn.
- OpenCode's `part` table similarly stores tool-call parts with file paths.
- New `file_events` table:
  `(interaction_id, workspace, file, action: read|edit|write|create, agent, ts)` —
  exact, per-prompt, no double counting.
- Dashboard: a **Projects page** (project → files touched → per-agent edit counts,
  hot files, Claude-vs-OpenCode split per file) and a "Files worked on" section on
  the coder detail page.
- Keep git-numstat only as a line-count-magnitude fallback, deduped per session
  instead of per prompt.

**2. Run-at-startup installers for start.bat / start.sh**
- **Windows:** `install.bat` (or `.ps1`) registering Task Scheduler entries via
  `schtasks`: *At logon* trigger + *every 15 min* repetition, running a new
  non-interactive `run.bat` (current `start.bat` ends in `pause`, which hangs
  scheduled runs — split into interactive `start.bat` + silent `run.bat`).
  Plus `uninstall.bat`.
- **Linux/macOS:** `install.sh` installing a systemd **user timer**
  (`OnBootSec=2min` + `OnUnitActiveSec=15min`) with cron fallback
  (`@reboot` + `*/15`); macOS gets a `launchd` plist. Plus `uninstall.sh`.
- Installer verifies Node presence, validates `.env`, and does a test POST before
  registering.

**3. Heartbeat & agent health** (pairs with #2)
- Agent POSTs a tiny `/heartbeat` (coder, agent version, hostname, last-run status)
  each run.
- Dashboard "Fleet" panel: per-machine last-seen, agent version, stale-agent
  warning — verifies the startup tasks from #2 actually work everywhere.

**4. Team tagging via agent env**
- New `TEAM_NAME` variable in `monitor/.env` (and `env.example`); agent includes
  `team` in every ingest record.
- Backend: `team` column on `interactions` (nullable for old rows); shown as a
  filter on the dashboard alongside the coder filter.
- The env value is the default tag; the authoritative coder→team mapping lives in
  the DB (see #5) so a mis-set env on one machine can be corrected centrally.

**5. Two admin roles: Super Admin & Team Lead**
- **Super Admin** — sees all coders' data (current behavior).
- **Team Lead** — sees only coders assigned to their team; every API response is
  filtered server-side, and drilldown for another team's coder returns 403.
- Schema (managed by direct DB edits — explicitly **no user/team management UI**):
  - `teams (id, name)`
  - `users (id, name, token_hash, role 'super_admin' | 'team_lead', team_id)`
  - `coder_teams (coder, team_id)` — authoritative mapping; rows whose env
    `TEAM_NAME` disagrees fall back to this table.
  - Seeded via `sqlite3` inserts or a small `scripts/add-user.js` CLI helper
    (still no UI).
- Auth changes (`auth.ts`): `POST /login {token}` looks the token hash up in
  `users` instead of comparing to the single `ADMIN_TOKEN`; the session carries
  `role` + `team_id`. `ADMIN_TOKEN` from env is kept as a bootstrap super-admin
  fallback so the first login works on an empty DB.
- Enforcement lives in one place: the shared `where()` filter in `db.ts` gains an
  allowed-coders constraint derived from the session, so every existing query
  (report, tokens, activity, projects, file changes, drilldown) is scoped
  automatically. `/api/coders` and access logging become role-aware.
- Guardrail note: team leads see their own team's activity for awareness only —
  same no-scoring/no-enforcement rule applies.

### Phase 2 — Data quality & robustness

4. Incremental capture state in the agent (fixes gap 1) + retry with backoff.
5. Server-side ingest validation, prompt truncation, per-field length caps,
   `/login` rate limiting.
6. Move task classification server-side (agent sends raw prompt; backend
   classifies) so rules — or a later LLM/embeddings classifier — update in one
   place. Add a reclassify-all admin script.
7. Spread OpenCode session tokens across the session's days, or store them as
   session-level rows.
8. Nightly SQLite backup (`VACUUM INTO` a dated file, keep N days) + prune
   `access_log`.
9. Tests (ingest round-trip, JSONL/SQLite parsers against fixtures, query
   correctness) + GitHub Actions CI running build + tests.

### Phase 3 — Dashboard & reporting

10. **Cost estimation:** per-model price table (input/output/cache rates) →
    $ figures on token views; leadership cares about dollars more than tokens.
11. **Weekly digest export:** CSV/JSON export endpoints + a "last week summary"
    view (aggregate trends, model mix, project activity) fit for a leadership
    email; optionally SMTP cron.
12. **Model right-sizing view (aggregate only):** extend `simple_on_opus` into a
    team-level "task class × model" matrix — e.g. "18% of simple tasks ran on Opus
    this week" — explicitly *without* per-coder ranking.
13. Session duration metrics; pagination on drilldowns; date-range presets.

### Phase 4 — Future work: package agent as `.exe`

Recommended: **Node.js SEA (Single Executable Applications)** — `agent.js` is
already zero-dependency CommonJS, the ideal SEA candidate; no bundler needed.
- Build: `node --experimental-sea-config` → inject blob into a copied `node.exe`
  with `postject` → `agent-monitor.exe` (Linux/macOS binaries from the same config).
- Benefit: no Node install required on coders' machines (biggest current
  deployment friction); single file + `.env`.
- Plan items: CI job producing per-release builds; `--version` flag reported in the
  heartbeat (#3); self-update *check* (compare against a `/agent/latest` endpoint,
  print upgrade notice — no auto-update in v1); Windows SmartScreen/AV → code-signing
  cert or at minimum a published SHA256.
- Alternatives if SEA is problematic: `pkg` (unmaintained) or `bun build --compile`
  (extra toolchain) — SEA is the cleanest fit.
- Update the Phase 1 installers to point Task Scheduler/systemd at the exe instead
  of `node agent.js`.

### Phase 5 — Additional improvements (second review pass)

**Capture & freshness**
16. **Near-real-time capture via Claude Code hooks:** Claude Code supports
    lifecycle hooks (e.g. a `Stop` hook in `settings.json`) — the installer can
    register one that triggers `agent.js` immediately when a session/turn ends,
    instead of waiting for the 15-min timer. Polling stays as the fallback and
    covers OpenCode.
17. **Gzip the ingest payload** (`Content-Encoding: gzip` via built-in `zlib`) —
    cheap win while payloads are still full-history.
18. **Coder alias mapping:** `CODER_NAME` is free text; typos or renames split one
    person's history into two rows. Small server-side alias table + admin endpoint
    to merge identities.

**Insights (aggregate-safe)**
19. **Cache-efficiency view:** cache-read vs input token ratio per model/team —
    shows prompt-caching adoption and is the biggest hidden cost lever. Data is
    already captured, just never surfaced.
20. **Per-project cost attribution:** join the Phase 3 price table with the
    projects view → "cost per project per week", the number leadership actually
    asks for.
21. **Language/tech breakdown:** from Phase 1 `file_events`, aggregate by file
    extension → which languages/stacks each agent is used on.
22. **Tool-use analytics:** JSONL already records every tool call — aggregate
    which tools run (Edit/Bash/etc.), tool error rates, and interrupted turns;
    good proxy for where agents struggle (team-level only).
23. **Week-over-week deltas** on dashboard KPIs (prompts, tokens, cost, per
    agent) so trends are visible without exporting.
24. **Branch analytics:** `git_branch` is captured but never displayed — show
    branches-touched per project on the project page.

**Platform & operations**
25. **Alerts via webhook (Slack/Teams/email):** notify when (a) shared account
    usage nears the configured daily/weekly limits, (b) a machine's agent goes
    silent > N hours (builds on Phase 1 heartbeat), (c) ingest starts erroring.
26. **SSO (OIDC):** `auth.ts` already stubs the plug-in point — once Phase 1's
    `users` table exists, wire OIDC login to it (IdP group → `super_admin` /
    `team_lead` role) so tokens can be retired. Optionally add a read-only
    `viewer` role (aggregate views only, no prompt drilldown).
27. **Proper DB migrations:** replace the try/catch `ALTER TABLE` pattern with a
    numbered migration runner + `schema_version` pragma before the schema grows.
28. **Docker hardening:** healthcheck endpoint (`GET /healthz`), `restart:
    unless-stopped`, and a documented volume backup/restore procedure (pairs with
    the Phase 2 nightly backup).
29. **Prompt search (admin-only):** SQLite FTS5 index over prompts so admins can
    search the drilldown instead of paging through 200-row chunks.

### Housekeeping (anytime)

14. ~~Gitignore/archive spike build artifacts.~~ **Done** — spike folders removed.
15. Fix README/CLAUDE.md drift (`agent.env.example` → `env.example`); document the
    autostart installers once built.

---

**Suggested order:** Phase 1 items 1–3 first, then Phase 2 — especially incremental
capture and the file-change double-counting, since current file-change numbers on
the dashboard are materially wrong today. Phases 3–5 can follow independently; within
Phase 5 the quickest wins are the cache-efficiency view (19), WoW deltas (23), and
Docker hardening (28) — each is small and needs no new data capture.

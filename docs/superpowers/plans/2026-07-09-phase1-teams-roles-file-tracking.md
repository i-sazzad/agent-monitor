# Phase 1: Teams, Roles, File Tracking, Heartbeat & Autostart — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add team tagging, two dashboard roles (Super Admin / Team Lead), authoritative per-agent file tracking, an agent heartbeat, and run-at-startup installers to the Agent Monitor.

**Architecture:** The capture agent (`monitor/agent.js`, zero-dependency Node) gains a `TEAM_NAME` env, tool-use file-event extraction from Claude/OpenCode logs, and a heartbeat POST. The backend (Node + better-sqlite3, port 4319) gains `teams`/`users`/`coder_teams`/`file_events`/`heartbeats` tables, token-hash user login with role-scoped queries, and three new endpoints. Users and teams are managed by direct DB inserts / a tiny CLI script — **no management UI**.

**Tech Stack:** Node.js 20+, TypeScript (backend only), better-sqlite3, built-in `node:test` runner. No new npm dependencies anywhere.

## Global Constraints

- `monitor/agent.js` must remain **zero-npm-dependency** (built-in Node modules only).
- **Scope guardrail:** monitoring and aggregate reporting only — never flag, score, warn, block, or take punitive action against an individual engineer.
- No UI for creating/editing users or teams — DB inserts / CLI script only.
- Backend port stays `4319`. IP filtering stays `192.168.x.x` only.
- Role names are exactly `super_admin` and `team_lead`.
- Env var names are exactly: `TEAM_NAME` (agent), `MONITOR_DATA_DIR` (backend, tests only).
- Follow the existing schema-change pattern in `db.ts` (try/catch `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS`); do not introduce a migration framework.
- All commands below run from the repo root unless a `cd` is shown.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Backend test harness + data-dir override

The backend has no tests. Add a `node:test` harness and make the SQLite location overridable so tests use a temp directory.

**Files:**
- Modify: `backend/src/db.ts:6` (DATA_DIR line)
- Modify: `backend/package.json` (scripts)
- Test: `backend/test/ingest.test.js` (new)

**Interfaces:**
- Consumes: existing `ingestMany(rows: IngestRow[]): number`, `summaryByCoder(f?: Filters): CoderSummary[]` from `backend/src/db.ts`.
- Produces: env var `MONITOR_DATA_DIR` (directory for `monitor.db`); `npm test` script; `test/helpers.js` exporting `row(over)` — the fixture builder every later test imports.

- [ ] **Step 1: Make the data directory overridable**

In `backend/src/db.ts`, replace the line:

```ts
const DATA_DIR = path.join(__dirname, '..', 'data');
```

with:

```ts
const DATA_DIR = process.env.MONITOR_DATA_DIR ?? path.join(__dirname, '..', 'data');
```

- [ ] **Step 2: Add the test script**

In `backend/package.json`, inside `"scripts"`, add (keep existing scripts):

```json
"test": "npm run build && node --test test/"
```

- [ ] **Step 3: Create the shared test fixture helper**

Create `backend/test/helpers.js` (every test file uses this; it contains no tests itself):

```js
'use strict';
// Shared test fixtures. Note: node --test runs each test FILE in its own
// process, and MONITOR_DATA_DIR must be set before ../out/db.js is required.

function row(over = {}) {
  return Object.assign({
    interactionId: 'i-' + Math.random().toString(16).slice(2, 10),
    coder: 'alice',
    ips: ['192.168.1.2'],
    agent: 'claude_code',
    model: 'claude-opus-4-8',
    prompt: 'fix the bug',
    taskClass: 'moderate',
    taskConfidence: 0.3,
    workspace: '/repo',
    gitBranch: 'main',
    sessionId: 's1',
    timestamp: '2026-07-01T10:00:00.000Z',
    tokens: { input: 10, output: 20, cacheRead: 0, cacheCreate: 0 },
    modelConfidence: 'authoritative',
  }, over);
}

module.exports = { row };
```

- [ ] **Step 4: Write the first test**

Create `backend/test/ingest.test.js` exactly:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Must be set BEFORE requiring db.js — the module opens the DB at load time.
process.env.MONITOR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-test-'));
const db = require('../out/db.js');
const { row } = require('./helpers.js');

test('ingest stores rows and dedupes on interaction_id', () => {
  const r = row({ interactionId: 'fixed-1' });
  assert.equal(db.ingestMany([r]), 1);
  assert.equal(db.ingestMany([r]), 0); // duplicate ignored
  const summary = db.summaryByCoder();
  assert.equal(summary.length, 1);
  assert.equal(summary[0].coder, 'alice');
  assert.equal(summary[0].prompts, 1);
});
```

- [ ] **Step 5: Run the tests, verify they pass**

```bash
cd backend && npm test
```

Expected: `tests 1`, `pass 1`, exit code 0. (If `npm run build` fails, fix the TypeScript error before continuing — the only source change was the DATA_DIR line.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/db.ts backend/package.json backend/test/helpers.js backend/test/ingest.test.js
git commit -m "test: add node:test harness with MONITOR_DATA_DIR override"
```

---

### Task 2: Team tagging (`TEAM_NAME` env → `team` column)

**Files:**
- Modify: `monitor/agent.js` (env read + record payload)
- Modify: `monitor/env.example`
- Modify: `backend/src/db.ts` (column, `IngestRow`, insert, `summaryByCoder`)
- Test: `backend/test/team.test.js` (new)

**Interfaces:**
- Consumes: Task 1's test harness and `row()` fixture.
- Produces: `IngestRow.team?: string | null`; `interactions.team` TEXT column; `CoderSummary.team: string | null` (exposed by `/api/report`). The agent sends `team` on every record.

- [ ] **Step 1: Write the failing test**

Create `backend/test/team.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MONITOR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-test-'));
const db = require('../out/db.js');
const { row } = require('./helpers.js');

test('team is stored and surfaced in the coder summary', () => {
  db.ingestMany([row({ coder: 'bob', team: 'platform' })]);
  const s = db.summaryByCoder().find(r => r.coder === 'bob');
  assert.equal(s.team, 'platform');
});
```

- [ ] **Step 2: Run it, verify it fails**

```bash
cd backend && npm test
```

Expected: FAIL — `s.team` is `undefined`.

- [ ] **Step 3: Add the column and wire it through `db.ts`**

In `backend/src/db.ts`:

(a) After the existing two `try { db.exec('ALTER TABLE ...') }` lines, add:

```ts
try { db.exec('ALTER TABLE interactions ADD COLUMN team TEXT'); } catch { /* exists */ }
```

(b) In `interface IngestRow`, after `coder: string;`, add:

```ts
  team?: string | null;
```

(c) In the `insert` prepared statement, add `team` to both lists — column list becomes `(interaction_id, coder, team, ips, agent, ...)` and values list gains `@team` after `@coder`.

(d) In `ingestMany`, in the `insert.run({...})` object, after `coder: r.coder,` add:

```ts
        team: r.team ?? null,
```

(e) In `interface CoderSummary`, after `coder: string;`, add:

```ts
  team: string | null;
```

(f) In `summaryByCoder`'s SQL, after `SELECT coder,` add:

```sql
           MAX(team) team,
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd backend && npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Send team from the agent**

In `monitor/agent.js`:

(a) After the line defining `OPENCODE_EMAIL`, add:

```js
const TEAM = process.env.TEAM_NAME || null;
```

(b) In `main()`, inside the `records = raws.map(...)` object, after `coder: CODER,` add:

```js
      team:            TEAM,
```

(c) In `monitor/env.example`, add:

```
# Team this machine's coder belongs to (shown on the dashboard)
TEAM_NAME=
```

- [ ] **Step 6: Syntax-check the agent**

```bash
node --check monitor/agent.js
```

Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add monitor/agent.js monitor/env.example backend/src/db.ts backend/test/team.test.js
git commit -m "feat: tag interactions with TEAM_NAME from agent env"
```

---

### Task 3: Users, teams & role-based login

Replace the single-`ADMIN_TOKEN` login with a `users` table lookup (sha256 token hash). `ADMIN_TOKEN` remains as a bootstrap super-admin so the first login works on an empty DB.

**Files:**
- Modify: `backend/src/db.ts` (3 new tables + 5 functions)
- Rewrite: `backend/src/auth.ts` (full replacement below)
- Test: `backend/test/auth.test.js` (new)

**Interfaces:**
- Consumes: `ADMIN_TOKEN` from `config.ts`.
- Produces (used by Tasks 4 and 5):
  - `db.ts`: `interface UserRow { id: number; name: string; role: 'super_admin' | 'team_lead'; team_id: number | null }`, `findUserByTokenHash(hash: string): UserRow | null`, `upsertTeam(name: string): number`, `addUser(name: string, role: 'super_admin' | 'team_lead', tokenHash: string, teamId: number | null): void`, `assignCoder(coder: string, teamId: number): void`, `codersForTeam(teamId: number): string[]`
  - `auth.ts`: `type Role = 'super_admin' | 'team_lead'`, `interface Session { id: string; actor: string; role: Role; teamId: number | null; expires: number }`, `sha256(s: string): string`, `login(token: string): string | null`, `authorize(req): Session | null`

- [ ] **Step 1: Write the failing test**

Create `backend/test/auth.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MONITOR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-test-'));
process.env.ADMIN_TOKEN = 'bootstrap-secret';
const db = require('../out/db.js');
const auth = require('../out/auth.js');

const hash = s => crypto.createHash('sha256').update(s).digest('hex');

test('teams, users and coder assignment round-trip', () => {
  const teamId = db.upsertTeam('platform');
  assert.equal(db.upsertTeam('platform'), teamId); // idempotent
  db.addUser('lead-jane', 'team_lead', hash('jane-token'), teamId);
  db.assignCoder('alice', teamId);
  db.assignCoder('bob', teamId);
  assert.deepEqual(db.codersForTeam(teamId).sort(), ['alice', 'bob']);
  const u = db.findUserByTokenHash(hash('jane-token'));
  assert.equal(u.role, 'team_lead');
  assert.equal(u.team_id, teamId);
  assert.equal(db.findUserByTokenHash(hash('wrong')), null);
});

test('login: user token, bootstrap token, bad token', () => {
  assert.ok(auth.login('jane-token'), 'team lead token logs in');
  assert.ok(auth.login('bootstrap-secret'), 'ADMIN_TOKEN bootstrap logs in');
  assert.equal(auth.login('nope'), null);
});

test('bearer authorize carries role and team', () => {
  const s = auth.authorize({ headers: { authorization: 'Bearer jane-token' } });
  assert.equal(s.role, 'team_lead');
  assert.ok(s.teamId != null);
  const sa = auth.authorize({ headers: { authorization: 'Bearer bootstrap-secret' } });
  assert.equal(sa.role, 'super_admin');
  assert.equal(auth.authorize({ headers: {} }), null);
});
```

- [ ] **Step 2: Run it, verify it fails**

```bash
cd backend && npm test
```

Expected: FAIL — `db.upsertTeam is not a function`.

- [ ] **Step 3: Add tables and user functions to `db.ts`**

(a) Inside the existing `db.exec(\`...\`)` schema block, after the `access_log` table, add:

```sql
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('super_admin','team_lead')),
    team_id INTEGER REFERENCES teams(id)
  );
  CREATE TABLE IF NOT EXISTS coder_teams (
    coder TEXT PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id)
  );
```

(b) At the end of `db.ts`, add:

```ts
// ── users / teams / roles (managed via direct DB edits or scripts/manage.js) ──

export interface UserRow {
  id: number;
  name: string;
  role: 'super_admin' | 'team_lead';
  team_id: number | null;
}

export function findUserByTokenHash(hash: string): UserRow | null {
  const r = db.prepare('SELECT id, name, role, team_id FROM users WHERE token_hash = ?')
    .get(hash) as UserRow | undefined;
  return r ?? null;
}

export function upsertTeam(name: string): number {
  db.prepare('INSERT OR IGNORE INTO teams (name) VALUES (?)').run(name);
  return (db.prepare('SELECT id FROM teams WHERE name = ?').get(name) as { id: number }).id;
}

export function addUser(
  name: string,
  role: 'super_admin' | 'team_lead',
  tokenHash: string,
  teamId: number | null,
): void {
  db.prepare('INSERT INTO users (name, role, token_hash, team_id) VALUES (?,?,?,?)')
    .run(name, role, tokenHash, teamId);
}

export function assignCoder(coder: string, teamId: number): void {
  db.prepare(
    'INSERT INTO coder_teams (coder, team_id) VALUES (?,?) ' +
    'ON CONFLICT(coder) DO UPDATE SET team_id = excluded.team_id'
  ).run(coder, teamId);
}

export function codersForTeam(teamId: number): string[] {
  return (db.prepare('SELECT coder FROM coder_teams WHERE team_id = ?').all(teamId) as { coder: string }[])
    .map((r) => r.coder);
}
```

- [ ] **Step 4: Replace `backend/src/auth.ts` entirely with:**

```ts
import { createHash, randomBytes } from 'crypto';
import * as http from 'http';
import { ADMIN_TOKEN } from './config';
import { findUserByTokenHash } from './db';

/**
 * Dashboard auth. Two roles:
 *  - super_admin: sees all coders' data.
 *  - team_lead:   sees only coders assigned to their team (coder_teams table).
 * Users/teams are created by direct DB edits or scripts/manage.js — no UI.
 * ADMIN_TOKEN from env remains a bootstrap super_admin so first login works
 * on an empty database.
 */

export type Role = 'super_admin' | 'team_lead';

export interface Session {
  id: string;
  actor: string;
  role: Role;
  teamId: number | null;
  expires: number;
}

const SESSIONS = new Map<string, Session>();
const TTL_MS = 8 * 3600 * 1000;

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function resolveUser(token: string): { actor: string; role: Role; teamId: number | null } | null {
  const user = findUserByTokenHash(sha256(token));
  if (user) return { actor: user.name, role: user.role, teamId: user.team_id };
  if (token === ADMIN_TOKEN) return { actor: 'admin(bootstrap)', role: 'super_admin', teamId: null };
  return null;
}

/** Returns a session id if the supplied credential is valid, else null. */
export function login(token: string): string | null {
  const u = resolveUser(token);
  if (!u) return null;
  const id = randomBytes(24).toString('hex');
  SESSIONS.set(id, { id, ...u, expires: Date.now() + TTL_MS });
  return id;
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return out;
}

/** Authorize a dashboard request via session cookie OR bearer token. */
export function authorize(req: http.IncomingMessage): Session | null {
  const sid = parseCookies(req).sid;
  if (sid) {
    const s = SESSIONS.get(sid);
    if (s && s.expires > Date.now()) {
      return s;
    }
    if (s) {
      SESSIONS.delete(sid);
    }
  }
  const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization ?? '');
  if (m) {
    const u = resolveUser(m[1]);
    if (u) return { id: 'bearer', ...u, expires: Date.now() + TTL_MS };
  }
  return null;
}
```

Note: `config.ts` reads `ADMIN_TOKEN` at import time, which is why the test sets `process.env.ADMIN_TOKEN` before requiring modules.

- [ ] **Step 5: Run tests, verify they pass**

```bash
cd backend && npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db.ts backend/src/auth.ts backend/test/auth.test.js
git commit -m "feat: users/teams tables with super_admin and team_lead roles"
```

---

### Task 4: Scope all dashboard queries by role

Team leads must only ever receive their own team's data — enforced server-side in one helper.

**Files:**
- Create: `backend/src/scope.ts`
- Modify: `backend/src/server.ts` (API section + imports)
- Test: `backend/test/scope.test.js` (new)

**Interfaces:**
- Consumes: `Session` (Task 3), `Filters`, `codersForTeam` (Task 3).
- Produces: `scopeFilters(s: Session, f: Filters): Filters | null` (null ⇒ caller returns empty results) and `visibleCoders(s: Session, all: string[]): string[]`. Drilldown of a non-team coder returns HTTP 403.

- [ ] **Step 1: Write the failing test**

Create `backend/test/scope.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MONITOR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-test-'));
const db = require('../out/db.js');
const { scopeFilters, visibleCoders } = require('../out/scope.js');

const superAdmin = { id: 'x', actor: 'a', role: 'super_admin', teamId: null, expires: 0 };

test('super_admin filters pass through unchanged', () => {
  const f = { coders: ['anyone'] };
  assert.deepEqual(scopeFilters(superAdmin, f), f);
  assert.deepEqual(visibleCoders(superAdmin, ['a', 'b']), ['a', 'b']);
});

test('team_lead is restricted to assigned coders', () => {
  const teamId = db.upsertTeam('t1');
  db.assignCoder('alice', teamId);
  db.assignCoder('bob', teamId);
  const lead = { id: 'y', actor: 'l', role: 'team_lead', teamId, expires: 0 };

  assert.deepEqual(scopeFilters(lead, {}).coders.sort(), ['alice', 'bob']);
  assert.deepEqual(scopeFilters(lead, { coders: ['alice', 'eve'] }).coders, ['alice']);
  assert.equal(scopeFilters(lead, { coders: ['eve'] }), null);
  assert.deepEqual(visibleCoders(lead, ['alice', 'eve']), ['alice']);
});

test('team_lead with no assigned coders sees nothing', () => {
  const emptyTeam = db.upsertTeam('empty');
  const lead = { id: 'z', actor: 'l2', role: 'team_lead', teamId: emptyTeam, expires: 0 };
  assert.equal(scopeFilters(lead, {}), null);
  assert.deepEqual(visibleCoders(lead, ['alice']), []);
});
```

- [ ] **Step 2: Run it, verify it fails**

```bash
cd backend && npm test
```

Expected: FAIL — cannot find module `../out/scope.js`.

- [ ] **Step 3: Create `backend/src/scope.ts`:**

```ts
import { Filters, codersForTeam } from './db';
import type { Session } from './auth';

/**
 * Restrict filters to the session's visibility.
 * super_admin  → filters unchanged.
 * team_lead    → coders limited to their team; returns null when nothing is
 *                visible (callers must respond with empty results).
 */
export function scopeFilters(s: Session, f: Filters): Filters | null {
  if (s.role === 'super_admin') return f;
  const team = codersForTeam(s.teamId ?? -1);
  if (!team.length) return null;
  const coders = f.coders?.length ? f.coders.filter((c) => team.includes(c)) : team;
  return coders.length ? { ...f, coders } : null;
}

/** Subset of `all` that the session may see. */
export function visibleCoders(s: Session, all: string[]): string[] {
  if (s.role === 'super_admin') return all;
  const team = new Set(codersForTeam(s.teamId ?? -1));
  return all.filter((c) => team.has(c));
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd backend && npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Wire scoping into `server.ts`**

(a) Add to the imports at the top of `backend/src/server.ts`:

```ts
import { scopeFilters, visibleCoders } from './scope';
import { codersForTeam } from './db';
```

(`codersForTeam` goes in the existing `from './db'` import list.)

(b) Replace the entire `if (req.method === 'GET' && isApi) { ... }` block with:

```ts
    if (req.method === 'GET' && isApi) {
      const s = authorize(req);
      if (!s) return send(res, 401, { error: 'auth required' });
      const f0 = parseFilters(url);
      const f = scopeFilters(s, f0); // null → nothing visible to this session

      if (p === '/api/report') {
        logAccess(s.actor, 'report');
        return send(res, 200, { coders: f ? summaryByCoder(f) : [] });
      }
      if (p === '/api/tokens') {
        logAccess(s.actor, 'tokens');
        return send(res, 200, { rows: f ? tokensByModel(f) : [] });
      }
      if (p === '/api/activity') {
        return send(res, 200, { rows: f ? activityOverTime(f) : [] });
      }
      if (p === '/api/complexity') {
        return send(res, 200, { rows: f ? taskClassBreakdown(f) : [] });
      }
      if (p === '/api/coders') {
        return send(res, 200, { coders: visibleCoders(s, allCoders()) });
      }
      if (p === '/api/limits') {
        const usage = coderLimitUsage();
        const vis = new Set(visibleCoders(s, usage.map((u) => u.coder)));
        return send(res, 200, { limits: LIMITS, usage: usage.filter((u) => vis.has(u.coder)) });
      }
      if (p === '/api/projects') {
        return send(res, 200, { rows: f ? projectSummary(f) : [] });
      }
      if (p === '/api/file-changes') {
        return send(res, 200, { rows: f ? fileChangesByProject(f) : [] });
      }
      const drill = /^\/api\/coder\/(.+)$/.exec(p);
      if (drill) {
        const coder = decodeURIComponent(drill[1]);
        if (s.role === 'team_lead' && !codersForTeam(s.teamId ?? -1).includes(coder)) {
          return send(res, 403, { error: 'forbidden' });
        }
        logAccess(s.actor, `drilldown:${coder}`);
        const coderFilter = { ...f0, coders: [coder] };
        const allUsage = coderLimitUsage();
        return send(res, 200, {
          coder,
          interactions: interactionsForCoder(coder, 200, f0),
          tokens: tokensByModel(coderFilter),
          daily: coderDailyActivity(coder, f0),
          projects: projectSummary(coderFilter),
          fileChanges: fileChangesByProject(coderFilter),
          limits: { config: LIMITS, usage: allUsage.find((u) => u.coder === coder) ?? null },
        });
      }
    }
```

- [ ] **Step 6: Build and smoke-test the 403**

```bash
cd backend && npm run build && node out/server.js &
sleep 1
curl -s -H "Authorization: Bearer dev-admin-token" http://localhost:4319/api/coders
kill %1
```

Expected: the curl returns `{"coders":[...]}` (bootstrap token still works). Stop the server afterwards.

- [ ] **Step 7: Run the full test suite**

```bash
cd backend && npm test
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/scope.ts backend/src/server.ts backend/test/scope.test.js
git commit -m "feat: scope all dashboard APIs by role (team_lead sees own team only)"
```

---

### Task 5: `manage.js` CLI for users, teams & coder assignment

No UI — but hand-hashing tokens with `sqlite3` is error-prone, so ship a tiny CLI.

**Files:**
- Create: `backend/scripts/manage.js`

**Interfaces:**
- Consumes: `upsertTeam`, `addUser`, `assignCoder` from compiled `backend/out/db.js` (Task 3).
- Produces: commands `add-team <team>`, `add-user <name> <role> [team]` (prints the generated login token once), `assign-coder <coder> <team>`.

- [ ] **Step 1: Create `backend/scripts/manage.js`:**

```js
#!/usr/bin/env node
'use strict';
/**
 * Direct-DB management CLI (there is deliberately no UI for this).
 * Run from backend/ AFTER `npm run build`:
 *   node scripts/manage.js add-team <team>
 *   node scripts/manage.js add-user <name> super_admin|team_lead [team]
 *   node scripts/manage.js assign-coder <coder> <team>
 */
const crypto = require('crypto');
const db = require('../out/db.js');

const [cmd, a, b, c] = process.argv.slice(2);
function fail(msg) { console.error(msg); process.exit(1); }

if (cmd === 'add-team') {
  if (!a) fail('usage: add-team <team>');
  console.log(`team "${a}" id: ${db.upsertTeam(a)}`);
} else if (cmd === 'add-user') {
  if (!a || !['super_admin', 'team_lead'].includes(b)) {
    fail('usage: add-user <name> super_admin|team_lead [team]');
  }
  if (b === 'team_lead' && !c) fail('team_lead requires a team name');
  const teamId = c ? db.upsertTeam(c) : null;
  const token = crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  db.addUser(a, b, hash, teamId);
  console.log(`user "${a}" created (${b}${c ? ', team ' + c : ''})`);
  console.log('login token (shown once, only the hash is stored):');
  console.log(token);
} else if (cmd === 'assign-coder') {
  if (!a || !b) fail('usage: assign-coder <coder> <team>');
  db.assignCoder(a, db.upsertTeam(b));
  console.log(`coder "${a}" assigned to team "${b}"`);
} else {
  fail('commands: add-team | add-user | assign-coder');
}
```

- [ ] **Step 2: Verify against a throwaway DB**

```bash
cd backend && npm run build
MONITOR_DATA_DIR=$(mktemp -d) bash -c '
  node scripts/manage.js add-team platform &&
  node scripts/manage.js add-user jane team_lead platform &&
  node scripts/manage.js assign-coder alice platform'
```

Expected: prints a team id, a one-time token for jane, and the assignment line. Exit 0.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/manage.js
git commit -m "feat: manage.js CLI for teams, users and coder assignment"
```

---

### Task 6: Agent — extract file events from session logs

Replace guesswork with the real record: Claude Code JSONL contains a `tool_use` block for every `Edit`/`Write`/`Read`; OpenCode stores tool parts in its DB. Also make `agent.js` requireable so it can be unit-tested.

**Files:**
- Modify: `monitor/agent.js`
- Test: `monitor/test/agent.test.js` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: each ingest record gains `fileEvents: { file: string; action: 'read' | 'edit' | 'write' }[]`; `module.exports = { classify, redact, parseClaude, toolFileEvent, opencodeToolEvent }` for tests. Task 7's backend consumes `fileEvents`.

- [ ] **Step 1: Make agent.js requireable (main-guard refactor)**

In `monitor/agent.js`:

(a) DELETE this top-level block (lines ~37-40):

```js
if (!INGEST_URL || !INGEST_TOKEN) {
  console.error('ERROR: Set INGEST_URL and INGEST_TOKEN in .env (see agent.env.example)');
  process.exit(1);
}
```

(b) REPLACE the bottom dispatch block:

```js
if (process.argv.includes('--scan')) { runScan(); }
else if (process.argv.includes('--debug-opencode')) {
  ...
}
else { main().catch(e => { console.error(String(e)); process.exit(1); }); }
```

with:

```js
if (require.main === module) {
  if (process.argv.includes('--scan')) { runScan(); }
  else if (process.argv.includes('--debug-opencode')) {
    const roots = opencodeRoots();
    let found = false;
    for (const r of roots) {
      const dbPath = path.join(r, 'opencode.db');
      if (fs.existsSync(dbPath)) { debugOpencodeDB(dbPath); found = true; break; }
    }
    if (!found) console.log('opencode.db not found. Run --scan to see all directories checked.');
  }
  else {
    if (!INGEST_URL || !INGEST_TOKEN) {
      console.error('ERROR: Set INGEST_URL and INGEST_TOKEN in .env (see env.example)');
      process.exit(1);
    }
    main().catch(e => { console.error(String(e)); process.exit(1); });
  }
}

module.exports = { classify, redact, parseClaude, toolFileEvent, opencodeToolEvent };
```

- [ ] **Step 2: Write the failing test**

Create `monitor/test/agent.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agent = require('../agent.js');

test('toolFileEvent maps tool names to actions', () => {
  assert.deepEqual(agent.toolFileEvent('Edit', { file_path: '/r/a.ts' }), { file: '/r/a.ts', action: 'edit' });
  assert.deepEqual(agent.toolFileEvent('Write', { file_path: '/r/b.md' }), { file: '/r/b.md', action: 'write' });
  assert.deepEqual(agent.toolFileEvent('MultiEdit', { file_path: '/r/c.py' }), { file: '/r/c.py', action: 'edit' });
  assert.deepEqual(agent.toolFileEvent('NotebookEdit', { notebook_path: '/r/n.ipynb' }), { file: '/r/n.ipynb', action: 'edit' });
  assert.deepEqual(agent.toolFileEvent('Read', { file_path: '/r/d.js' }), { file: '/r/d.js', action: 'read' });
  assert.equal(agent.toolFileEvent('Bash', { command: 'ls' }), null);
  assert.equal(agent.toolFileEvent('Edit', {}), null);
});

test('opencodeToolEvent parses tool parts defensively', () => {
  assert.deepEqual(
    agent.opencodeToolEvent({ type: 'tool', tool: 'edit', state: { input: { filePath: '/r/x.go' } } }),
    { file: '/r/x.go', action: 'edit' });
  assert.deepEqual(
    agent.opencodeToolEvent({ type: 'tool', tool: 'write', input: { file_path: '/r/y.rs' } }),
    { file: '/r/y.rs', action: 'write' });
  assert.equal(agent.opencodeToolEvent({ type: 'text', text: 'hi' }), null);
  assert.equal(agent.opencodeToolEvent({ type: 'tool', tool: 'bash' }), null);
});

test('parseClaude collects fileEvents per user turn', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-'));
  const f = path.join(dir, 's1.jsonl');
  const lines = [
    { type: 'user', sessionId: 's1', cwd: '/repo', gitBranch: 'main',
      timestamp: '2026-07-01T10:00:00.000Z',
      message: { content: 'refactor the auth module' } },
    { type: 'assistant',
      message: { model: 'claude-opus-4-8', usage: { input_tokens: 5, output_tokens: 9 },
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/repo/src/auth.ts' } },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/auth.ts' } },
        ] } },
    { type: 'assistant',
      message: { model: 'claude-opus-4-8', usage: { output_tokens: 3 },
        content: [
          { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/auth.ts' } },
          { type: 'tool_use', name: 'Write', input: { file_path: '/repo/src/session.ts' } },
        ] } },
  ];
  fs.writeFileSync(f, lines.map(JSON.stringify).join('\n'));

  const recs = agent.parseClaude(f);
  assert.equal(recs.length, 1);
  assert.deepEqual(recs[0].fileEvents.sort((a, b) => a.file.localeCompare(b.file) || a.action.localeCompare(b.action)), [
    { file: '/repo/src/auth.ts', action: 'edit' },   // deduped across both assistant messages
    { file: '/repo/src/auth.ts', action: 'read' },
    { file: '/repo/src/session.ts', action: 'write' },
  ]);
  assert.equal(recs[0].tokens.output, 12);
});
```

- [ ] **Step 3: Run it, verify it fails**

```bash
cd monitor && node --test test/
```

Expected: FAIL — `agent.toolFileEvent is not a function`.

- [ ] **Step 4: Implement extraction in `agent.js`**

(a) After the `classify()` function, add:

```js
// ── File-event extraction (authoritative: from agent tool calls) ─────────────
const TOOL_ACTIONS = { Write: 'write', Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Read: 'read' };

function toolFileEvent(name, input) {
  const action = TOOL_ACTIONS[name];
  if (!action || !input) return null;
  const file = input.file_path || input.notebook_path || input.path;
  if (!file) return null;
  return { file: String(file), action };
}

function opencodeToolEvent(pData) {
  if (!pData || pData.type !== 'tool') return null;
  const tool = String(pData.tool || pData.name || '').toLowerCase();
  const input = (pData.state && pData.state.input) || pData.input || {};
  const file = input.filePath || input.file_path || input.path;
  if (!file) return null;
  if (tool.includes('write')) return { file: String(file), action: 'write' };
  if (tool.includes('edit'))  return { file: String(file), action: 'edit' };
  if (tool.includes('read'))  return { file: String(file), action: 'read' };
  return null;
}
```

(b) In `parseClaude`, replace the inner assistant-scan loop:

```js
    const tokens = emptyTok();
    let model = null;
    for (let j = i + 1; j < parsed.length; j++) {
      const nxt = parsed[j];
      if (nxt.type === 'user') break;
      if (nxt.type !== 'assistant' || !nxt.message) continue;
      const nm = nxt.message;
      if (nm.model && nm.model !== '<synthetic>' && !nm.model.startsWith('<') && !model) model = String(nm.model);
      const u = nm.usage || {};
      tokens.input       += u.input_tokens                   || 0;
      tokens.output      += u.output_tokens                  || 0;
      tokens.cacheRead   += u.cache_read_input_tokens        || 0;
      tokens.cacheCreate += u.cache_creation_input_tokens    || 0;
    }
    results.push({ agent: 'claude_code', model, prompt: p, workspace, gitBranch, sessionId, timestamp: o.timestamp || null, tokens, modelConfidence: 'authoritative' });
```

with:

```js
    const tokens = emptyTok();
    let model = null;
    const fileEvents = [];
    const seenEv = new Set();
    for (let j = i + 1; j < parsed.length; j++) {
      const nxt = parsed[j];
      if (nxt.type === 'user') break;
      if (nxt.type !== 'assistant' || !nxt.message) continue;
      const nm = nxt.message;
      if (nm.model && nm.model !== '<synthetic>' && !nm.model.startsWith('<') && !model) model = String(nm.model);
      const u = nm.usage || {};
      tokens.input       += u.input_tokens                   || 0;
      tokens.output      += u.output_tokens                  || 0;
      tokens.cacheRead   += u.cache_read_input_tokens        || 0;
      tokens.cacheCreate += u.cache_creation_input_tokens    || 0;
      if (Array.isArray(nm.content)) {
        for (const b of nm.content) {
          if (!b || b.type !== 'tool_use') continue;
          const ev = toolFileEvent(b.name, b.input);
          if (ev && !seenEv.has(ev.action + '|' + ev.file)) {
            seenEv.add(ev.action + '|' + ev.file);
            fileEvents.push(ev);
          }
        }
      }
    }
    results.push({ agent: 'claude_code', model, prompt: p, workspace, gitBranch, sessionId, timestamp: o.timestamp || null, tokens, fileEvents, modelConfidence: 'authoritative' });
```

(c) In `readOpencodeDB`, tool parts belong to assistant messages, so aggregate them per session and attach to the session's first user message (same pattern already used for tokens). After the `partsByMsg` index block, add:

```js
  // Map message id → session id, then collect file events per session
  const msgSession = {};
  for (const m of (data.message || [])) {
    if (m.id) msgSession[m.id] = m.session_id || null;
  }
  const sesFileEvents = {};
  for (const p of (data.part || [])) {
    const ev = opencodeToolEvent(parseJSON(p.data));
    if (!ev) continue;
    const sid = msgSession[p.message_id];
    if (!sid) continue;
    if (!sesFileEvents[sid]) sesFileEvents[sid] = [];
    const key = ev.action + '|' + ev.file;
    if (!sesFileEvents[sid].some(e => e.action + '|' + e.file === key)) sesFileEvents[sid].push(ev);
  }
```

Then, in the same function, find the block that assigns session tokens to the first message:

```js
    let tokIn = 0, tokOut = 0, tokCR = 0, tokCW = 0;
    if (sesId && !sesFirstSeen.has(sesId)) {
      sesFirstSeen.add(sesId);
```

and add one line inside that `if`, plus declare `fileEvents` before it, so the block becomes:

```js
    let tokIn = 0, tokOut = 0, tokCR = 0, tokCW = 0;
    let fileEvents = [];
    if (sesId && !sesFirstSeen.has(sesId)) {
      sesFirstSeen.add(sesId);
      fileEvents = sesFileEvents[sesId] || [];
      tokIn  = Number(ses.tokens_input        || 0);
      tokOut = Number(ses.tokens_output       || 0);
      tokCR  = Number(ses.tokens_cache_read   || 0);
      tokCW  = Number(ses.tokens_cache_write  || 0);
    }
```

and add `fileEvents,` to the `results.push({ ... })` object in the same function (after `tokens: {...},`).

(d) In `main()`, in the `records = raws.map(...)` object, after `gitChanges: ...,` add:

```js
      fileEvents:      raw.fileEvents || [],
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
cd monitor && node --test test/ && node --check agent.js
```

Expected: all tests PASS; `--check` silent.

- [ ] **Step 6: Commit**

```bash
git add monitor/agent.js monitor/test/agent.test.js
git commit -m "feat: extract per-turn file events from Claude/OpenCode tool calls"
```

---

### Task 7: Backend — store & serve file events

**Files:**
- Modify: `backend/src/db.ts` (table, ingest, query)
- Modify: `backend/src/server.ts` (endpoint + drilldown field)
- Test: `backend/test/file-events.test.js` (new)

**Interfaces:**
- Consumes: `IngestRow` records now carrying `fileEvents` (Task 6); `scopeFilters` (Task 4).
- Produces: `file_events` table; `fileEventSummary(f?: Filters): FileEventSummary[]` where `FileEventSummary = { workspace: string|null; file: string; agent: string; reads: number; edits: number; writes: number; last_ts: string|null }`; `GET /api/file-events`; `fileEvents` array in the `/api/coder/:name` response (Task 8 renders it).

- [ ] **Step 1: Write the failing test**

Create `backend/test/file-events.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MONITOR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-test-'));
const db = require('../out/db.js');
const { row } = require('./helpers.js');

test('file events are stored per interaction and summarised', () => {
  db.ingestMany([
    row({ interactionId: 'fe-1', coder: 'alice', workspace: '/repo',
      fileEvents: [
        { file: 'src/auth.ts', action: 'edit' },
        { file: 'src/auth.ts', action: 'read' },
      ] }),
    row({ interactionId: 'fe-2', coder: 'alice', workspace: '/repo',
      fileEvents: [{ file: 'src/auth.ts', action: 'edit' }] }),
    row({ interactionId: 'fe-3', coder: 'bob', workspace: '/repo', agent: 'opencode',
      fileEvents: [{ file: 'README.md', action: 'write' }] }),
  ]);
  // duplicate ingest must not double-count
  db.ingestMany([row({ interactionId: 'fe-1', coder: 'alice', workspace: '/repo',
    fileEvents: [{ file: 'src/auth.ts', action: 'edit' }] })]);

  const all = db.fileEventSummary();
  const auth = all.find(r => r.file === 'src/auth.ts');
  assert.equal(auth.edits, 2);
  assert.equal(auth.reads, 1);
  assert.equal(auth.agent, 'claude_code');

  const onlyBob = db.fileEventSummary({ coders: ['bob'] });
  assert.equal(onlyBob.length, 1);
  assert.equal(onlyBob[0].writes, 1);
});
```

- [ ] **Step 2: Run it, verify it fails**

```bash
cd backend && npm test
```

Expected: FAIL — `db.fileEventSummary is not a function`.

- [ ] **Step 3: Implement in `db.ts`**

(a) In the schema `db.exec` block, add:

```sql
  CREATE TABLE IF NOT EXISTS file_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    interaction_id TEXT NOT NULL,
    coder TEXT NOT NULL,
    agent TEXT,
    workspace TEXT,
    file TEXT NOT NULL,
    action TEXT NOT NULL,
    ts TEXT,
    UNIQUE(interaction_id, file, action)
  );
  CREATE INDEX IF NOT EXISTS idx_fe_coder ON file_events(coder);
```

(b) In `interface IngestRow`, after `gitChanges?: GitChange[] | null;`, add:

```ts
  fileEvents?: { file: string; action: string }[] | null;
```

(c) After the `insert` prepared statement, add:

```ts
const insertFileEvent = db.prepare(`
  INSERT OR IGNORE INTO file_events (interaction_id, coder, agent, workspace, file, action, ts)
  VALUES (?,?,?,?,?,?,?)
`);
```

(d) In `ingestMany`, inside the loop, after `n += info.changes;`, add:

```ts
      if (info.changes && r.fileEvents?.length) {
        for (const ev of r.fileEvents) {
          insertFileEvent.run(r.interactionId, r.coder, r.agent, r.workspace, ev.file, ev.action, r.timestamp);
        }
      }
```

(e) At the end of `db.ts`, add:

```ts
// ── file events (authoritative per-turn file activity from tool calls) ────────

export interface FileEventSummary {
  workspace: string | null;
  file: string;
  agent: string;
  reads: number;
  edits: number;
  writes: number;
  last_ts: string | null;
}

export function fileEventSummary(f: Filters = {}): FileEventSummary[] {
  const parts: string[] = [];
  const params: (string | number)[] = [];
  if (f.from) { parts.push('ts >= ?'); params.push(f.from); }
  if (f.to)   { parts.push('ts <= ?'); params.push(f.to); }
  if (f.coders?.length) {
    parts.push(`coder IN (${f.coders.map(() => '?').join(',')})`);
    params.push(...f.coders);
  }
  const sql = parts.length ? 'WHERE ' + parts.join(' AND ') : '';
  return db.prepare(`
    SELECT workspace, file, COALESCE(agent,'unknown') agent,
           SUM(action='read')  reads,
           SUM(action='edit')  edits,
           SUM(action='write') writes,
           MAX(ts) last_ts
    FROM file_events ${sql}
    GROUP BY workspace, file, agent
    ORDER BY edits + writes DESC, reads DESC
  `).all(...params) as FileEventSummary[];
}
```

(f) In `pruneRetention`, also prune orphaned file events — replace the function body with:

```ts
export function pruneRetention(): number {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();
  const n = db.prepare('DELETE FROM interactions WHERE received_at < ?').run(cutoff).changes;
  db.prepare('DELETE FROM file_events WHERE interaction_id NOT IN (SELECT interaction_id FROM interactions)').run();
  return n;
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd backend && npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Serve it from `server.ts`**

(a) Add `fileEventSummary` to the `from './db'` import list.

(b) In the API section (inside the `GET && isApi` block from Task 4), after the `/api/file-changes` route, add:

```ts
      if (p === '/api/file-events') {
        return send(res, 200, { rows: f ? fileEventSummary(f) : [] });
      }
```

(c) In the drilldown response object, after `fileChanges: ...,`, add:

```ts
          fileEvents: fileEventSummary({ ...f0, coders: [coder] }),
```

- [ ] **Step 6: Build + run tests**

```bash
cd backend && npm test
```

Expected: all tests PASS (build included in `npm test`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/db.ts backend/src/server.ts backend/test/file-events.test.js
git commit -m "feat: store file events and serve /api/file-events + drilldown"
```

---

### Task 8: Dashboard — "Files worked on" card on the coder page

**Files:**
- Modify: `backend/public/coder.html`

**Interfaces:**
- Consumes: `fileEvents` array in the `/api/coder/:name` response (Task 7): `{ workspace, file, agent, reads, edits, writes, last_ts }`.
- Produces: visual card only; nothing downstream depends on it.

- [ ] **Step 1: Add the card markup**

In `backend/public/coder.html`, directly BEFORE the line `    <!-- PROMPTS -->`, insert:

```html
    <!-- FILES WORKED ON -->
    <div class="card">
      <div class="ch">📄 Files worked on <span style="color:var(--muted);text-transform:none;letter-spacing:0;font-size:10px">· from agent tool calls</span></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Project</th><th>File</th><th>Agent</th><th class="r">Edits</th><th class="r">Writes</th><th class="r">Reads</th><th class="r">Last</th></tr></thead>
        <tbody id="feTbody"></tbody>
      </table></div>
    </div>
```

- [ ] **Step 2: Add the render function and hook it into load()**

In the `<script>` block of `coder.html`:

(a) Directly AFTER the closing brace of the `load()` function, add:

```js
function renderFileEvents(d) {
  const rows = d.fileEvents || [];
  $('#feTbody').innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td>${esc(projName(r.workspace || '(unknown)'))}</td>
      <td>${esc(r.file)}</td>
      <td>${pill(r.agent === 'claude_code' ? 'Claude' : esc(r.agent))}</td>
      <td class="r">${r.edits || 0}</td>
      <td class="r">${r.writes || 0}</td>
      <td class="r">${r.reads || 0}</td>
      <td class="r">${r.last_ts ? new Date(r.last_ts).toLocaleDateString() : ''}</td>
    </tr>`).join('')
    : '<tr><td colspan="7" style="color:var(--muted)">No file activity captured yet</td></tr>';
}
```

(b) Inside `load()`, after the line `  render();`, add:

```js
  renderFileEvents(_data);
```

- [ ] **Step 3: Manual verification**

```bash
cd backend && npm run build && node out/server.js &
sleep 1
curl -s -X POST http://localhost:4319/ingest \
  -H "Authorization: Bearer dev-ingest-token" -H "content-type: application/json" \
  -d '{"records":[{"interactionId":"ui-test-1","coder":"demo","ips":[],"agent":"claude_code","model":"claude-opus-4-8","prompt":"demo","taskClass":"simple","taskConfidence":0.5,"workspace":"/demo","gitBranch":"main","sessionId":"s1","timestamp":"2026-07-09T09:00:00.000Z","tokens":{"input":1,"output":1,"cacheRead":0,"cacheCreate":0},"modelConfidence":"authoritative","fileEvents":[{"file":"src/app.ts","action":"edit"}]}]}'
```

Open `http://localhost:4319/coder.html?coder=demo`, log in with `dev-admin-token`, clear the date filter (set From to an earlier date). Expected: the "Files worked on" card lists `src/app.ts` with Edits = 1. Then `kill %1`.

- [ ] **Step 4: Commit**

```bash
git add backend/public/coder.html
git commit -m "feat: Files worked on card on coder detail page"
```

---

### Task 9: Heartbeat & fleet endpoint

**Files:**
- Modify: `monitor/agent.js` (version const + heartbeat POST)
- Modify: `backend/src/db.ts` (heartbeats table + functions)
- Modify: `backend/src/server.ts` (`POST /heartbeat`, `GET /api/fleet`)
- Test: `backend/test/heartbeat.test.js` (new)

**Interfaces:**
- Consumes: `post()` helper in agent.js; `visibleCoders` (Task 4).
- Produces: `recordHeartbeat(h: { coder: string; team: string|null; version: string|null; hostname: string|null; prompts: number }): void`; `fleet(): FleetRow[]` where `FleetRow = { coder, team, version, hostname, last_seen, prompts }`; `POST /heartbeat` (ingest-token auth); `GET /api/fleet` (session auth, team-scoped).

- [ ] **Step 1: Write the failing test**

Create `backend/test/heartbeat.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MONITOR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-test-'));
const db = require('../out/db.js');

test('heartbeat upserts one row per coder', () => {
  db.recordHeartbeat({ coder: 'alice', team: 'platform', version: '1.1.0', hostname: 'pc-1', prompts: 4 });
  db.recordHeartbeat({ coder: 'alice', team: 'platform', version: '1.2.0', hostname: 'pc-1', prompts: 9 });
  const rows = db.fleet();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].version, '1.2.0');
  assert.equal(rows[0].prompts, 9);
  assert.ok(rows[0].last_seen);
});
```

- [ ] **Step 2: Run it, verify it fails**

```bash
cd backend && npm test
```

Expected: FAIL — `db.recordHeartbeat is not a function`.

- [ ] **Step 3: Implement in `db.ts`**

(a) Schema block, add:

```sql
  CREATE TABLE IF NOT EXISTS heartbeats (
    coder TEXT PRIMARY KEY,
    team TEXT,
    version TEXT,
    hostname TEXT,
    last_seen TEXT NOT NULL,
    prompts INTEGER
  );
```

(b) End of file, add:

```ts
// ── agent heartbeats (fleet health) ───────────────────────────────────────────

export interface FleetRow {
  coder: string;
  team: string | null;
  version: string | null;
  hostname: string | null;
  last_seen: string;
  prompts: number;
}

export function recordHeartbeat(h: Omit<FleetRow, 'last_seen'>): void {
  db.prepare(`
    INSERT INTO heartbeats (coder, team, version, hostname, last_seen, prompts)
    VALUES (@coder, @team, @version, @hostname, @last_seen, @prompts)
    ON CONFLICT(coder) DO UPDATE SET
      team = excluded.team, version = excluded.version,
      hostname = excluded.hostname, last_seen = excluded.last_seen,
      prompts = excluded.prompts
  `).run({ ...h, last_seen: new Date().toISOString() });
}

export function fleet(): FleetRow[] {
  return db.prepare('SELECT * FROM heartbeats ORDER BY last_seen DESC').all() as FleetRow[];
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd backend && npm test
```

Expected: all PASS.

- [ ] **Step 5: Add the routes to `server.ts`**

(a) Add `recordHeartbeat, fleet` to the `from './db'` import list.

(b) Directly after the `POST /ingest` route block, add:

```ts
    if (req.method === 'POST' && p === '/heartbeat') {
      const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization ?? '');
      if (!m || m[1] !== INGEST_TOKEN) return send(res, 401, { error: 'bad ingest token' });
      const b = JSON.parse((await readBody(req)) || '{}');
      if (!b.coder) return send(res, 400, { error: 'coder required' });
      recordHeartbeat({
        coder: String(b.coder),
        team: b.team != null ? String(b.team) : null,
        version: b.version != null ? String(b.version) : null,
        hostname: b.hostname != null ? String(b.hostname) : null,
        prompts: Number(b.prompts ?? 0),
      });
      return send(res, 200, { ok: true });
    }
```

(c) Inside the API section, after the `/api/file-events` route, add:

```ts
      if (p === '/api/fleet') {
        const rows = fleet();
        if (s.role === 'super_admin') return send(res, 200, { rows });
        const vis = new Set(visibleCoders(s, rows.map((r) => r.coder)));
        return send(res, 200, { rows: rows.filter((r) => vis.has(r.coder)) });
      }
```

- [ ] **Step 6: Send the heartbeat from the agent**

In `monitor/agent.js`:

(a) Near the top, after the `const TEAM = ...` line, add:

```js
const AGENT_VERSION = '1.1.0';
```

(b) In `main()`, after the `console.log(\`Sent: ...\`)` line, add:

```js
  try {
    await post(INGEST_URL + '/heartbeat', INGEST_TOKEN, JSON.stringify({
      coder: CODER, team: TEAM, version: AGENT_VERSION,
      hostname: os.hostname(), prompts: records.length,
    }));
  } catch { /* heartbeat is best-effort */ }
```

- [ ] **Step 7: Verify**

```bash
node --check monitor/agent.js && cd backend && npm test
```

Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add monitor/agent.js backend/src/db.ts backend/src/server.ts backend/test/heartbeat.test.js
git commit -m "feat: agent heartbeat and team-scoped /api/fleet endpoint"
```

---

### Task 10: Run-at-startup installers

Make the capture agent start on boot/logon and repeat every 15 minutes on Windows (Task Scheduler) and Linux (systemd user timer, cron fallback).

**Files:**
- Create: `monitor/run.bat` (silent, for the scheduler)
- Modify: `monitor/start.bat` (delegates to run.bat, stays interactive)
- Create: `monitor/install.bat`, `monitor/uninstall.bat`
- Create: `monitor/install.sh`, `monitor/uninstall.sh`

**Interfaces:**
- Consumes: `monitor/agent.js` and its `.env`.
- Produces: scheduled tasks named `AgentMonitor` + `AgentMonitorLogon` (Windows); systemd user units `agent-monitor.service` / `agent-monitor.timer` or crontab lines tagged `# agent-monitor` (Linux/macOS fallback).

- [ ] **Step 1: Create `monitor/run.bat`** (non-interactive — the old start.bat ends in `pause`, which hangs scheduled runs):

```bat
@echo off
:: Agent Monitor -- silent runner (used by Task Scheduler; no pause, no output)
cd /d "%~dp0"
echo [%date% %time%] Running agent capture... >> agent-monitor.log 2>&1
node agent.js >> agent-monitor.log 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] agent.js exited with code %ERRORLEVEL% >> agent-monitor.log 2>&1
)
```

- [ ] **Step 2: Replace `monitor/start.bat` contents with** (interactive wrapper):

```bat
@echo off
:: Agent Monitor -- interactive launcher (double-click to run once and see output)
cd /d "%~dp0"
call run.bat
echo.
echo === Last output ===
powershell -command "Get-Content agent-monitor.log -Tail 20"
echo.
pause
```

- [ ] **Step 3: Create `monitor/install.bat`:**

```bat
@echo off
:: Agent Monitor -- register Task Scheduler entries:
::   AgentMonitorLogon : run at every user logon
::   AgentMonitor      : run every 15 minutes
cd /d "%~dp0"

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: node not found on PATH. Install Node.js first.
  pause & exit /b 1
)
if not exist "%~dp0.env" (
  echo ERROR: .env not found next to agent.js. Copy env.example to .env first.
  pause & exit /b 1
)

schtasks /Create /F /TN "AgentMonitorLogon" /TR "\"%~dp0run.bat\"" /SC ONLOGON
schtasks /Create /F /TN "AgentMonitor"      /TR "\"%~dp0run.bat\"" /SC MINUTE /MO 15

echo.
echo Installed. Verify with:  schtasks /Query /TN "AgentMonitor"
pause
```

- [ ] **Step 4: Create `monitor/uninstall.bat`:**

```bat
@echo off
schtasks /Delete /F /TN "AgentMonitorLogon" 2>nul
schtasks /Delete /F /TN "AgentMonitor" 2>nul
echo Removed Agent Monitor scheduled tasks.
pause
```

- [ ] **Step 5: Create `monitor/install.sh`:**

```bash
#!/usr/bin/env bash
# Agent Monitor — install autostart (systemd user timer; cron fallback).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

command -v node >/dev/null || { echo "ERROR: node not found on PATH"; exit 1; }
[ -f "$DIR/.env" ] || { echo "ERROR: $DIR/.env missing (copy env.example)"; exit 1; }

if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/agent-monitor.service" <<EOF
[Unit]
Description=Agent Monitor capture run

[Service]
Type=oneshot
WorkingDirectory=$DIR
ExecStart=$(command -v node) $DIR/agent.js
EOF
  cat > "$HOME/.config/systemd/user/agent-monitor.timer" <<EOF
[Unit]
Description=Agent Monitor: at boot + every 15 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now agent-monitor.timer
  echo "Installed systemd user timer. Verify: systemctl --user list-timers agent-monitor.timer"
else
  TMP="$(mktemp)"
  crontab -l 2>/dev/null | grep -v '# agent-monitor$' > "$TMP" || true
  echo "@reboot bash $DIR/start.sh >> /tmp/agent-monitor.log 2>&1 # agent-monitor" >> "$TMP"
  echo "*/15 * * * * bash $DIR/start.sh >> /tmp/agent-monitor.log 2>&1 # agent-monitor" >> "$TMP"
  crontab "$TMP"
  rm -f "$TMP"
  echo "Installed cron entries. Verify: crontab -l | grep agent-monitor"
fi
```

- [ ] **Step 6: Create `monitor/uninstall.sh`:**

```bash
#!/usr/bin/env bash
# Agent Monitor — remove autostart entries installed by install.sh.
set -euo pipefail

if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  systemctl --user disable --now agent-monitor.timer 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/agent-monitor.service" \
        "$HOME/.config/systemd/user/agent-monitor.timer"
  systemctl --user daemon-reload
fi
TMP="$(mktemp)"
crontab -l 2>/dev/null | grep -v '# agent-monitor$' > "$TMP" || true
crontab "$TMP" 2>/dev/null || true
rm -f "$TMP"
echo "Removed Agent Monitor autostart entries."
```

- [ ] **Step 7: Verify scripts**

```bash
chmod +x monitor/install.sh monitor/uninstall.sh
bash -n monitor/install.sh && bash -n monitor/uninstall.sh && echo "sh OK"
```

Expected: `sh OK`. (The `.bat` files can only be exercised on a Windows machine — note this in the PR/handoff; syntax is plain `schtasks` usage.)

- [ ] **Step 8: Commit**

```bash
git add monitor/run.bat monitor/start.bat monitor/install.bat monitor/uninstall.bat monitor/install.sh monitor/uninstall.sh
git commit -m "feat: run-at-startup installers (Task Scheduler / systemd user timer)"
```

---

### Task 11: Documentation updates

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `.env.example` (root — no change needed unless verifying; see step 2)

**Interfaces:** none — docs only.

- [ ] **Step 1: Update `CLAUDE.md`**

(a) In the "Repository layout" block, replace the `monitor/` section with:

```
monitor/      Standalone capture agent — drop on any coder's machine
  agent.js          Zero-dependency Node.js capture script
  env.example       Config template (copy to .env)
  run.bat           Silent runner (used by Task Scheduler)
  start.bat         Interactive launcher (Windows)
  start.sh          Cron/manual launcher (Linux/macOS)
  install.bat/.sh   Register autostart (logon/boot + every 15 min)
  uninstall.bat/.sh Remove autostart
  setup-terminal-hook.sh  Shell hook installer for terminal-only users
  test/             node:test unit tests (node --test test/)
```

(b) In the `.env` template shown under "How the capture works", add a line:

```
TEAM_NAME=<optional team tag>
```

(c) In the "Key API endpoints" table, add rows:

```
| `POST /heartbeat` | Agent liveness ping (Bearer ingest token) |
| `GET /api/file-events` | Per-file activity from agent tool calls |
| `GET /api/fleet` | Agent fleet health (last seen, version) |
```

(d) After the endpoints table sentence about session auth, add:

```
Two dashboard roles: `super_admin` (all data) and `team_lead` (own team's coders
only; enforced server-side, 403 on foreign drilldowns). Users/teams are created
with `backend/scripts/manage.js` or direct DB inserts — there is no management UI.
```

(e) Fix any remaining `agent.env.example` references → `env.example`.

- [ ] **Step 2: Update `README.md`**

(a) In the coder-machine `.env` example block, add `TEAM_NAME=<team>` after `CODER_NAME`.

(b) After the "Deploy the capture agent" section, add:

```markdown
### 3. Enable autostart (recommended)

- **Windows:** double-click `monitor/install.bat` — registers Task Scheduler
  entries that run the capture at logon and every 15 minutes.
- **Linux/macOS:** `bash monitor/install.sh` — installs a systemd user timer
  (cron fallback) doing the same. Remove with the matching `uninstall` script.
```

(c) Fix any `agent.env.example` references → `env.example`.

- [ ] **Step 3: Final full verification**

```bash
cd backend && npm test && cd ../monitor && node --test test/ && node --check agent.js
```

Expected: everything passes.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: teams/roles, autostart installers, new endpoints"
```

---

## Deliberately deferred (do NOT implement in this plan)

- A team filter/column on the main dashboard (`index.html`). The `team` field is
  already exposed via `/api/report` (Task 2); wiring it into the main-page UI is a
  separate small change that requires reading `index.html`'s render code first.
- Everything in PLAN.md Phases 2–5 (incremental capture, cost views, alerts, SSO,
  .exe packaging, …).

## Post-plan notes for the executor

- **Order matters:** Tasks 1→5 are sequential (each builds on the previous). Task 6 only depends on nothing; Tasks 7–8 depend on 6 (payload shape) and 4 (scoping). Task 9 depends on 2 and 4. Task 10 is independent. Task 11 last.
- **First login after deploy:** use the env `ADMIN_TOKEN` (bootstrap super admin), then create real users: `cd backend && node scripts/manage.js add-user <name> super_admin`.
- **OpenCode tool-part schema is defensive by design** (`opencodeToolEvent` accepts several shapes). If a real OpenCode install yields zero file events, run `node agent.js --debug-opencode` and adjust the field names in that one function only.
- The `.bat` files must be manually tested on a Windows machine; everything else is covered by automated tests.

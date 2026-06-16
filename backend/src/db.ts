import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { RETENTION_DAYS } from './config';

/**
 * SQLite store for interactions + an access log (§7: access to monitoring data is
 * itself logged). Local file under backend/data/. Stands in for the production DB.
 */
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'monitor.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS interactions (
    interaction_id TEXT PRIMARY KEY,
    coder TEXT NOT NULL,
    ips TEXT,
    agent TEXT,
    model TEXT,
    prompt TEXT,                 -- already redacted by the client
    task_class TEXT,
    task_confidence REAL,
    workspace TEXT,
    git_branch TEXT,
    session_id TEXT,
    ts TEXT,                     -- original event timestamp
    received_at TEXT NOT NULL,   -- when the backend stored it (retention basis)
    tokens_in INTEGER, tokens_out INTEGER,
    tokens_cache_read INTEGER, tokens_cache_create INTEGER,
    model_confidence TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_coder ON interactions(coder);
  CREATE TABLE IF NOT EXISTS access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    actor TEXT,                  -- which token/role accessed
    action TEXT,                 -- e.g. report, drilldown:<coder>
    detail TEXT
  );
`);

export interface IngestRow {
  interactionId: string;
  coder: string;
  ips: string[];
  agent: string;
  model: string | null;
  prompt: string | null;
  taskClass: string;
  taskConfidence: number;
  workspace: string | null;
  gitBranch: string | null;
  sessionId: string | null;
  timestamp: string | null;
  tokens: { input: number; output: number; cacheRead: number; cacheCreate: number };
  modelConfidence: string;
}

const insert = db.prepare(`
  INSERT OR IGNORE INTO interactions
  (interaction_id, coder, ips, agent, model, prompt, task_class, task_confidence,
   workspace, git_branch, session_id, ts, received_at,
   tokens_in, tokens_out, tokens_cache_read, tokens_cache_create, model_confidence)
  VALUES (@interaction_id,@coder,@ips,@agent,@model,@prompt,@task_class,@task_confidence,
   @workspace,@git_branch,@session_id,@ts,@received_at,
   @tokens_in,@tokens_out,@tokens_cache_read,@tokens_cache_create,@model_confidence)
`);

export function ingestMany(rows: IngestRow[]): number {
  const now = new Date().toISOString();
  const tx = db.transaction((items: IngestRow[]) => {
    let n = 0;
    for (const r of items) {
      const info = insert.run({
        interaction_id: r.interactionId,
        coder: r.coder,
        ips: JSON.stringify(r.ips ?? []),
        agent: r.agent,
        model: r.model,
        prompt: r.prompt,
        task_class: r.taskClass,
        task_confidence: r.taskConfidence,
        workspace: r.workspace,
        git_branch: r.gitBranch,
        session_id: r.sessionId,
        ts: r.timestamp,
        received_at: now,
        tokens_in: r.tokens.input,
        tokens_out: r.tokens.output,
        tokens_cache_read: r.tokens.cacheRead,
        tokens_cache_create: r.tokens.cacheCreate,
        model_confidence: r.modelConfidence,
      });
      n += info.changes;
    }
    return n;
  });
  return tx(rows);
}

export interface CoderSummary {
  coder: string;
  sessions: number;
  claude: number;
  opencode: number;
  tokens_in: number;
  tokens_out: number;
  simple_on_opus: number;
  ips: string[];
}

export interface TokensByModel {
  coder: string;
  model: string;
  sessions: number;
  tokens_in: number;
  tokens_out: number;
  tokens_cache_read: number;
  tokens_cache_create: number;
}

export function summaryByCoder(): CoderSummary[] {
  const rows = db
    .prepare(
      `SELECT coder,
              COUNT(*) sessions,
              SUM(agent='claude_code') claude,
              SUM(agent='opencode') opencode,
              SUM(tokens_in) tokens_in,
              SUM(tokens_out) tokens_out,
              SUM(task_class='simple' AND model LIKE 'claude-opus%') simple_on_opus
       FROM interactions GROUP BY coder ORDER BY coder`
    )
    .all() as any[];
  return rows.map((r) => {
    const ipRows = db
      .prepare('SELECT DISTINCT ips FROM interactions WHERE coder=?')
      .all(r.coder) as any[];
    const ips = new Set<string>();
    for (const ir of ipRows) {
      try {
        for (const ip of JSON.parse(ir.ips) as string[]) {
          ips.add(ip);
        }
      } catch {
        /* ignore */
      }
    }
    return { ...r, ips: [...ips] } as CoderSummary;
  });
}

/** Per-coder per-model token breakdown — for the "who's spending what" view. */
export function tokensByModel(): TokensByModel[] {
  return db
    .prepare(
      `SELECT coder,
              COALESCE(model, 'unknown') model,
              COUNT(*) sessions,
              SUM(tokens_in) tokens_in,
              SUM(tokens_out) tokens_out,
              SUM(tokens_cache_read) tokens_cache_read,
              SUM(tokens_cache_create) tokens_cache_create
       FROM interactions
       GROUP BY coder, model
       ORDER BY coder, tokens_in DESC`
    )
    .all() as TokensByModel[];
}

/** Per-coder prompt drill-down (§7 role-gated; caller must be admin). */
export function interactionsForCoder(coder: string, limit = 100): any[] {
  return db
    .prepare(
      `SELECT interaction_id, ts, agent, model, task_class, prompt, git_branch
       FROM interactions WHERE coder=? ORDER BY ts DESC LIMIT ?`
    )
    .all(coder, limit);
}

export function logAccess(actor: string, action: string, detail = ''): void {
  db.prepare('INSERT INTO access_log (at, actor, action, detail) VALUES (?,?,?,?)').run(
    new Date().toISOString(),
    actor,
    action,
    detail
  );
}

/** Delete rows older than the retention window (§7). Returns rows removed. */
export function pruneRetention(): number {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();
  return db.prepare('DELETE FROM interactions WHERE received_at < ?').run(cutoff).changes;
}

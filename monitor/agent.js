#!/usr/bin/env node
/**
 * Agent Monitor — Capture Agent
 * Drop this file + a .env into any folder on any coder's PC and run:
 *   node agent.js
 * Zero npm dependencies — uses only built-in Node.js modules.
 * Works on Windows, Linux, macOS.
 */
'use strict';

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// ── Load .env from same directory as this script ──────────────────────────────
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1]) {
      const val = m[2].replace(/^["']|["']$/g, '');
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  }
}

const INGEST_URL   = (process.env.INGEST_URL || '').replace(/\/$/, '');
const INGEST_TOKEN = process.env.INGEST_TOKEN || '';
const CODER        = process.env.CODER_NAME  || (() => {
  try { return os.userInfo().username || 'unknown'; } catch { return 'unknown'; }
})();
const CLAUDE_EMAIL   = process.env.CLAUDE_ACCOUNT_EMAIL   || '';
const OPENCODE_EMAIL = process.env.OPENCODE_ACCOUNT_EMAIL || '';

if (!INGEST_URL || !INGEST_TOKEN) {
  console.error('ERROR: Set INGEST_URL and INGEST_TOKEN in .env (see agent.env.example)');
  process.exit(1);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const emptyTok = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });

// ── Identity ──────────────────────────────────────────────────────────────────
function localIps() {
  const out = [];
  try {
    for (const ifaces of Object.values(os.networkInterfaces() || {}))
      for (const ni of (ifaces || []))
        if (!ni.internal && ni.address) out.push(ni.address);
  } catch {}
  return out;
}

function claudeAccountId() {
  try {
    const f = path.join(os.homedir(), '.claude', '.credentials.json');
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    return CLAUDE_EMAIL || (d.organizationUuid ? String(d.organizationUuid) : null);
  } catch { return CLAUDE_EMAIL || null; }
}

function opencodeAccountId() {
  if (OPENCODE_EMAIL) return OPENCODE_EMAIL;
  const home = os.homedir();
  for (const p of [
    path.join(home, '.config', 'opencode', 'config.json'),
    path.join(home, '.opencode', 'config.json'),
    path.join(home, '.config', 'opencode', 'auth.json'),
  ]) {
    try {
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      const id = d.email || d.user || d.username || d.account || d.userId;
      if (id) return String(id);
    } catch {}
  }
  return null;
}

// ── Task classifier ───────────────────────────────────────────────────────────
const CRITICAL_KW = ['concurrency','race condition','deadlock','mutex','thread','security','auth','authentication','authorization','crypto','encryption','vulnerability','exploit','architecture','algorithm','optimize','performance','memory leak','distributed','migration','debug','root cause'];
const SIMPLE_KW   = ['crud','getter','setter','boilerplate','rename','typo','comment','format','lint','config','readme','docstring','stub','scaffold','add a field','simple test'];

function classify(prompt) {
  const t = (prompt || '').toLowerCase();
  const c = CRITICAL_KW.reduce((n, w) => t.includes(w) ? n + 1 : n, 0);
  const s = SIMPLE_KW.reduce((n, w)   => t.includes(w) ? n + 1 : n, 0);
  if (c > s) return { taskClass: 'critical', confidence: Math.min(0.5 + 0.2 * (c - s), 0.95) };
  if (s > c) return { taskClass: 'simple',   confidence: Math.min(0.5 + 0.2 * (s - c), 0.95) };
  return { taskClass: 'moderate', confidence: 0.3 };
}

// ── Secret redaction ──────────────────────────────────────────────────────────
const REDACT = [
  [/sk-ant-[A-Za-z0-9_\-]{10,}/g,                                        'anthropic-key'],
  [/sk-[A-Za-z0-9]{20,}/g,                                               'openai-key'],
  [/AKIA[0-9A-Z]{16}/g,                                                  'aws-access-key'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g,                                        'github-token'],
  [/\bBearer\s+[A-Za-z0-9._\-]{10,}/gi,                                  'bearer'],
  [/\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g, 'jwt'],
  [/\b(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S+/gi,        'secret'],
];
function redact(text) {
  if (!text) return text;
  let out = text;
  for (const [re, name] of REDACT) out = out.replace(re, `[REDACTED:${name}]`);
  return out;
}

// ── Git file-change stats ─────────────────────────────────────────────────────
const _gitCache = new Map();
function gitDiffStat(workspace) {
  if (!workspace || _gitCache.has(workspace)) return _gitCache.get(workspace) || [];
  try {
    const raw = execSync('git diff --numstat HEAD', {
      cwd: workspace, timeout: 5000, encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const changes = [];
    for (const line of raw.split('\n')) {
      const m = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (m) changes.push({ file: m[3].trim(), added: +m[1], removed: +m[2] });
    }
    // Also include files from recent commits (since yesterday)
    try {
      const since = new Date(Date.now() - 86400_000).toISOString();
      const log = execSync(`git log --since="${since}" --numstat --format=|`, {
        cwd: workspace, timeout: 5000, encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
      });
      for (const line of log.split('\n')) {
        if (line.startsWith('|')) continue;
        const m = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
        if (!m) continue;
        const existing = changes.find(c => c.file === m[3].trim());
        if (existing) { existing.added += +m[1]; existing.removed += +m[2]; }
        else changes.push({ file: m[3].trim(), added: +m[1], removed: +m[2] });
      }
    } catch {}
    _gitCache.set(workspace, changes);
    return changes;
  } catch {
    _gitCache.set(workspace, []);
    return [];
  }
}

// ── Parse Claude Code session logs ───────────────────────────────────────────
function claudeText(content) {
  if (typeof content === 'string') return content.trim() || null;
  if (Array.isArray(content)) {
    for (const b of content)
      if (b && b.type === 'text') { const t = String(b.text || '').trim(); if (t) return t; }
  }
  return null;
}

function parseClaude(file) {
  let parsed;
  try {
    parsed = fs.readFileSync(file, 'utf8').split('\n')
      .map(l => { try { return l.trim() ? JSON.parse(l.trim()) : null; } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
  if (!parsed.length) return [];

  const sessionId = (parsed.find(o => o.sessionId) || {}).sessionId || null;
  const workspace = (parsed.find(o => o.cwd)       || {}).cwd       || null;
  const gitBranch = (parsed.find(o => o.gitBranch) || {}).gitBranch || null;
  const results   = [];

  for (let i = 0; i < parsed.length; i++) {
    const o = parsed[i];
    if (o.type !== 'user' || o.promptSource === 'command') continue;
    if (!o.message || typeof o.message !== 'object') continue;
    const p = claudeText(o.message.content);
    if (!p || p.startsWith('<')) continue;

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
  }
  return results;
}

function readClaude() {
  const root = path.join(os.homedir(), '.claude', 'projects');
  const res = [];
  try {
    for (const proj of fs.readdirSync(root)) {
      const dir = path.join(root, proj);
      try {
        for (const f of fs.readdirSync(dir))
          if (f.endsWith('.jsonl')) res.push(...parseClaude(path.join(dir, f)));
      } catch {}
    }
  } catch {}
  return res;
}

// ── Parse OpenCode SQLite database ───────────────────────────────────────────
function findSqlite3() {
  const candidates = ['sqlite3'];
  if (process.platform === 'win32') {
    candidates.push(
      'C:\\sqlite\\sqlite3.exe',
      'C:\\sqlite3\\sqlite3.exe',
      'C:\\Program Files\\SQLite\\sqlite3.exe',
      path.join(os.homedir(), 'sqlite3.exe'),
      path.join(os.homedir(), 'Downloads', 'sqlite3.exe'),
    );
  }
  for (const c of candidates) {
    try { execSync(`"${c}" --version`, { stdio:'ignore', timeout:3000, windowsHide:true }); return c; } catch {}
  }
  return null;
}

function sqliteJSON(cli, db, sql) {
  try {
    const out = execSync(`"${cli}" -json -readonly "${db}" "${sql.replace(/"/g, "'")}"`, {
      encoding:'utf8', timeout:30000, windowsHide:true,
      stdio:['ignore','pipe','ignore'], maxBuffer:200*1024*1024,
    });
    return JSON.parse(out || '[]');
  } catch { return []; }
}

function sqliteCols(cli, db, table) {
  return sqliteJSON(cli, db, `PRAGMA table_info(${table})`).map(c => c.name);
}

function readOpencodeDB(dbPath) {
  const cli = findSqlite3();
  if (!cli) {
    console.log('[opencode] sqlite3 not in PATH — install from https://sqlite.org/download.html and add to PATH');
    return [];
  }

  // Discover schema
  let tables;
  try {
    const raw = execSync(`"${cli}" "${dbPath}" ".tables"`,
      { encoding:'utf8', timeout:5000, windowsHide:true, stdio:['ignore','pipe','ignore'] });
    tables = (raw||'').trim().split(/\s+/).filter(Boolean);
  } catch(e) { console.log('[opencode] DB open error:', e.message); return []; }

  console.log('[opencode] tables:', tables.join(', '));

  if (!tables.includes('message')) {
    console.log('[opencode] no message table found — schema not recognised');
    return [];
  }

  const msgCols  = sqliteCols(cli, dbPath, 'message');
  const sesCols  = tables.includes('session') ? sqliteCols(cli, dbPath, 'session') : [];
  const partCols = tables.includes('part')    ? sqliteCols(cli, dbPath, 'part')    : [];

  // Resolve column names across schema versions
  const mTime  = ['time','created_at','timestamp'].find(c => msgCols.includes(c)) || null;
  const mRole  = ['role','type','speaker'].find(c => msgCols.includes(c)) || null;
  const mSesId = ['session_id','sessionId','session'].find(c => msgCols.includes(c)) || null;
  const sCwd   = ['cwd','path','directory','workspace'].find(c => sesCols.includes(c)) || null;
  const sModel = ['model','model_id','modelId'].find(c => sesCols.includes(c)) || null;

  if (!mRole) { console.log('[opencode] cannot find role column in message:', msgCols.join(',')); return []; }

  // Build user-message query
  const sel = [
    `m.id`,
    mSesId ? `m.${mSesId} AS session_id` : `NULL AS session_id`,
    mTime  ? `m.${mTime}  AS time`        : `NULL AS time`,
    sCwd   ? `s.${sCwd}   AS cwd`         : `NULL AS cwd`,
    sModel ? `s.${sModel} AS model`       : `NULL AS model`,
  ].join(', ');
  const join = (tables.includes('session') && mSesId && sCwd)
    ? `LEFT JOIN session s ON s.id = m.${mSesId}` : '';
  const userRoles = ["'user'", "'human'"].join(',');

  const messages = sqliteJSON(cli, dbPath,
    `SELECT ${sel} FROM message m ${join} WHERE m.${mRole} IN (${userRoles}) ORDER BY ${mTime || 'm.id'}`);

  if (!messages.length) { console.log('[opencode] 0 user messages found'); return []; }

  // Get content from part table or message table
  const contentCol = ['content','text','body'].find(c => msgCols.includes(c)) || null;
  const pContent   = ['content','text','body'].find(c => partCols.includes(c)) || null;
  const pMsgId     = ['message_id','messageId','msg_id'].find(c => partCols.includes(c)) || null;
  const pType      = ['type'].find(c => partCols.includes(c)) || null;
  const pTokIn     = ['tokens_input','input_tokens','tokens_in'].find(c => partCols.includes(c)) || null;
  const pTokOut    = ['tokens_output','output_tokens','tokens_out'].find(c => partCols.includes(c)) || null;

  // Load parts indexed by message_id for token counts
  const partsByMsg = {};
  if (tables.includes('part') && pMsgId) {
    const parts = sqliteJSON(cli, dbPath, `SELECT * FROM part WHERE ${pType ? `${pType}='text' OR ${pType}='tool-result' OR ` : ''}1=1 LIMIT 50000`);
    for (const p of parts) {
      const mid = p[pMsgId] || p.message_id;
      if (!partsByMsg[mid]) partsByMsg[mid] = [];
      partsByMsg[mid].push(p);
    }
  }

  // Look ahead: get assistant messages for token counts (when content is in message table)
  const assistantTok = {};
  if (contentCol) {
    const assMsgs = sqliteJSON(cli, dbPath,
      `SELECT m.id, ${mSesId ? `m.${mSesId} AS session_id,` : ''} ${mTime ? `m.${mTime} AS time,` : ''} m.${contentCol} AS content FROM message m WHERE m.${mRole} IN ('assistant','ai') LIMIT 10000`);
    for (const a of assMsgs) assistantTok[a.session_id] = a; // last assistant per session
  }

  const results = [];
  for (const m of messages) {
    // Extract prompt text
    let prompt = null;
    if (contentCol && msgCols.includes(contentCol)) {
      const raw = m[contentCol] || m.content;
      if (typeof raw === 'string') {
        // May be JSON array of content blocks
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) prompt = parsed.filter(b=>b&&b.type==='text').map(b=>b.text).join('\n').trim() || null;
          else if (parsed && parsed.text) prompt = String(parsed.text).trim() || null;
          else prompt = raw.trim() || null;
        } catch { prompt = raw.trim() || null; }
      }
    }
    if (!prompt && partsByMsg[m.id]) {
      const textParts = partsByMsg[m.id].filter(p => !pType || p[pType]==='text' || p[pType]==='content');
      prompt = textParts.map(p => {
        const c = pContent ? p[pContent] : p.content || p.text || '';
        if (typeof c === 'string') { try { const j=JSON.parse(c); return j&&j.text?j.text:c; } catch { return c; } }
        return '';
      }).join('\n').trim() || null;
    }
    if (!prompt) continue;

    // Token counts from parts of the NEXT assistant message in same session
    let tokIn = 0, tokOut = 0;
    const aparts = partsByMsg[m.id] || [];
    for (const p of aparts) {
      tokIn  += Number(pTokIn  ? p[pTokIn]  : 0) || 0;
      tokOut += Number(pTokOut ? p[pTokOut] : 0) || 0;
    }

    // Timestamp — may be epoch ms or ISO string
    let ts = m.time || null;
    if (ts && typeof ts === 'number') ts = new Date(ts).toISOString();

    results.push({
      agent: 'opencode',
      model: m.model || null,
      prompt,
      workspace: m.cwd || null,
      gitBranch: null,
      sessionId: m.session_id || sha1(m.id||prompt).slice(0,16),
      timestamp: ts,
      tokens: { input: tokIn, output: tokOut, cacheRead: 0, cacheCreate: 0 },
      modelConfidence: 'inferred',
    });
  }

  console.log(`[opencode] DB → ${results.length} user prompt(s) from ${messages.length} message(s)`);
  return results;
}

function opencodeRoots() {
  const home = os.homedir();
  const appdata = process.env.APPDATA || '';
  const local   = process.env.LOCALAPPDATA || '';
  return [
    process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, 'opencode') : null,
    path.join(home, '.local', 'share', 'opencode'),
    path.join(home, '.config', 'opencode'),
    path.join(home, '.opencode'),
    appdata ? path.join(appdata, 'opencode') : null,
    appdata ? path.join(appdata, 'OpenCode') : null,
    local   ? path.join(local,   'opencode') : null,
    local   ? path.join(local,   'OpenCode') : null,
  ].filter(Boolean);
}

function scanOpencodeFiles(dir, out, depth) {
  if (depth > 6) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { scanOpencodeFiles(full, out, depth + 1); continue; }
    if (!e.isFile()) continue;
    try {
      const stat = fs.statSync(full);
      const head = fs.readFileSync(full).slice(0, 120).toString('utf8').replace(/\n/g,' ');
      out.push({ path: full, size: stat.size, head });
    } catch { out.push({ path: full, size: -1, head: '(unreadable)' }); }
  }
}

function readOpencode() {
  const roots = opencodeRoots();
  const res = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    // Prefer SQLite database
    const dbPath = path.join(root, 'opencode.db');
    if (fs.existsSync(dbPath)) {
      console.log(`[opencode] found DB: ${dbPath}`);
      res.push(...readOpencodeDB(dbPath));
      return res; // only read first found DB
    }
  }
  if (!res.length) console.log('[opencode] opencode.db not found in any known location');
  return res;
}

function runScan() {
  const roots = opencodeRoots();
  console.log('\n=== OpenCode directory scan ===');
  let any = false;
  for (const root of roots) {
    if (!fs.existsSync(root)) { console.log(`  MISSING  ${root}`); continue; }
    console.log(`  FOUND    ${root}`);
    any = true;
    const files = [];
    scanOpencodeFiles(root, files, 0);
    if (!files.length) { console.log('    (empty)'); continue; }
    for (const f of files) {
      console.log(`    [${String(f.size).padStart(8)} B]  ${f.path}`);
      console.log(`              ${f.head.slice(0, 100)}`);
    }
  }
  if (!any) console.log('\nNo OpenCode directories found on this machine.');
  console.log('\nShare this output so the correct log format can be added to agent.js\n');
}

// ── Ship to backend ───────────────────────────────────────────────────────────
function post(url, token, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, 'utf8');
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? require('https') : require('http');
    const req = lib.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'content-length': buf.length,
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const ips          = localIps();
  const claudeAcct   = claudeAccountId();
  const opencodeAcct = opencodeAccountId();
  const raws         = [...readClaude(), ...readOpencode()];

  const records = raws.map(raw => {
    const cl   = classify(raw.prompt);
    const seed = `${CODER}|${raw.agent}|${raw.sessionId}|${raw.timestamp}`;
    return {
      interactionId:   sha1(seed).slice(0, 16),
      coder:           CODER,
      ips,
      agentAccountId:  raw.agent === 'claude_code' ? claudeAcct : opencodeAcct,
      agent:           raw.agent,
      model:           raw.model,
      prompt:          redact(raw.prompt),
      taskClass:       cl.taskClass,
      taskConfidence:  cl.confidence,
      workspace:       raw.workspace,
      gitBranch:       raw.gitBranch,
      sessionId:       raw.sessionId,
      timestamp:       raw.timestamp,
      tokens:          raw.tokens,
      modelConfidence: raw.modelConfidence,
      gitChanges:      raw.workspace ? gitDiffStat(raw.workspace) : [],
    };
  });

  console.log(`[${new Date().toISOString()}] coder="${CODER}" prompts=${records.length}`);

  const result = await post(INGEST_URL + '/ingest', INGEST_TOKEN, JSON.stringify({ records }));
  if (result.error) {
    console.error('Ingest error:', result.error);
    process.exit(1);
  }
  console.log(`Sent: received=${result.received}, newly stored=${result.stored}`);
}

if (process.argv.includes('--scan')) { runScan(); }
else { main().catch(e => { console.error(String(e)); process.exit(1); }); }

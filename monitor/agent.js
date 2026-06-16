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
const CLAUDE_EMAIL = process.env.CLAUDE_ACCOUNT_EMAIL || '';

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

// ── Parse OpenCode session logs ───────────────────────────────────────────────
function walkOpencode(dir, res, depth) {
  if (depth > 6) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walkOpencode(full, res, depth + 1); continue; }
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    try {
      const o = JSON.parse(fs.readFileSync(full, 'utf8'));
      const recs = Array.isArray(o) ? o : [o];
      const r = { agent: 'opencode', model: null, prompt: null, workspace: null, gitBranch: null, sessionId: null, timestamp: null, tokens: emptyTok(), modelConfidence: 'inferred' };
      for (const x of recs) {
        if (!x || typeof x !== 'object') continue;
        if (!r.model)     r.model     = x.model || x.modelID || null;
        if (!r.sessionId) r.sessionId = x.sessionID || x.id || null;
        if (!r.timestamp) r.timestamp = x.time || x.timestamp || null;
        if (!r.prompt && (x.role === 'user' || x.type === 'user')) {
          const c = x.text || x.content || x.prompt;
          r.prompt = typeof c === 'string' ? c.trim() || null : null;
        }
        const u = x.usage || x.tokens || {};
        r.tokens.input  += Number(u.input  || u.input_tokens  || 0) || 0;
        r.tokens.output += Number(u.output || u.output_tokens || 0) || 0;
      }
      if (r.prompt || r.sessionId) res.push(r);
    } catch {}
  }
}

function readOpencode() {
  const home = os.homedir();
  const roots = [
    process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, 'opencode') : null,
    path.join(home, '.local', 'share', 'opencode'),
    path.join(home, '.config', 'opencode'),
    path.join(home, '.opencode'),
  ].filter(Boolean);
  const res = [];
  for (const root of roots) if (fs.existsSync(root)) walkOpencode(root, res, 0);
  return res;
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

main().catch(e => { console.error(String(e)); process.exit(1); });

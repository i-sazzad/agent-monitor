import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Raw fields recoverable from a session log, before enrichment. */
export interface RawSession {
  agent: 'claude_code' | 'opencode';
  model: string | null;
  prompt: string | null;
  workspace: string | null;
  gitBranch: string | null;
  sessionId: string | null;
  timestamp: string | null;
  tokens: { input: number; output: number; cacheRead: number; cacheCreate: number };
  modelConfidence: 'authoritative' | 'inferred';
}

function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
}

// ---- Claude Code (verified format) ----
function claudeText(content: unknown): string | null {
  if (typeof content === 'string') {
    return content.trim() || null;
  }
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b && typeof b === 'object' && (b as any).type === 'text') {
        const t = String((b as any).text ?? '').trim();
        if (t) {
          return t;
        }
      }
    }
  }
  return null;
}

function parseClaude(file: string): RawSession[] {
  let lines: string[];
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n');
  } catch {
    return [];
  }

  // Parse all non-empty lines upfront.
  const parsed: any[] = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    try { parsed.push(JSON.parse(s)); } catch { continue; }
  }
  if (!parsed.length) return [];

  // Extract session-level metadata from whichever line has it first.
  const sessionId  = parsed.find((o: any) => o.sessionId)?.sessionId  ?? null;
  const workspace  = parsed.find((o: any) => o.cwd)?.cwd              ?? null;
  const gitBranch  = parsed.find((o: any) => o.gitBranch)?.gitBranch  ?? null;

  const results: RawSession[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const o = parsed[i];
    // Only real user turns (skip command injections and non-user entries).
    if (o.type !== 'user' || o.promptSource === 'command') continue;
    const m = o.message;
    if (!m || typeof m !== 'object') continue;
    const p = claudeText(m.content);
    if (!p || p.startsWith('<')) continue;

    // Collect tokens + model from the assistant turn(s) that follow this user turn.
    const tokens = emptyTokens();
    let model: string | null = null;
    for (let j = i + 1; j < parsed.length; j++) {
      const next = parsed[j];
      if (next.type === 'user') break; // next user turn starts
      if (next.type !== 'assistant') continue;
      const nm = next.message;
      if (!nm || typeof nm !== 'object') continue;
      if (nm.model && !out_isSynthetic(nm.model) && !model) model = String(nm.model);
      const u = nm.usage;
      if (u && typeof u === 'object') {
        tokens.input  += u.input_tokens                  ?? 0;
        tokens.output += u.output_tokens                 ?? 0;
        tokens.cacheRead   += u.cache_read_input_tokens   ?? 0;
        tokens.cacheCreate += u.cache_creation_input_tokens ?? 0;
      }
    }

    results.push({
      agent: 'claude_code',
      model,
      prompt: p,
      workspace,
      gitBranch,
      sessionId,
      timestamp: o.timestamp ?? null,
      tokens,
      modelConfidence: 'authoritative',
    });
  }

  return results;
}

function out_isSynthetic(model: string): boolean {
  return model === '<synthetic>' || model.startsWith('<');
}

export function readClaude(): RawSession[] {
  const root = path.join(os.homedir(), '.claude', 'projects');
  const res: RawSession[] = [];
  let projects: string[];
  try {
    projects = fs.readdirSync(root);
  } catch {
    return res;
  }
  for (const proj of projects) {
    const dir = path.join(root, proj);
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (f.endsWith('.jsonl')) {
        res.push(...parseClaude(path.join(dir, f)));
      }
    }
  }
  return res;
}

// ---- OpenCode (best-effort, unverified — confirm on a real install) ----
export function readOpencode(): RawSession[] {
  const home = os.homedir();
  const roots = [
    process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, 'opencode') : '',
    path.join(home, '.local', 'share', 'opencode'),
    path.join(home, '.config', 'opencode'),
    path.join(home, '.opencode'),
  ].filter(Boolean);
  const res: RawSession[] = [];
  for (const root of roots) {
    if (fs.existsSync(root)) {
      walk(root, res, 0);
    }
  }
  return res;
}

function walk(dir: string, res: RawSession[], depth: number): void {
  if (depth > 6) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, res, depth + 1);
    } else if (e.isFile() && e.name.endsWith('.json')) {
      try {
        const o = JSON.parse(fs.readFileSync(full, 'utf8'));
        const recs = Array.isArray(o) ? o : [o];
        const r: RawSession = {
          agent: 'opencode', model: null, prompt: null, workspace: null,
          gitBranch: null, sessionId: null, timestamp: null,
          tokens: emptyTokens(), modelConfidence: 'inferred',
        };
        for (const x of recs) {
          if (!x || typeof x !== 'object') {
            continue;
          }
          r.model ??= x.model ?? x.modelID ?? null;
          r.sessionId ??= x.sessionID ?? x.id ?? null;
          r.timestamp ??= x.time ?? x.timestamp ?? null;
          if (!r.prompt && (x.role === 'user' || x.type === 'user')) {
            const c = x.text ?? x.content ?? x.prompt;
            r.prompt = typeof c === 'string' ? c.trim() || null : null;
          }
          const u = x.usage ?? x.tokens ?? {};
          r.tokens.input += Number(u.input ?? u.input_tokens ?? 0) || 0;
          r.tokens.output += Number(u.output ?? u.output_tokens ?? 0) || 0;
        }
        res.push(r);
      } catch {
        // ignore non-JSON / unreadable
      }
    }
  }
}

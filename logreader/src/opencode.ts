import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LoggedInteraction, emptyTokens } from './types';

/**
 * OpenCode log reader — BEST-EFFORT / UNVERIFIED.
 *
 * OpenCode was not installed on the spike machine, so this parser is written to
 * documented/expected layouts and MUST be re-checked against a real install
 * before relying on it. Assumptions (mark these for the follow-up):
 *   - Data lives under one of the XDG paths in `opencodeRoots()`.
 *   - Sessions are stored as JSON (per-message files or a sessions index),
 *     carrying a model id, a token/usage block, and user message text.
 * The parser is deliberately defensive: it reads any *.json under those roots,
 * pulls model/usage/prompt from a set of likely field names, and flags low
 * confidence. When the format is confirmed, tighten this and drop the guesses.
 */

export function opencodeRoots(): string[] {
  const home = os.homedir();
  const xdg = process.env.XDG_DATA_HOME;
  return [
    xdg ? path.join(xdg, 'opencode') : '',
    path.join(home, '.local', 'share', 'opencode'),
    path.join(home, '.config', 'opencode'),
    path.join(home, '.opencode'),
  ].filter(Boolean);
}

function pick(o: any, keys: string[]): any {
  for (const k of keys) {
    if (o && o[k] != null) {
      return o[k];
    }
  }
  return undefined;
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseOpencodeFile(file: string): LoggedInteraction | null {
  let o: any;
  try {
    o = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  // Could be a single object or an array of messages — normalize to a list.
  const records: any[] = Array.isArray(o) ? o : [o];

  const out: LoggedInteraction = {
    agent: 'opencode',
    model: null,
    prompt: null,
    workspace: null,
    gitBranch: null,
    sessionId: null,
    timestamp: null,
    tokens: emptyTokens(),
    source: file,
    confidence: 'inferred', // unverified format
  };

  let got = false;
  for (const r of records) {
    if (!r || typeof r !== 'object') {
      continue;
    }
    got = true;
    out.model ??= (pick(r, ['model', 'modelID', 'model_id']) as string) ?? null;
    out.sessionId ??= (pick(r, ['sessionID', 'sessionId', 'session_id', 'id']) as string) ?? null;
    out.timestamp ??= (pick(r, ['time', 'timestamp', 'createdAt', 'created']) as string) ?? null;
    out.workspace ??= (pick(r, ['cwd', 'directory', 'path']) as string) ?? null;

    if (!out.prompt) {
      const role = pick(r, ['role', 'type']);
      if (role === 'user') {
        const c = pick(r, ['text', 'content', 'message', 'prompt']);
        out.prompt = typeof c === 'string' ? c.trim() || null : null;
      }
    }

    const usage = pick(r, ['usage', 'tokens']) ?? {};
    out.tokens.input += num(pick(usage, ['input', 'input_tokens', 'prompt_tokens']));
    out.tokens.output += num(pick(usage, ['output', 'output_tokens', 'completion_tokens']));
  }

  return got ? out : null;
}

export function readAllOpencodeSessions(roots = opencodeRoots()): LoggedInteraction[] {
  const results: LoggedInteraction[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }
    walk(root, results);
  }
  return results;
}

function walk(dir: string, results: LoggedInteraction[], depth = 0): void {
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
      walk(full, results, depth + 1);
    } else if (e.isFile() && e.name.endsWith('.json')) {
      const rec = parseOpencodeFile(full);
      if (rec) {
        results.push(rec);
      }
    }
  }
}

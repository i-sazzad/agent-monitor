import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LoggedInteraction, emptyTokens } from './types';

/**
 * Claude Code log reader. VERIFIED against real logs in this spike:
 * `~/.claude/projects/<slug>/<sessionId>.jsonl`, one JSON object per line.
 *
 * Per-session we recover: authoritative model, full token usage (incl. cache),
 * the user prompt text, cwd, gitBranch, sessionId, timestamps. We roll a session
 * up into ONE interaction (first user prompt + summed token usage) — the unit the
 * PRD §6 cares about. Tweak to per-turn later if needed.
 */

export function claudeRoot(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

function firstString(content: unknown): string | null {
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

export function parseClaudeSession(file: string): LoggedInteraction | null {
  let lines: string[];
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n');
  } catch {
    return null;
  }

  const out: LoggedInteraction = {
    agent: 'claude_code',
    model: null,
    prompt: null,
    workspace: null,
    gitBranch: null,
    sessionId: null,
    timestamp: null,
    tokens: emptyTokens(),
    source: file,
    confidence: 'authoritative',
  };

  let sawAnything = false;
  for (const line of lines) {
    const s = line.trim();
    if (!s) {
      continue;
    }
    let o: any;
    try {
      o = JSON.parse(s);
    } catch {
      continue;
    }
    sawAnything = true;

    out.sessionId ??= o.sessionId ?? null;
    out.workspace ??= o.cwd ?? null;
    out.gitBranch ??= o.gitBranch ?? null;
    out.timestamp ??= o.timestamp ?? null;

    const msg = o.message;
    if (msg && typeof msg === 'object') {
      if (msg.model && !out.model) {
        out.model = String(msg.model);
      }
      if (o.type === 'user' && !out.prompt) {
        out.prompt = firstString(msg.content);
      }
      const u = msg.usage;
      if (u && typeof u === 'object') {
        out.tokens.input += u.input_tokens ?? 0;
        out.tokens.output += u.output_tokens ?? 0;
        out.tokens.cacheRead += u.cache_read_input_tokens ?? 0;
        out.tokens.cacheCreate += u.cache_creation_input_tokens ?? 0;
      }
    }
  }

  return sawAnything ? out : null;
}

export function readAllClaudeSessions(root = claudeRoot()): LoggedInteraction[] {
  const results: LoggedInteraction[] = [];
  let projects: string[];
  try {
    projects = fs.readdirSync(root);
  } catch {
    return results;
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
        const rec = parseClaudeSession(path.join(dir, f));
        if (rec) {
          results.push(rec);
        }
      }
    }
  }
  return results;
}

/**
 * Secret redaction (PRD §7) — strip obvious credentials from prompt text BEFORE
 * it is stored. Best-effort and conservative: better to over-redact than to
 * persist a key. Tune patterns as needed.
 */
const PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_\-]{10,}/g },
  { name: 'openai-key', re: /sk-[A-Za-z0-9]{20,}/g },
  { name: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._\-]{10,}/gi },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g },
  { name: 'assignment-secret', re: /\b(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S+/gi },
];

export function redact(text: string | null): string | null {
  if (!text) {
    return text;
  }
  let out = text;
  for (const p of PATTERNS) {
    out = out.replace(p.re, `[REDACTED:${p.name}]`);
  }
  return out;
}

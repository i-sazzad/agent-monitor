/**
 * Rules-based task classifier (PRD §4.3). Descriptive label only — used here to
 * cross-tab agent vs. task class (the "Claude on an easy problem" cost signal).
 * It labels the work; it never judges the coder.
 */
export type TaskClass = 'simple' | 'moderate' | 'critical';

const CRITICAL = [
  'concurrency', 'race condition', 'race', 'deadlock', 'mutex', 'thread',
  'security', 'auth', 'authentication', 'authorization', 'crypto', 'encryption',
  'vulnerability', 'exploit', 'architecture', 'algorithm', 'optimize',
  'performance', 'memory leak', 'distributed', 'migration', 'debug', 'root cause',
];
const SIMPLE = [
  'crud', 'getter', 'setter', 'boilerplate', 'rename', 'typo', 'comment',
  'format', 'lint', 'config', 'readme', 'docstring', 'stub', 'scaffold',
  'add a field', 'add field', 'simple test',
];

function hits(t: string, words: string[]): number {
  return words.reduce((n, w) => (t.includes(w) ? n + 1 : n), 0);
}

export function classify(prompt: string | null): { taskClass: TaskClass; confidence: number } {
  const t = (prompt ?? '').toLowerCase();
  const c = hits(t, CRITICAL);
  const s = hits(t, SIMPLE);
  if (c > s) {
    return { taskClass: 'critical', confidence: Math.min(0.5 + 0.2 * (c - s), 0.95) };
  }
  if (s > c) {
    return { taskClass: 'simple', confidence: Math.min(0.5 + 0.2 * (s - c), 0.95) };
  }
  return { taskClass: 'moderate', confidence: 0.3 };
}

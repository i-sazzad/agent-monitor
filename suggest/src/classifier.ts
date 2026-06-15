/**
 * Local, rules-based prompt classifier (PRD §4.3 / §4.6).
 *
 * Descriptive only: it labels the *work*, it never judges the engineer's choice.
 * Prompt-time classification is intentionally weak (no diff/files yet, §4.6
 * accuracy caveat), so it also reports a confidence the caller uses to suppress
 * low-confidence hints rather than guessing.
 */

export type TaskClass = 'simple' | 'moderate' | 'critical';
export type Agent = 'claude_code' | 'opencode';

export interface Classification {
  taskClass: TaskClass;
  /** 0..1 — how strongly the keywords point at the chosen class. */
  confidence: number;
  /** Cost-suited agent for this class (reference context, never enforced). */
  suggested: Agent;
  /** Short human reason for the hint. */
  reason: string;
}

const CRITICAL = [
  'concurrency', 'race condition', 'race', 'deadlock', 'mutex', 'thread',
  'security', 'auth', 'authentication', 'authorization', 'crypto', 'encryption',
  'vulnerability', 'exploit', 'architecture', 'design pattern', 'algorithm',
  'optimize', 'performance', 'memory leak', 'distributed', 'consensus',
  'migration', 'debug', 'root cause', 'production incident',
];

const SIMPLE = [
  'crud', 'getter', 'setter', 'boilerplate', 'rename', 'typo', 'comment',
  'format', 'lint', 'config', 'readme', 'docstring', 'stub', 'scaffold',
  'add a field', 'add field', 'simple test', 'unit test for',
];

function countHits(text: string, words: string[]): number {
  let n = 0;
  for (const w of words) {
    if (text.includes(w)) {
      n++;
    }
  }
  return n;
}

export function classify(prompt: string): Classification {
  const text = prompt.toLowerCase();
  const critical = countHits(text, CRITICAL);
  const simple = countHits(text, SIMPLE);

  let taskClass: TaskClass;
  let strength: number;
  if (critical > simple) {
    taskClass = 'critical';
    strength = critical - simple;
  } else if (simple > critical) {
    taskClass = 'simple';
    strength = simple - critical;
  } else {
    taskClass = 'moderate';
    strength = 0;
  }

  // Map signal strength to a bounded confidence. Moderate (no signal) is the
  // low-confidence default that callers can choose to suppress.
  const confidence =
    taskClass === 'moderate' ? 0.3 : Math.min(0.5 + 0.2 * strength, 0.95);

  const suggested: Agent =
    taskClass === 'critical' ? 'claude_code' : 'opencode';

  const reason =
    taskClass === 'critical'
      ? 'looks like complex/critical work — Claude Code is suited to it'
      : taskClass === 'simple'
        ? 'looks like routine work — OpenCode is cheaper and suited to it'
        : 'no strong complexity signal — either agent is fine';

  return { taskClass, confidence, suggested, reason };
}

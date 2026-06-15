/**
 * Central interaction record (local-only prototype of PRD §6).
 * Monitoring-only: descriptive fields, no flag/score/verdict anywhere.
 */
export interface Interaction {
  interactionId: string;
  /** Reliable per-coder key: OS/workstation login (chosen identity source). */
  coder: string;
  /** Context signal only — NOT a per-person key (office NAT/VPN make it weak). */
  ips: string[];
  agent: 'claude_code' | 'opencode';
  model: string | null;
  /** Redacted prompt text — secrets stripped before storage (§7). */
  prompt: string | null;
  /** Descriptive task label (§4.3) — labels the work, not the coder. */
  taskClass: 'simple' | 'moderate' | 'critical';
  taskConfidence: number;
  workspace: string | null;
  gitBranch: string | null;
  sessionId: string | null;
  timestamp: string | null;
  tokens: { input: number; output: number; cacheRead: number; cacheCreate: number };
  modelConfidence: 'authoritative' | 'inferred';
}

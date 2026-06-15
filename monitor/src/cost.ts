/**
 * Cost estimation. RATES ARE PLACEHOLDERS — edit to your actual contract prices
 * (USD per 1M tokens). OpenCode is the cheap model; Claude Opus the expensive one.
 * Used only for aggregate/per-coder cost signals, never to flag anyone.
 */
export interface Rate {
  inPerM: number;
  outPerM: number;
}

export const RATES: Record<string, Rate> = {
  'claude-opus-4-8': { inPerM: 15, outPerM: 75 },
  'claude-sonnet-4-6': { inPerM: 3, outPerM: 15 },
  'claude-haiku-4-5-20251001': { inPerM: 1, outPerM: 5 },
  // OpenCode (Chinese-hosted) — cheap. Set to your real rate.
  opencode: { inPerM: 0.3, outPerM: 0.9 },
  default: { inPerM: 3, outPerM: 15 },
};

export function estCostUsd(model: string | null, input: number, output: number): number {
  const r = (model && RATES[model]) || RATES.default;
  return (input / 1_000_000) * r.inPerM + (output / 1_000_000) * r.outPerM;
}

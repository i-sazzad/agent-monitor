/**
 * Report step (local-only) — the management view, monitoring-only.
 * Per coder: agent/model usage, token totals, estimated cost, IPs seen, and the
 * cost signal you asked for: how many SIMPLE-class tasks went to the expensive
 * Claude models (where OpenCode would have done). Descriptive only — no flags,
 * no scores, no verdicts.
 *
 *   npm run report
 */
import { loadAll } from './store';
import { estCostUsd } from './cost';
import { Interaction } from './types';

function isExpensiveClaude(model: string | null): boolean {
  return !!model && model.startsWith('claude-opus');
}

interface Row {
  sessions: number;
  claude: number;
  opencode: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  simpleOnExpensive: number;
  ips: Set<string>;
}

function blank(): Row {
  return {
    sessions: 0, claude: 0, opencode: 0, tokensIn: 0, tokensOut: 0,
    costUsd: 0, simpleOnExpensive: 0, ips: new Set(),
  };
}

function main(): void {
  const all: Interaction[] = loadAll();
  if (!all.length) {
    console.log('No interactions stored yet. Run `npm run capture` first.');
    return;
  }

  const byCoder = new Map<string, Row>();
  for (const i of all) {
    const row = byCoder.get(i.coder) ?? blank();
    row.sessions++;
    if (i.agent === 'claude_code') {
      row.claude++;
    } else {
      row.opencode++;
    }
    row.tokensIn += i.tokens.input;
    row.tokensOut += i.tokens.output;
    row.costUsd += estCostUsd(i.model, i.tokens.input, i.tokens.output);
    if (i.taskClass === 'simple' && isExpensiveClaude(i.model)) {
      row.simpleOnExpensive++;
    }
    for (const ip of i.ips) {
      row.ips.add(ip);
    }
    byCoder.set(i.coder, row);
  }

  console.log('=== Usage by coder (monitoring-only — no flags/scores) ===\n');
  for (const [coder, r] of byCoder) {
    console.log(`coder: ${coder}`);
    console.log(`  sessions: ${r.sessions}  (claude=${r.claude}, opencode=${r.opencode})`);
    console.log(`  tokens:   in=${r.tokensIn}  out=${r.tokensOut}`);
    console.log(`  est cost: $${r.costUsd.toFixed(2)}  (placeholder rates — edit cost.ts)`);
    console.log(`  ips seen: ${[...r.ips].join(', ') || 'none'}  (context only)`);
    console.log(`  cost signal: ${r.simpleOnExpensive} simple-class task(s) ran on expensive Claude → OpenCode would suffice`);
    console.log('');
  }
  console.log('Note: per-coder prompt drill-down would be role-gated + access-logged per PRD §7.');
}

main();

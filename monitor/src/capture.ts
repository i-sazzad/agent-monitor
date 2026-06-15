/**
 * Capture step (local-only). Reads this machine's agent logs, enriches each with
 * the coder login + IP, classifies the task, REDACTS the prompt, and appends to
 * the local store. No network. On 30 machines this same step would POST to the
 * central ingestion API instead of writing locally.
 *
 *   npm run capture
 */
import { createHash } from 'crypto';
import { readClaude, readOpencode, RawSession } from './parsers';
import { coderLogin, localIps } from './identity';
import { classify } from './classify';
import { redact } from './redact';
import { Interaction } from './types';
import { saveNew, storePath } from './store';

function toInteraction(raw: RawSession, coder: string, ips: string[]): Interaction {
  const c = classify(raw.prompt);
  const idSeed = `${coder}|${raw.agent}|${raw.sessionId}|${raw.timestamp}`;
  return {
    interactionId: createHash('sha1').update(idSeed).digest('hex').slice(0, 16),
    coder,
    ips,
    agent: raw.agent,
    model: raw.model,
    prompt: redact(raw.prompt),
    taskClass: c.taskClass,
    taskConfidence: c.confidence,
    workspace: raw.workspace,
    gitBranch: raw.gitBranch,
    sessionId: raw.sessionId,
    timestamp: raw.timestamp,
    tokens: raw.tokens,
    modelConfidence: raw.modelConfidence,
  };
}

async function shipToBackend(url: string, records: Interaction[]): Promise<void> {
  const token = process.env.INGEST_TOKEN ?? 'dev-ingest-token';
  const res = await fetch(url.replace(/\/$/, '') + '/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ records }),
  });
  const body = (await res.json()) as { received?: number; stored?: number; error?: string };
  if (!res.ok) {
    throw new Error(`ingest failed (${res.status}): ${body.error ?? 'unknown'}`);
  }
  console.log(`Shipped to ${url}: received=${body.received}, newly stored=${body.stored}.`);
}

async function main(): Promise<void> {
  const coder = coderLogin();
  const ips = localIps();
  const raws = [...readClaude(), ...readOpencode()];
  const records = raws.map((r) => toInteraction(r, coder, ips));
  console.log(
    `Captured for coder="${coder}" ip=[${ips.join(', ') || 'none'}]: ${records.length} session(s) read.`
  );

  // On a coder's machine, set INGEST_URL to POST to the central backend.
  // With no INGEST_URL, fall back to the local file store (single-machine mode).
  const url = process.env.INGEST_URL;
  if (url) {
    await shipToBackend(url, records);
  } else {
    const added = saveNew(records);
    console.log(`Local store: ${storePath()} — ${added} new (prompts redacted, nothing sent).`);
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});

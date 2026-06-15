import * as fs from 'fs';
import * as path from 'path';
import { Interaction } from './types';

/**
 * Local-only store: an append JSONL file under monitor/data/. This stands in for
 * the central backend while we prove the pipeline on one machine. Dedupe is by
 * interactionId so re-running capture is idempotent.
 */
const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE = path.join(DATA_DIR, 'interactions.jsonl');

export function storePath(): string {
  return STORE;
}

export function loadAll(): Interaction[] {
  try {
    return fs
      .readFileSync(STORE, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Interaction);
  } catch {
    return [];
  }
}

export function saveNew(records: Interaction[]): number {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const existing = new Set(loadAll().map((r) => r.interactionId));
  const fresh = records.filter((r) => !existing.has(r.interactionId));
  if (fresh.length) {
    fs.appendFileSync(STORE, fresh.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  return fresh.length;
}

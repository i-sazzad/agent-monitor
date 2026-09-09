'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Must be set BEFORE requiring db.js — the module opens the DB at load time.
process.env.MONITOR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-test-'));
const db = require('../out/db.js');
const { row } = require('./helpers.js');

test('ingest stores rows and dedupes on interaction_id', () => {
  const r = row({ interactionId: 'fixed-1' });
  assert.equal(db.ingestMany([r]), 1);
  assert.equal(db.ingestMany([r]), 0); // duplicate ignored
  const summary = db.summaryByCoder();
  assert.equal(summary.length, 1);
  assert.equal(summary[0].coder, 'alice');
  assert.equal(summary[0].prompts, 1);
});

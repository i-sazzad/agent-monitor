'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MONITOR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-test-'));
const db = require('../out/db.js');

test('heartbeat upserts one row per coder', () => {
  db.recordHeartbeat({ coder: 'alice', team: 'platform', version: '1.1.0', hostname: 'pc-1', prompts: 4 });
  db.recordHeartbeat({ coder: 'alice', team: 'platform', version: '1.2.0', hostname: 'pc-1', prompts: 9 });
  const rows = db.fleet();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].version, '1.2.0');
  assert.equal(rows[0].prompts, 9);
  assert.ok(rows[0].last_seen);
});

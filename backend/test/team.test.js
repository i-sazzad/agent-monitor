'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MONITOR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-test-'));
const db = require('../out/db.js');
const { row } = require('./helpers.js');

test('team is stored and surfaced in the coder summary', () => {
  db.ingestMany([row({ coder: 'bob', team: 'platform' })]);
  const s = db.summaryByCoder().find(r => r.coder === 'bob');
  assert.equal(s.team, 'platform');
});

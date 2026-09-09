'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MONITOR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-test-'));
const db = require('../out/db.js');
const { row } = require('./helpers.js');

test('file events are stored per interaction and summarised', () => {
  db.ingestMany([
    row({ interactionId: 'fe-1', coder: 'alice', workspace: '/repo',
      fileEvents: [
        { file: 'src/auth.ts', action: 'edit' },
        { file: 'src/auth.ts', action: 'read' },
      ] }),
    row({ interactionId: 'fe-2', coder: 'alice', workspace: '/repo',
      fileEvents: [{ file: 'src/auth.ts', action: 'edit' }] }),
    row({ interactionId: 'fe-3', coder: 'bob', workspace: '/repo', agent: 'opencode',
      fileEvents: [{ file: 'README.md', action: 'write' }] }),
  ]);
  // duplicate ingest must not double-count
  db.ingestMany([row({ interactionId: 'fe-1', coder: 'alice', workspace: '/repo',
    fileEvents: [{ file: 'src/auth.ts', action: 'edit' }] })]);

  const all = db.fileEventSummary();
  const auth = all.find(r => r.file === 'src/auth.ts');
  assert.equal(auth.edits, 2);
  assert.equal(auth.reads, 1);
  assert.equal(auth.agent, 'claude_code');

  const onlyBob = db.fileEventSummary({ coders: ['bob'] });
  assert.equal(onlyBob.length, 1);
  assert.equal(onlyBob[0].writes, 1);
});

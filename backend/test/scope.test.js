'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MONITOR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-test-'));
const db = require('../out/db.js');
const { scopeFilters, visibleCoders } = require('../out/scope.js');

const superAdmin = { id: 'x', actor: 'a', role: 'super_admin', teamId: null, expires: 0 };

test('super_admin filters pass through unchanged', () => {
  const f = { coders: ['anyone'] };
  assert.deepEqual(scopeFilters(superAdmin, f), f);
  assert.deepEqual(visibleCoders(superAdmin, ['a', 'b']), ['a', 'b']);
});

test('team_lead is restricted to assigned coders', () => {
  const teamId = db.upsertTeam('t1');
  db.assignCoder('alice', teamId);
  db.assignCoder('bob', teamId);
  const lead = { id: 'y', actor: 'l', role: 'team_lead', teamId, expires: 0 };

  assert.deepEqual(scopeFilters(lead, {}).coders.sort(), ['alice', 'bob']);
  assert.deepEqual(scopeFilters(lead, { coders: ['alice', 'eve'] }).coders, ['alice']);
  assert.equal(scopeFilters(lead, { coders: ['eve'] }), null);
  assert.deepEqual(visibleCoders(lead, ['alice', 'eve']), ['alice']);
});

test('team_lead with no assigned coders sees nothing', () => {
  const emptyTeam = db.upsertTeam('empty');
  const lead = { id: 'z', actor: 'l2', role: 'team_lead', teamId: emptyTeam, expires: 0 };
  assert.equal(scopeFilters(lead, {}), null);
  assert.deepEqual(visibleCoders(lead, ['alice']), []);
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.MONITOR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-test-'));
process.env.ADMIN_TOKEN = 'bootstrap-secret';
const db = require('../out/db.js');
const auth = require('../out/auth.js');

const hash = s => crypto.createHash('sha256').update(s).digest('hex');

test('teams, users and coder assignment round-trip', () => {
  const teamId = db.upsertTeam('platform');
  assert.equal(db.upsertTeam('platform'), teamId); // idempotent
  db.addUser('lead-jane', 'team_lead', hash('jane-token'), teamId);
  db.assignCoder('alice', teamId);
  db.assignCoder('bob', teamId);
  assert.deepEqual(db.codersForTeam(teamId).sort(), ['alice', 'bob']);
  const u = db.findUserByTokenHash(hash('jane-token'));
  assert.equal(u.role, 'team_lead');
  assert.equal(u.team_id, teamId);
  assert.equal(db.findUserByTokenHash(hash('wrong')), null);
});

test('login: user token, bootstrap token, bad token', () => {
  assert.ok(auth.login('jane-token'), 'team lead token logs in');
  assert.ok(auth.login('bootstrap-secret'), 'ADMIN_TOKEN bootstrap logs in');
  assert.equal(auth.login('nope'), null);
});

test('bearer authorize carries role and team', () => {
  const s = auth.authorize({ headers: { authorization: 'Bearer jane-token' } });
  assert.equal(s.role, 'team_lead');
  assert.ok(s.teamId != null);
  const sa = auth.authorize({ headers: { authorization: 'Bearer bootstrap-secret' } });
  assert.equal(sa.role, 'super_admin');
  assert.equal(auth.authorize({ headers: {} }), null);
});

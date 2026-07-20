#!/usr/bin/env node
'use strict';
/**
 * Direct-DB management CLI (there is deliberately no UI for this).
 * Run from backend/ AFTER `npm run build`:
 *   node scripts/manage.js add-team <team>
 *   node scripts/manage.js add-user <name> super_admin|team_lead [team]
 *   node scripts/manage.js assign-coder <coder> <team>
 */
const crypto = require('crypto');
const db = require('../out/db.js');

const [cmd, a, b, c] = process.argv.slice(2);
function fail(msg) { console.error(msg); process.exit(1); }

if (cmd === 'add-team') {
  if (!a) fail('usage: add-team <team>');
  console.log(`team "${a}" id: ${db.upsertTeam(a)}`);
} else if (cmd === 'add-user') {
  if (!a || !['super_admin', 'team_lead'].includes(b)) {
    fail('usage: add-user <name> super_admin|team_lead [team]');
  }
  if (b === 'team_lead' && !c) fail('team_lead requires a team name');
  const teamId = c ? db.upsertTeam(c) : null;
  const token = crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  db.addUser(a, b, hash, teamId);
  console.log(`user "${a}" created (${b}${c ? ', team ' + c : ''})`);
  console.log('login token (shown once, only the hash is stored):');
  console.log(token);
} else if (cmd === 'assign-coder') {
  if (!a || !b) fail('usage: assign-coder <coder> <team>');
  db.assignCoder(a, db.upsertTeam(b));
  console.log(`coder "${a}" assigned to team "${b}"`);
} else {
  fail('commands: add-team | add-user | assign-coder');
}

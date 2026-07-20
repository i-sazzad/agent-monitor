'use strict';
// Shared test fixtures. Note: node --test runs each test FILE in its own
// process, and MONITOR_DATA_DIR must be set before ../out/db.js is required.

function row(over = {}) {
  return Object.assign({
    interactionId: 'i-' + Math.random().toString(16).slice(2, 10),
    coder: 'alice',
    ips: ['192.168.1.2'],
    agent: 'claude_code',
    model: 'claude-opus-4-8',
    prompt: 'fix the bug',
    taskClass: 'moderate',
    taskConfidence: 0.3,
    workspace: '/repo',
    gitBranch: 'main',
    sessionId: 's1',
    timestamp: '2026-07-01T10:00:00.000Z',
    tokens: { input: 10, output: 20, cacheRead: 0, cacheCreate: 0 },
    modelConfidence: 'authoritative',
  }, over);
}

module.exports = { row };

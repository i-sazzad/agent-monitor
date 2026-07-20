'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agent = require('../agent.js');

test('toolFileEvent maps tool names to actions', () => {
  assert.deepEqual(agent.toolFileEvent('Edit', { file_path: '/r/a.ts' }), { file: '/r/a.ts', action: 'edit' });
  assert.deepEqual(agent.toolFileEvent('Write', { file_path: '/r/b.md' }), { file: '/r/b.md', action: 'write' });
  assert.deepEqual(agent.toolFileEvent('MultiEdit', { file_path: '/r/c.py' }), { file: '/r/c.py', action: 'edit' });
  assert.deepEqual(agent.toolFileEvent('NotebookEdit', { notebook_path: '/r/n.ipynb' }), { file: '/r/n.ipynb', action: 'edit' });
  assert.deepEqual(agent.toolFileEvent('Read', { file_path: '/r/d.js' }), { file: '/r/d.js', action: 'read' });
  assert.equal(agent.toolFileEvent('Bash', { command: 'ls' }), null);
  assert.equal(agent.toolFileEvent('Edit', {}), null);
});

test('opencodeToolEvent parses tool parts defensively', () => {
  assert.deepEqual(
    agent.opencodeToolEvent({ type: 'tool', tool: 'edit', state: { input: { filePath: '/r/x.go' } } }),
    { file: '/r/x.go', action: 'edit' });
  assert.deepEqual(
    agent.opencodeToolEvent({ type: 'tool', tool: 'write', input: { file_path: '/r/y.rs' } }),
    { file: '/r/y.rs', action: 'write' });
  assert.equal(agent.opencodeToolEvent({ type: 'text', text: 'hi' }), null);
  assert.equal(agent.opencodeToolEvent({ type: 'tool', tool: 'bash' }), null);
});

test('parseClaude collects fileEvents per user turn', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-'));
  const f = path.join(dir, 's1.jsonl');
  const lines = [
    { type: 'user', sessionId: 's1', cwd: '/repo', gitBranch: 'main',
      timestamp: '2026-07-01T10:00:00.000Z',
      message: { content: 'refactor the auth module' } },
    { type: 'assistant',
      message: { model: 'claude-opus-4-8', usage: { input_tokens: 5, output_tokens: 9 },
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/repo/src/auth.ts' } },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/auth.ts' } },
        ] } },
    { type: 'assistant',
      message: { model: 'claude-opus-4-8', usage: { output_tokens: 3 },
        content: [
          { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/auth.ts' } },
          { type: 'tool_use', name: 'Write', input: { file_path: '/repo/src/session.ts' } },
        ] } },
  ];
  fs.writeFileSync(f, lines.map(JSON.stringify).join('\n'));

  const recs = agent.parseClaude(f);
  assert.equal(recs.length, 1);
  assert.deepEqual(recs[0].fileEvents.sort((a, b) => a.file.localeCompare(b.file) || a.action.localeCompare(b.action)), [
    { file: '/repo/src/auth.ts', action: 'edit' },   // deduped across both assistant messages
    { file: '/repo/src/auth.ts', action: 'read' },
    { file: '/repo/src/session.ts', action: 'write' },
  ]);
  assert.equal(recs[0].tokens.output, 12);
});

import * as vscode from 'vscode';
import { readAllClaudeSessions } from './claude';
import { readAllOpencodeSessions } from './opencode';
import { LoggedInteraction } from './types';

/**
 * Log-reader spike (VS Code surface). Read-only: scans the local agent session
 * logs and prints what is recoverable to an output channel. Stores nothing,
 * sends nothing — same property as the other spikes. Prompt text is truncated.
 */

function report(channel: vscode.OutputChannel, label: string, rows: LoggedInteraction[]): void {
  channel.appendLine(`=== ${label}: ${rows.length} session(s) ===`);
  for (const r of rows.slice(0, 25)) {
    const t = r.tokens;
    const preview = r.prompt ? r.prompt.slice(0, 80).replace(/\s+/g, ' ') : '(no prompt found)';
    channel.appendLine(
      `[${r.confidence}] model=${r.model ?? '?'} ` +
        `tok in/out=${t.input}/${t.output} cache r/c=${t.cacheRead}/${t.cacheCreate} ` +
        `branch=${r.gitBranch ?? '-'}`
    );
    channel.appendLine(`    prompt: ${preview}`);
  }
  channel.appendLine('');
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('logReaderSpike.scan', () => {
      const channel = vscode.window.createOutputChannel('Agent Log Reader (spike)');
      channel.show(true);
      channel.appendLine('Read-only scan of local agent session logs. Nothing stored or sent.\n');
      report(channel, 'Claude Code (verified)', readAllClaudeSessions());
      report(channel, 'OpenCode (best-effort, unverified)', readAllOpencodeSessions());
    })
  );

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = '$(book) Agent Log Reader (spike)';
  status.tooltip = 'Scan local Claude Code / OpenCode session logs (read-only).';
  status.command = 'logReaderSpike.scan';
  status.show();
  context.subscriptions.push(status);
}

export function deactivate(): void {
  // Nothing persistent.
}

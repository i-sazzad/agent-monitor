import * as vscode from 'vscode';

/**
 * Feasibility spike for the AI Agent Monitoring PRD (§10 Q1).
 *
 * Question under test: can a VS Code extension reliably detect when Claude Code
 * or OpenCode is invoked, and capture the prompt/command text, WITHOUT a
 * dedicated agent API?
 *
 * Approach validated here: the integrated-terminal shell-execution API
 * (`onDidStartTerminalShellExecution`, stable since 1.93). Both agents run as
 * terminal CLIs, so this is the realistic v1 hook point. This spike captures,
 * classifies the *invocation*, streams output, and logs everything to an output
 * channel. It deliberately stores nothing and sends nothing — it only proves
 * what is observable.
 */

// CLI process names that identify each agent when they appear as the command.
const AGENT_MATCHERS: { agent: string; test: RegExp }[] = [
  { agent: 'claude_code', test: /(^|[\\/\s])claude(\.exe|\.cmd)?(\s|$)/i },
  { agent: 'opencode', test: /(^|[\\/\s])opencode(\.exe|\.cmd)?(\s|$)/i },
];

interface CaptureRecord {
  ts: string;
  terminal: string;
  agent: string | 'unknown';
  commandLine: string;
  /** True when VS Code gave us the parsed command line (rich), not just a guess. */
  hasRichCommandLine: boolean;
  outputBytes: number;
}

const captures: CaptureRecord[] = [];
let channel: vscode.OutputChannel;

function identifyAgent(commandLine: string): string {
  for (const m of AGENT_MATCHERS) {
    if (m.test.test(commandLine)) {
      return m.agent;
    }
  }
  return 'unknown';
}

function log(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  channel.appendLine(stamped);
}

export function activate(context: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel('Agent Monitor Spike');
  context.subscriptions.push(channel);

  log('Spike activated. Watching integrated-terminal shell executions.');

  // Capability probe: is the shell-integration API actually present?
  const apiAvailable =
    typeof (vscode.window as any).onDidStartTerminalShellExecution === 'function';
  log(
    apiAvailable
      ? 'FINDING: onDidStartTerminalShellExecution IS available — terminal capture is feasible.'
      : 'FINDING: shell-execution API NOT available — would need terminal/log parsing fallback.'
  );

  if (apiAvailable) {
    context.subscriptions.push(
      vscode.window.onDidStartTerminalShellExecution(async (e) => {
        const commandLine = e.execution.commandLine.value;
        // `confidence` tells us whether VS Code parsed the command (High) or
        // had to infer it — this directly informs §4.1 capture reliability.
        const confidence = e.execution.commandLine.confidence; // 0=low,1=medium,2=high
        const agent = identifyAgent(commandLine);

        const record: CaptureRecord = {
          ts: new Date().toISOString(),
          terminal: e.terminal.name,
          agent,
          commandLine,
          hasRichCommandLine: confidence === 2,
          outputBytes: 0,
        };

        if (agent !== 'unknown') {
          log(
            `CAPTURED agent=${agent} confidence=${confidence} cmd="${commandLine}"`
          );
        } else {
          log(`(ignored non-agent command) confidence=${confidence} cmd="${commandLine}"`);
        }

        // Stream the execution output. This is what lets us observe the agent's
        // *response* (tokens, errors), per §4.1. We only count bytes here — the
        // spike does not retain content.
        try {
          for await (const chunk of e.execution.read()) {
            record.outputBytes += Buffer.byteLength(chunk, 'utf8');
          }
        } catch (err) {
          log(`  output stream error: ${String(err)}`);
        }

        if (agent !== 'unknown') {
          log(`  agent=${agent} streamed ${record.outputBytes} bytes of output`);
          captures.push(record);
        }
      })
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('agentMonitorSpike.showLog', () => {
      channel.show(true);
      log(`--- Capture summary: ${captures.length} agent invocation(s) so far ---`);
      for (const c of captures) {
        log(
          `  ${c.ts} ${c.agent} rich=${c.hasRichCommandLine} out=${c.outputBytes}B :: ${c.commandLine}`
        );
      }
    })
  );

  // Status-bar transparency indicator — mirrors the PRD §7 requirement that the
  // extension surface its monitoring state.
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  status.text = '$(eye) Agent Monitor (spike)';
  status.tooltip =
    'Feasibility spike: observing terminal agent invocations. No data stored or sent.';
  status.command = 'agentMonitorSpike.showLog';
  status.show();
  context.subscriptions.push(status);
}

export function deactivate(): void {
  // Nothing persistent to clean up; subscriptions are disposed by VS Code.
}

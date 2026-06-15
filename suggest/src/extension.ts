import * as vscode from 'vscode';
import { classify, Agent } from './classifier';

/**
 * Agent Suggest — prompt-time advisory model hint (PRD §4.6).
 *
 * Flow: engineer runs the command and types a prompt (we capture the prompt at
 * an input surface we own — the terminal cannot see interactive TUI prompts, per
 * the spike). We classify it locally, optionally show a *dismissible* hint for
 * the cost-suited agent, then launch whichever agent the engineer chooses.
 *
 * Guardrail (do not drift): advisory only. The engineer chooses freely; a choice
 * that differs from the suggestion is NOT a violation and is not recorded as
 * such. Nothing is sent anywhere. Prompts are held only in this session, only
 * for the engineer's own "show my prompts" transparency view.
 */

const AGENT_LABEL: Record<Agent, string> = {
  claude_code: 'Claude Code',
  opencode: 'OpenCode',
};

const AGENT_CLI: Record<Agent, string> = {
  claude_code: 'claude',
  opencode: 'opencode',
};

interface PromptRecord {
  ts: string;
  prompt: string;
  taskClass: string;
  confidence: number;
  suggested: Agent;
  chosen: Agent;
  /** Did the engineer's choice match the suggestion? Recorded for the engineer's
   *  own view only — never reported as compliance/violation. */
  followed: boolean;
}

// In-memory, this-session-only. Cleared on reload. Not persisted, not sent.
const myPrompts: PromptRecord[] = [];

let status: vscode.StatusBarItem;

async function runPrompt(): Promise<void> {
  const prompt = await vscode.window.showInputBox({
    title: 'Agent Suggest — what do you want the agent to do?',
    prompt: 'Your prompt is classified locally to suggest a cost-suited agent. Nothing is stored or sent.',
    placeHolder: 'e.g. add a getter for the user email field',
    ignoreFocusOut: true,
  });
  if (!prompt || !prompt.trim()) {
    return;
  }

  const cfg = vscode.workspace.getConfiguration('agentSuggest');
  const enabled = cfg.get<boolean>('enabled', true);
  const minConfidence = cfg.get<number>('minConfidence', 0.5);

  const result = classify(prompt);
  const showHint = enabled && result.confidence >= minConfidence;

  // Build the pick list. The suggested agent is marked, but both are always
  // offered with equal standing — the engineer chooses freely.
  const items: (vscode.QuickPickItem & { agent: Agent })[] = (
    ['claude_code', 'opencode'] as Agent[]
  ).map((a) => ({
    agent: a,
    label: AGENT_LABEL[a],
    description:
      showHint && a === result.suggested ? `$(lightbulb) suggested — ${result.reason}` : '',
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: showHint
      ? `Suggestion: ${AGENT_LABEL[result.suggested]} (${result.taskClass}). Pick freely — this is advisory.`
      : 'Pick an agent (no strong suggestion for this prompt).',
    placeHolder: 'Choose the agent to run — your choice is never recorded as compliance or a violation.',
  });
  if (!picked) {
    return; // dismissed — nothing recorded, nothing launched
  }

  myPrompts.push({
    ts: new Date().toISOString(),
    prompt,
    taskClass: result.taskClass,
    confidence: result.confidence,
    suggested: result.suggested,
    chosen: picked.agent,
    followed: picked.agent === result.suggested,
  });

  launchAgent(picked.agent, prompt);
}

function launchAgent(agent: Agent, prompt: string): void {
  const term = vscode.window.createTerminal(`${AGENT_LABEL[agent]} (suggested run)`);
  term.show();
  // Pass the prompt as a CLI argument. The engineer can edit before sending.
  term.sendText(`${AGENT_CLI[agent]} ${JSON.stringify(prompt)}`, false);
}

function showMyPrompts(): void {
  const channel = vscode.window.createOutputChannel('Agent Suggest — my prompts');
  channel.show(true);
  channel.appendLine(
    `Your prompts this session (${myPrompts.length}). Local only — not stored, not sent.`
  );
  channel.appendLine('');
  for (const p of myPrompts) {
    channel.appendLine(
      `${p.ts}  [${p.taskClass} ${(p.confidence * 100) | 0}%]  ` +
        `suggested=${AGENT_LABEL[p.suggested]} chosen=${AGENT_LABEL[p.chosen]}`
    );
    channel.appendLine(`    ${p.prompt}`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('agentSuggest.run', runPrompt),
    vscode.commands.registerCommand('agentSuggest.showMyPrompts', showMyPrompts)
  );

  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = '$(lightbulb) Agent Suggest';
  status.tooltip =
    'Prompt-time model suggestion (advisory, dismissible). Click to run a prompt. Nothing stored or sent.';
  status.command = 'agentSuggest.run';
  status.show();
  context.subscriptions.push(status);
}

export function deactivate(): void {
  // Nothing persistent to clean up.
}

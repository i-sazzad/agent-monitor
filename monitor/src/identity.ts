import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Per-coder identity = OS/workstation login (the chosen identity source).
 * IP is captured too, but only as a context signal — see types.ts.
 */
export function coderLogin(): string {
  try {
    return os.userInfo().username || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Non-internal IPv4/IPv6 addresses of this machine. Context only. */
export function localIps(): string[] {
  const out: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      if (!ni.internal && ni.address) {
        out.push(ni.address);
      }
    }
  }
  return out;
}

/**
 * Read the Claude Code account identifier from ~/.claude/.credentials.json.
 * The email is not stored locally (requires a live browser session), so we
 * use organizationUuid as a stable account fingerprint. A different UUID on
 * any machine = that coder is using a personal account, not the shared one.
 */
export function claudeAccountId(): string | null {
  try {
    const creds = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8')
    ) as Record<string, unknown>;
    return (creds.organizationUuid as string) || null;
  } catch {
    return null;
  }
}

/**
 * Read the OpenCode account identifier. OpenCode stores config at
 * ~/.config/opencode/config.json (XDG) or ~/.opencode/config.json.
 * Returns the account email/user field if present.
 */
export function opencodeAccountId(): string | null {
  const candidates = [
    path.join(os.homedir(), '.config', 'opencode', 'config.json'),
    path.join(os.homedir(), '.opencode', 'config.json'),
    path.join(os.homedir(), '.config', 'opencode', 'auth.json'),
  ];
  for (const p of candidates) {
    try {
      const d = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
      const id = (d.email ?? d.user ?? d.username ?? d.account ?? d.userId) as string | undefined;
      if (id) return id;
    } catch {
      // file not found or invalid JSON — try next
    }
  }
  return null;
}

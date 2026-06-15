import * as os from 'os';

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

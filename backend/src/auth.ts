import { createHash, randomBytes } from 'crypto';
import * as http from 'http';
import { ADMIN_TOKEN } from './config';
import { findUserByTokenHash } from './db';

/**
 * Dashboard auth. Two roles:
 *  - super_admin: sees all coders' data.
 *  - team_lead:   sees only coders assigned to their team (coder_teams table).
 * Users/teams are created by direct DB edits or scripts/manage.js — no UI.
 * ADMIN_TOKEN from env remains a bootstrap super_admin so first login works
 * on an empty database.
 */

export type Role = 'super_admin' | 'team_lead';

export interface Session {
  id: string;
  actor: string;
  role: Role;
  teamId: number | null;
  expires: number;
}

const SESSIONS = new Map<string, Session>();
const TTL_MS = 8 * 3600 * 1000;

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function resolveUser(token: string): { actor: string; role: Role; teamId: number | null } | null {
  if (!token) return null;
  const user = findUserByTokenHash(sha256(token));
  if (user) return { actor: user.name, role: user.role, teamId: user.team_id };
  // ADMIN_TOKEN may be set to '' in .env; never let an empty token match.
  if (ADMIN_TOKEN && token === ADMIN_TOKEN) return { actor: 'admin(bootstrap)', role: 'super_admin', teamId: null };
  return null;
}

/** Returns a session id if the supplied credential is valid, else null. */
export function login(token: string): string | null {
  const u = resolveUser(token);
  if (!u) return null;
  const id = randomBytes(24).toString('hex');
  SESSIONS.set(id, { id, ...u, expires: Date.now() + TTL_MS });
  return id;
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return out;
}

/** Authorize a dashboard request via session cookie OR bearer token. */
export function authorize(req: http.IncomingMessage): Session | null {
  const sid = parseCookies(req).sid;
  if (sid) {
    const s = SESSIONS.get(sid);
    if (s && s.expires > Date.now()) {
      return s;
    }
    if (s) {
      SESSIONS.delete(sid);
    }
  }
  const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization ?? '');
  if (m) {
    const u = resolveUser(m[1]);
    if (u) return { id: 'bearer', ...u, expires: Date.now() + TTL_MS };
  }
  return null;
}

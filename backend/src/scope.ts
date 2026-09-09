import { Filters, codersForTeam } from './db';
import type { Session } from './auth';

/**
 * Restrict filters to the session's visibility.
 * super_admin  → filters unchanged.
 * team_lead    → coders limited to their team; returns null when nothing is
 *                visible (callers must respond with empty results).
 */
export function scopeFilters(s: Session, f: Filters): Filters | null {
  if (s.role === 'super_admin') return f;
  const team = codersForTeam(s.teamId ?? -1);
  if (!team.length) return null;
  const coders = f.coders?.length ? f.coders.filter((c) => team.includes(c)) : team;
  return coders.length ? { ...f, coders } : null;
}

/** Subset of `all` that the session may see. */
export function visibleCoders(s: Session, all: string[]): string[] {
  if (s.role === 'super_admin') return all;
  const team = new Set(codersForTeam(s.teamId ?? -1));
  return all.filter((c) => team.has(c));
}

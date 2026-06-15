/**
 * Backend config. Tokens are read from env so secrets aren't baked in.
 * For the local prototype, sensible defaults are used if env is unset.
 */
export const PORT = Number(process.env.PORT ?? 4319);

/** Shared secret each coder's capture agent uses to POST /ingest. */
export const INGEST_TOKEN = process.env.INGEST_TOKEN ?? 'dev-ingest-token';

/** Separate, higher-privilege token for per-coder prompt drill-down (§7). */
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin-token';

/** PRD §7 default retention window; rows older than this are auto-deleted. */
export const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 90);

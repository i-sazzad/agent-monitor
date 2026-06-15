import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { PORT, INGEST_TOKEN } from './config';
import { login, authorize } from './auth';
import {
  ingestMany,
  summaryByCoder,
  interactionsForCoder,
  logAccess,
  pruneRetention,
  IngestRow,
} from './db';

/**
 * Monitoring backend: ingestion API + role-gated dashboard.
 *   POST /ingest          (bearer INGEST_TOKEN)  capture agents push records
 *   POST /login /logout                          human session (admin token / SSO)
 *   GET  /                                        dashboard UI
 *   GET  /api/report      (session/admin)         per-coder aggregate
 *   GET  /api/coder/:name (session/admin)         prompt drill-down (§7, logged)
 * Monitoring-only: nothing flags, scores, or acts on a coder.
 */

const PUBLIC = path.join(__dirname, '..', 'public');

function send(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function serveStatic(res: http.ServerResponse, file: string): void {
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full)) {
    return send(res, 404, { error: 'not found' });
  }
  const type = full.endsWith('.html') ? 'text/html' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  res.end(fs.readFileSync(full));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 50 * 1024 * 1024) {
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const handler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost`);
    const p = url.pathname;

    // --- ingestion (machine token) ---
    if (req.method === 'POST' && p === '/ingest') {
      const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization ?? '');
      if (!m || m[1] !== INGEST_TOKEN) {
        return send(res, 401, { error: 'bad ingest token' });
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const records: IngestRow[] = Array.isArray(body.records) ? body.records : [];
      return send(res, 200, { received: records.length, stored: ingestMany(records) });
    }

    // --- human auth ---
    if (req.method === 'POST' && p === '/login') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const sid = login(String(body.token ?? ''));
      if (!sid) {
        return send(res, 401, { error: 'invalid credentials' });
      }
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === 'POST' && p === '/logout') {
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': 'sid=; HttpOnly; Path=/; Max-Age=0',
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // --- dashboard data (session or bearer admin) ---
    if (req.method === 'GET' && p === '/api/report') {
      const s = authorize(req);
      if (!s) {
        return send(res, 401, { error: 'auth required' });
      }
      logAccess(s.actor, 'report');
      return send(res, 200, { coders: summaryByCoder() });
    }
    const drill = /^\/api\/coder\/(.+)$/.exec(p);
    if (req.method === 'GET' && drill) {
      const s = authorize(req);
      if (!s) {
        return send(res, 401, { error: 'auth required' });
      }
      const coder = decodeURIComponent(drill[1]);
      logAccess(s.actor, `drilldown:${coder}`); // §7: access is logged
      return send(res, 200, { coder, interactions: interactionsForCoder(coder) });
    }

    // --- static dashboard ---
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      return serveStatic(res, 'index.html');
    }

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    return send(res, 400, { error: String(err) });
  }
};

// Retention sweep on startup + daily (§7).
pruneRetention();
setInterval(() => {
  const removed = pruneRetention();
  if (removed) {
    console.log(`retention: pruned ${removed} expired row(s)`);
  }
}, 24 * 3600 * 1000);

// TLS when TLS_CERT + TLS_KEY are set; else plain HTTP for local dev.
const certPath = process.env.TLS_CERT;
const keyPath = process.env.TLS_KEY;
if (certPath && keyPath) {
  const server = https.createServer(
    { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) },
    handler
  );
  server.listen(PORT, () => console.log(`monitor backend (HTTPS) on https://localhost:${PORT}`));
} else {
  const server = http.createServer(handler);
  server.listen(PORT, () =>
    console.log(
      `monitor backend (HTTP) on http://localhost:${PORT}  ` +
        `— set TLS_CERT/TLS_KEY for HTTPS (required in production)`
    )
  );
}

import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {parseCSV, validateFilters} from './src/metrics.mjs';
import {createInferenceSnapshot, snapshotIdentity, runInference, InferenceError} from './server/inference.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const allowed = new Set(['index.html','styles.css','src/app.mjs','src/metrics.mjs','src/assistant.mjs','src/glossary.mjs','data/campaigns.csv']);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.csv':'text/csv; charset=utf-8'};
const loadDataset = async () => parseCSV(await readFile(path.join(root, 'data/campaigns.csv'), 'utf8'));
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function fields(value, expected) {
  if (!isRecord(value) || Object.keys(value).length !== expected.length ||
      Object.keys(value).some(key => !expected.includes(key))) {
    throw new InferenceError(400, 'invalid_request', 'Request fields do not match the inference contract.');
  }
}

async function readJSON(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    throw new InferenceError(415, 'json_required', 'Use application/json.');
  }
  if (Number(req.headers['content-length']) > 8192) {
    throw new InferenceError(413, 'request_too_large', 'Request exceeds 8192 bytes.');
  }
  let bytes = 0;
  const chunks = [];
  // Keep the connection available for a bounded JSON error on chunked bodies.
  for await (const chunk of req.iterator({destroyOnReturn: false})) {
    bytes += chunk.length;
    if (bytes > 8192) throw new InferenceError(413, 'request_too_large', 'Request exceeds 8192 bytes.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new InferenceError(400, 'invalid_json', 'Request must contain valid JSON.'); }
}

function json(res, status, value) {
  if (!res.destroyed) {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(value));
  }
}

export function createServer({invoke, timeoutMs = 8000, loadRows = loadDataset} = {}) {
  if ((invoke !== undefined && typeof invoke !== 'function') || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new Error('Invalid inference configuration.');
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    const hosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
    if (!hosts.includes(req.headers.host)) { json(res, 403, {error: {code: 'invalid_host', message: 'Use the loopback application address.'}}); return; }
    let name;
    try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, '') || 'index.html'; }
    catch { res.writeHead(400); res.end('Bad request'); return; }

    if (['api/snapshot', 'api/brief'].includes(name)) {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, {error: {code: 'method_not_allowed', message: 'Use POST.'}}); return; }
      if ((req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) ||
          (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) {
        json(res, 403, {error: {code: 'cross_origin', message: 'Use the application origin.'}}); return;
      }
      const controller = new AbortController();
      const cancel = () => { if (!res.writableEnded) controller.abort(); };
      req.once('aborted', cancel);
      res.once('close', cancel);
      try {
        const body = await readJSON(req);
        fields(body, name === 'api/snapshot' ? ['filters'] : ['filters', 'question', 'contextId', 'snapshotId']);
        fields(body.filters, ['start', 'end', 'channel', 'audience', 'goal']);
        try { validateFilters(body.filters); }
        catch { throw new InferenceError(400, 'invalid_filters', 'Choose valid dates and supported filters.'); }
        const snap = createInferenceSnapshot(await loadRows(), body.filters);
        if (name === 'api/snapshot') { json(res, 200, {...snapshotIdentity(snap), mode: invoke ? 'adapter_configured' : 'demo'}); return; }
        if (body.snapshotId !== snap.snapshotId || body.contextId !== snap.id) {
          throw new InferenceError(409, 'stale_snapshot', 'Refresh the dataset and filter snapshot before asking again.');
        }
        const result = await runInference({invoke, timeoutMs, question: body.question, snap, signal: controller.signal});
        // Reject data revisions that happen while an adapter is pending.
        const current = createInferenceSnapshot(await loadRows(), body.filters);
        if (current.snapshotId !== snap.snapshotId) throw new InferenceError(409, 'stale_snapshot', 'The dataset changed. Refresh the snapshot and ask again.');
        if (!controller.signal.aborted) json(res, 200, result);
      } catch (error) {
        if (!controller.signal.aborted) json(res, error instanceof InferenceError ? error.status : 500, {
          error: error instanceof InferenceError ? {code: error.code, message: error.message} : {code: 'internal_error', message: 'The inference service is unavailable.'},
        });
      } finally {
        req.off('aborted', cancel);
        res.off('close', cancel);
      }
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Method not allowed'); return; }
    if (!allowed.has(name)) { res.writeHead(404); res.end('Not found'); return; }
    try {
      const bytes = await readFile(path.join(root, name));
      res.writeHead(200, {'Content-Type': types[path.extname(name)]});
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { res.writeHead(500); res.end('Application asset unavailable. Run npm run generate.'); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  createServer().listen(port, '127.0.0.1', () => console.log(`Campaign Compass: http://127.0.0.1:${port} (loopback only; deterministic demo)`));
}

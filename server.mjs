import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {parseCSV, validateFilters} from './src/metrics.mjs';
import {createInferenceSnapshot, snapshotIdentity, runInference, InferenceError} from './server/inference.mjs';
import {createChatGPTService} from './server/chatgpt.mjs';
import {ChatGPTError} from './server/chatgpt-protocol.mjs';
import {timingSafeEqual} from 'node:crypto';

const root = fileURLToPath(new URL('.', import.meta.url));
const allowed = new Set(['index.html','styles.css','src/app.mjs','src/metrics.mjs','src/assistant.mjs','src/glossary.mjs','src/chatgpt-client.mjs','src/connection-ui.mjs','data/campaigns.csv']);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.csv':'text/csv; charset=utf-8'};
const loadDataset = async () => parseCSV(await readFile(path.join(root, 'data/campaigns.csv'), 'utf8'));
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function fields(value, expected) {
  if (!isRecord(value) || Object.keys(value).length !== expected.length ||
      Object.keys(value).some(key => !expected.includes(key))) {
    throw new InferenceError(400, 'invalid_request', 'Request fields do not match the inference contract.');
  }
}

async function readText(req, type = 'application/json') {
  if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== type) {
    throw new InferenceError(415, 'content_type_required', `Use ${type}.`);
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
  return Buffer.concat(chunks).toString('utf8');
}
async function readJSON(req) {
  try { return JSON.parse(await readText(req)); }
  catch (error) { if (error instanceof InferenceError) throw error; throw new InferenceError(400, 'invalid_json', 'Request must contain valid JSON.'); }
}
function csrf(session, value) {
  const actual = Buffer.from(typeof value === 'string' ? value : '');
  const expected = Buffer.from(session?.csrf || '');
  if (!session || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new InferenceError(403, 'invalid_session', 'Refresh the application before continuing.');
}
function sameOrigin(req) {
  return (!req.headers.origin || req.headers.origin === `http://${req.headers.host}`) &&
    (!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']));
}
function publicError(error) {
  return error instanceof ChatGPTError || error instanceof InferenceError
    ? {code: error.code, message: error.message, ...(error instanceof ChatGPTError ? {diagnostic: error.diagnostic} : {})}
    : {code: 'internal_error', message: 'The local service is unavailable. Saved credentials were preserved.'};
}

function json(res, status, value) {
  if (!res.destroyed) {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(value));
  }
}

export function createServer({invoke, timeoutMs = 30000, loadRows = loadDataset, chatgpt = createChatGPTService()} = {}) {
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
    const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('cc_session='))?.slice(11);
    let session = chatgpt.sessionFor(cookie);

    if (name === 'auth/callback') {
      if (req.method !== 'GET' || !session || !req.headers.host.startsWith('127.0.0.1:') || req.url.length > 8192) {
        res.writeHead(400); res.end('Sign-in session unavailable. Return to Campaign Compass and try again.'); return;
      }
      try {
        await chatgpt.callback(session, new URL(req.url, 'http://127.0.0.1').searchParams);
        chatgpt.rotateSession(session);
        res.setHeader('Set-Cookie', `cc_session=${session.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
      }
      catch (error) { session.notice = publicError(error).message; }
      res.writeHead(303, {Location: '/'}); res.end(); return;
    }
    if (name === 'auth/start' || name.startsWith('api/chatgpt/')) {
      if (!sameOrigin(req)) { json(res, 403, {error: {code: 'cross_origin', message: 'Use the application origin.'}}); return; }
      try {
        if (name === 'api/chatgpt/session' && req.method === 'GET') {
          session ||= chatgpt.sessionFor(null, true);
          res.setHeader('Set-Cookie', `cc_session=${session.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
          json(res, 200, await chatgpt.status(session)); return;
        }
        if (!session) throw new InferenceError(401, 'session_required', 'Refresh the app before connecting.');
        if (name === 'auth/start' && req.method === 'POST') {
          if (!req.headers.host.startsWith('127.0.0.1:')) throw new InferenceError(400, 'loopback_required', 'Open this app at http://127.0.0.1:4173 before signing in.');
          const body = new URLSearchParams(await readText(req, 'application/x-www-form-urlencoded'));
          if ([...body.keys()].some(key => !['csrf','profileId','reconsent'].includes(key)) || [...new Set(body.keys())].some(key => body.getAll(key).length !== 1)) throw new InferenceError(400, 'invalid_request', 'Invalid sign-in form.');
          csrf(session, body.get('csrf'));
          const location = await chatgpt.start(session, `http://127.0.0.1:${server.address().port}/auth/callback`, body.get('profileId') || null, body.get('reconsent') === 'on');
          res.writeHead(303, {Location: location}); res.end(); return;
        }
        if (name === 'api/chatgpt/models' && req.method === 'GET') { csrf(session, req.headers['x-cc-csrf']); json(res, 200, {models: await chatgpt.models(session)}); return; }
        if (req.method !== 'POST') throw new InferenceError(405, 'method_not_allowed', 'Use the supported application action.');
        const body = await readJSON(req); csrf(session, req.headers['x-cc-csrf']);
        if (name === 'api/chatgpt/model') { fields(body, ['slug']); chatgpt.selectModel(session, body.slug); }
        else if (name === 'api/chatgpt/select') { fields(body, ['profileId']); await chatgpt.selectProfile(session, body.profileId); }
        else {
          fields(body, []);
          if (name === 'api/chatgpt/disconnect') await chatgpt.disconnect(session);
          else if (name === 'api/chatgpt/cancel') chatgpt.cancel(session);
          else if (name === 'api/chatgpt/acknowledge') await chatgpt.acknowledge(session);
          else if (name === 'api/chatgpt/retry-usage') await chatgpt.retryUsage(session);
          else throw new InferenceError(404, 'not_found', 'Unknown connection action.');
        }
        json(res, 200, await chatgpt.status(session));
      } catch (error) { json(res, error instanceof InferenceError || error instanceof ChatGPTError ? error.status : 500, {error: publicError(error)}); }
      return;
    }

    if (['api/snapshot', 'api/brief'].includes(name)) {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, {error: {code: 'method_not_allowed', message: 'Use POST.'}}); return; }
      if (!sameOrigin(req)) {
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
        const connected = chatgpt.connected(session);
        if (connected) csrf(session, req.headers['x-cc-csrf']);
        const currentInvoke = invoke || (connected ? (request, options) => chatgpt.invoke(session, request, options) : undefined);
        if (name === 'api/snapshot') { json(res, 200, {...snapshotIdentity(snap), mode: currentInvoke ? 'adapter_configured' : 'demo'}); return; }
        if (body.snapshotId !== snap.snapshotId || body.contextId !== snap.id) {
          throw new InferenceError(409, 'stale_snapshot', 'Refresh the dataset and filter snapshot before asking again.');
        }
        const result = await runInference({invoke: currentInvoke, timeoutMs, question: body.question, snap, signal: controller.signal});
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

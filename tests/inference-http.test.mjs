import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createServer} from '../server.mjs';
import {generate} from '../scripts/generate.mjs';
import {DEFAULT_FILTERS} from '../src/metrics.mjs';

async function setup(t, options) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, options = {}) => fetch(base + route, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), ...options,
  });
  const identity = async (filters = DEFAULT_FILTERS) => {
    const response = await post('/api/snapshot', {filters});
    assert.equal(response.status, 200); return response.json();
  };
  const brief = (id, filters = DEFAULT_FILTERS, question = 'brief', options) => post('/api/brief', {
    filters, question, contextId: id.contextId, snapshotId: id.snapshotId,
  }, options);
  return {base, post, identity, brief};
}

const mockAnswer = request => ({
  contextId: request.contextId, snapshotId: request.snapshotId, intent: 'overview',
  claims: [{metricId: 'total.spend', value: request.facts['total.spend'].value}],
  recommendationId: 'review_measurement',
});

test('HTTP snapshot and default brief use authoritative metrics and honest demo mode', async t => {
  const api = await setup(t);
  const id = await api.identity();
  assert.equal(id.mode, 'demo');
  assert.equal(id.evidence.rowCount, 336);
  const response = await api.brief(id);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.mode, 'demo');
  assert.equal(result.snapshotId, id.snapshotId);
  assert.equal(result.answer.claims.find(claim => claim.metricId === 'total.spend').value, 86933.09);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('injected mock adapter is server-only and cannot be configured through request fields', async t => {
  let calls = 0;
  const api = await setup(t, {invoke: async request => { calls++; return mockAnswer(request); }});
  const id = await api.identity();
  assert.equal(id.mode, 'adapter_configured');
  assert.equal((await (await api.brief(id)).json()).mode, 'model');
  for (const injected of ['facts','system','endpoint','model','provider']) {
    const response = await api.post('/api/brief', {filters: DEFAULT_FILTERS, question: 'brief', contextId: id.contextId, snapshotId: id.snapshotId, [injected]: 'untrusted'});
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 1);
  assert.equal((await fetch(api.base + '/server/inference.mjs')).status, 404);
});

test('filter or dataset changes reject an old snapshot before calling the adapter', async t => {
  let rows = generate(), calls = 0;
  const api = await setup(t, {loadRows: async () => rows, invoke: async request => { calls++; return mockAnswer(request); }});
  const id = await api.identity();
  assert.equal((await api.brief(id, {...DEFAULT_FILTERS, channel: 'Instagram'})).status, 409);
  rows = structuredClone(rows); rows[0].spend++;
  const response = await api.brief(id);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'stale_snapshot');
  assert.equal(calls, 0);
});

test('a dataset revision during inference cannot release obsolete model evidence', async t => {
  let rows = generate();
  const api = await setup(t, {loadRows: async () => rows, invoke: async request => {
    rows = structuredClone(rows); rows[0].spend++; return mockAnswer(request);
  }});
  assert.equal((await api.brief(await api.identity())).status, 409);
});

test('malformed and over-limit requests fail without inference; errors stay sanitized', async t => {
  let calls = 0;
  const api = await setup(t, {invoke: async request => { calls++; return mockAnswer(request); }});
  for (const body of [null, [], {filters: {}}, {filters: {...DEFAULT_FILTERS, start: 'wrong'}}, {filters: {...DEFAULT_FILTERS, channel: 'Unknown'}}]) {
    assert.equal((await api.post('/api/snapshot', body)).status, 400);
  }
  assert.equal((await api.post('/api/snapshot', {}, {body: '{oops'})).status, 400);
  assert.equal((await api.post('/api/snapshot', {}, {headers: {'Content-Type': 'text/plain'}})).status, 415);
  assert.equal((await api.post('/api/snapshot', {filters: DEFAULT_FILTERS, extra: 'x'.repeat(9000)})).status, 413);
  assert.equal((await fetch(api.base + '/api/brief')).status, 405);
  const id = await api.identity();
  assert.equal((await api.brief(id, DEFAULT_FILTERS, 'x'.repeat(501))).status, 400);
  assert.equal((await api.brief(id, DEFAULT_FILTERS, '   ')).status, 400);
  assert.equal(calls, 0);
});

test('cross-origin and non-loopback Host requests never reach the adapter', async t => {
  const api = await setup(t);
  for (const extra of [{Origin: 'https://untrusted.example'}, {'Sec-Fetch-Site': 'cross-site'}, {Origin: 'null'}]) {
    assert.equal((await api.post('/api/snapshot', {filters: DEFAULT_FILTERS}, {headers: {'Content-Type': 'application/json', ...extra}})).status, 403);
  }
  const status = await new Promise((resolve, reject) => {
    const req = http.get(api.base, {headers: {Host: 'untrusted.example'}}, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(status, 403);
});

test('chunked requests obey the same byte limit as Content-Length requests', async t => {
  const api = await setup(t);
  const status = await new Promise((resolve, reject) => {
    const req = http.request(api.base + '/api/snapshot', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
    }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.write('{"filters":'); req.end('x'.repeat(9000));
  });
  assert.equal(status, 413);
});

test('out-of-order requests keep their own filter and evidence snapshots', async t => {
  const pending = [];
  let ready;
  const started = new Promise(resolve => { ready = resolve; });
  const api = await setup(t, {invoke: request => new Promise(resolve => {
    pending.push({request, resolve}); if (pending.length === 2) ready();
  })});
  const instagram = {...DEFAULT_FILTERS, channel: 'Instagram'};
  const allId = await api.identity(), filteredId = await api.identity(instagram);
  const allRequest = api.brief(allId), filteredRequest = api.brief(filteredId, instagram);
  await started;
  const filtered = pending.find(item => item.request.snapshotId === filteredId.snapshotId);
  filtered.resolve(mockAnswer(filtered.request));
  const first = await (await filteredRequest).json();
  const all = pending.find(item => item.request.snapshotId === allId.snapshotId);
  all.resolve(mockAnswer(all.request));
  const second = await (await allRequest).json();
  assert.equal(first.snapshotId, filteredId.snapshotId);
  assert.equal(second.snapshotId, allId.snapshotId);
  assert.notEqual(first.answer.claims[0].value, second.answer.claims[0].value);
});

test('empty filters, fallback and upstream timeout have distinct HTTP outcomes', async t => {
  const api = await setup(t, {timeoutMs: 10, invoke: () => new Promise(() => {})});
  const filters = {...DEFAULT_FILTERS, audience: 'Prospecting', goal: 'Traffic'};
  const empty = await api.brief(await api.identity(filters), filters);
  assert.equal(empty.status, 422); assert.equal((await empty.json()).error.code, 'empty_snapshot');
  const id = await api.identity();
  const result = await (await api.brief(id)).json();
  assert.equal(result.mode, 'fallback'); assert.equal(result.reason, 'timeout');
  const unsupported = await api.brief(id, DEFAULT_FILTERS, 'Write a poem');
  assert.equal(unsupported.status, 422); assert.equal((await unsupported.json()).error.code, 'fallback_unavailable');
});

test('disconnecting the HTTP client cancels the mocked upstream request', {timeout: 2500}, async t => {
  let markStarted, markAborted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const aborted = new Promise(resolve => { markAborted = resolve; });
  const api = await setup(t, {invoke: (_, {signal}) => {
    signal.addEventListener('abort', markAborted, {once: true}); markStarted(); return new Promise(() => {});
  }});
  const id = await api.identity();
  const controller = new AbortController();
  const request = api.brief(id, DEFAULT_FILTERS, 'brief', {signal: controller.signal});
  await started; controller.abort();
  await assert.rejects(request, error => error.name === 'AbortError');
  await aborted;
});

test('server internals and adapter diagnostics do not leak into JSON responses', async t => {
  const unavailable = await setup(t, {loadRows: async () => { throw new Error('private file path'); }});
  const error = await unavailable.post('/api/snapshot', {filters: DEFAULT_FILTERS});
  assert.equal(error.status, 500); assert.doesNotMatch(await error.text(), /private file path/);
  const api = await setup(t, {invoke: async () => { throw new Error('private connection diagnostic'); }});
  const response = await api.brief(await api.identity());
  const result = await response.json();
  assert.equal(result.mode, 'fallback'); assert.equal(result.reason, 'provider_unavailable');
  assert.doesNotMatch(JSON.stringify(result), /private connection diagnostic/);
});

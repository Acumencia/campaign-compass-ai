import {DeterministicProvider, validateResponse} from './assistant.mjs';

const routes = new Set(['/api/session','/api/snapshot', '/api/brief', '/api/provider/consent', '/api/provider/status', '/api/provider/select', '/api/provider/key', '/api/provider/configure', ...['session','models','model','select','cancel','disconnect','acknowledge','retry-usage'].map(name => `/api/chatgpt/${name}`)]);
const recovery = 'Reload the app served by npm start. Demo mode remains available.';
function transportError(route, response, kind) {
  const status = response?.status || 0;
  const error = new Error(`Local service ${kind} (${route}; ${status ? `HTTP ${status}` : 'status unavailable'}). ${recovery}`);
  error.code = 'local_response_invalid';
  error.diagnostic = {path: route, httpStatus: status, kind};
  return error;
}
async function localJSON(response, route) {
  if (response.type === 'opaqueredirect' || response.redirected || (response.status >= 300 && response.status < 400)) {
    throw transportError(route, response, 'unexpected redirect');
  }
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw transportError(route, response, type === 'text/html' ? 'returned HTML instead of JSON' : 'returned a non-JSON response');
  const reader = response.body?.getReader(), chunks = []; let size = 0;
  if (!reader) throw transportError(route, response, 'returned an empty response');
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 128000) { await reader.cancel(); throw transportError(route, response, 'response exceeded the size limit'); }
      chunks.push(value);
    }
  } catch (error) {
    if (error.name === 'AbortError' || error.code === 'local_response_invalid') throw error;
    throw transportError(route, response, 'response was interrupted');
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw transportError(route, response, 'returned malformed JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw transportError(route, response, 'returned an unsupported response');
  return data;
}

export async function datasetIdentity(rows, filters) {
  const canonical = Object.fromEntries(['start','end','channel','audience','goal'].map(key => [key, filters[key]]));
  const bytes = new TextEncoder().encode(JSON.stringify({rows, filters: canonical}));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('')}`;
}

export class ChatGPTClient {
  constructor({fetcher = (...args) => fetch(...args), getRows = () => [], identity = datasetIdentity} = {}) {
    this.fetcher = fetcher; this.getRows = getRows; this.identity = identity;
    this.state = {connected: false, sharing: false, models: [], profiles: [], supported: false};
    this.stateVersion=0; this.available = false; this.demo = new DeterministicProvider();
  }
  async api(route, {body, signal, method} = {}) {
    if (!routes.has(route)) throw new Error('Unsupported local service action.');
    if(body!==undefined)this.stateVersion++;
    let response;
    try { response = await this.fetcher(route, {method: method || (body === undefined ? 'GET' : 'POST'), redirect: 'manual',
      credentials: 'same-origin', signal, headers: {'Content-Type': 'application/json', 'X-CC-CSRF': this.state.csrf || ''},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})}); }
    catch (error) { if (error.name === 'AbortError') throw error; throw transportError(route, null, 'is unavailable'); }
    const data = await localJSON(response, route);
    if (!response.ok) {
      const error = new Error(data.error?.message || 'The local service could not complete this request.');
      error.code = data.error?.code; throw error;
    }
    return data;
  }
  async refresh() {
    const version=this.stateVersion;
    try {
      const state = await this.api('/api/session');
      if (typeof state.csrf !== 'string' || !state.apiKey || !state.keySettings) throw new Error();
      if(version!==this.stateVersion)return;
      this.state = state; this.available = true;
    } catch (error) {
      if(version!==this.stateVersion)return;
      this.available = false;
      this.state = {connected: false, sharing: false, models: [], profiles: [], supported: false,
        notice: error.code === 'local_response_invalid' ? error.message : 'Connection service unavailable. Start the local Node server to configure the API. Demo remains available.'};
    }
    return this.state;
  }
  async answer(question, snap, {signal} = {}) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!this.available) return this.demo.answer(question, snap);
    const identity = await this.identity(this.getRows(), snap.filters);
    const capture = await this.api('/api/snapshot', {body: {filters: snap.filters}, signal});
    if (capture.contextId !== snap.id || capture.snapshotId !== identity) throw new Error('The dataset changed. Refresh the page before asking again.');
    const result = await this.api('/api/brief', {body: {question, filters: snap.filters, contextId: capture.contextId, snapshotId: capture.snapshotId}, signal});
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (result.contextId !== snap.id || result.snapshotId !== identity || !['demo','model','fallback'].includes(result.mode)) throw new Error('An outdated or unsupported answer was rejected. Ask again.');
    validateResponse(result.answer, snap);
    return result;
  }
}

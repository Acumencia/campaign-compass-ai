import {DeterministicProvider, validateResponse} from './assistant.mjs';

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
    this.available = false; this.demo = new DeterministicProvider();
  }
  async api(route, {body, signal, method} = {}) {
    const response = await this.fetcher(route, {method: method || (body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin', signal, headers: {'Content-Type': 'application/json', 'X-CC-CSRF': this.state.csrf || ''},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error?.message || 'The local service could not complete this request.');
      error.code = data.error?.code; throw error;
    }
    return data;
  }
  async refresh() {
    try {
      const state = await this.api('/api/chatgpt/session');
      if (typeof state.csrf !== 'string' || typeof state.connected !== 'boolean' || !Array.isArray(state.profiles)) throw new Error();
      this.state = state; this.available = true;
    } catch {
      this.available = false;
      this.state = {connected: false, sharing: false, models: [], profiles: [], supported: false,
        notice: 'Connection service unavailable. Start the local Node server to use Continue with ChatGPT. Demo remains available.'};
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

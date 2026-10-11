import {ISSUER, SCOPES} from '../server/chatgpt-protocol.mjs';

// Entirely synthetic OAuth fixtures. No provider or real credential is involved.
export class MemoryStore {
  state = {version: 1, hostId: null, profiles: []};
  writes = 0; chain = Promise.resolve();
  async read() { return structuredClone(this.state); }
  withLock(fn) {
    const run = this.chain.then(async () => {
      const state = structuredClone(this.state);
      return fn(state, async () => { this.state = structuredClone(state); this.writes++; });
    });
    this.chain = run.catch(() => {}); return run;
  }
}
export function mockProtocol() {
  const calls = {tokens: [], models: [], inference: [], revoke: []};
  return {
    calls,
    async configuration() { return {issuer: ISSUER, authorization_endpoint: `${ISSUER}/api/accounts/authorize`}; },
    async token(parameters) {
      calls.tokens.push(parameters);
      return {access_token: 'fixture-access', refresh_token: `fixture-refresh-${calls.tokens.length}`, id_token: 'fixture-id',
        expires_in: 3600, receivedAt: Date.now(), token_type: 'Bearer', scope: SCOPES};
    },
    async identity() { return {subject: 'fixture-subject', issuer: ISSUER, email: 'demo@example.invalid'}; },
    async models(access) { calls.models.push(access); return [{slug: 'fixture-model', displayName: 'Mock model (test only)'}]; },
    async infer(access, model, request) { calls.inference.push({access, model}); return {answer: {
      contextId: request.contextId, snapshotId: request.snapshotId, intent: 'overview',
      claims: [{metricId: 'total.spend', value: request.facts['total.spend'].value}], recommendationId: 'review_measurement'},
      usage: {input: 10, output: 5, total: 15}}; },
    async revoke(profile) { calls.revoke.push(profile.clientId); },
  };
}
export async function connect(service, session, {profileId = null, clientId = 'fixture-client', callback = 'http://127.0.0.1:4173/auth/callback'} = {}) {
  const location = new URL(await service.start(session, callback, profileId));
  const params = new URLSearchParams({state: location.searchParams.get('state'), code: 'fixture-code', client_id: clientId});
  await service.callback(session, params);
  return {location, params};
}

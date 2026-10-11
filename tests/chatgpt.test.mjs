import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createChatGPTService} from '../server/chatgpt.mjs';
import {ChatGPTError, SCOPES} from '../server/chatgpt-protocol.mjs';
import {MemoryStore, mockProtocol, connect} from './chatgpt-fixtures.mjs';

function setup() {
  const store = new MemoryStore(), protocol = mockProtocol();
  const service = createChatGPTService({store, protocol, supported: true});
  return {store, protocol, service, session: service.sessionFor(null, true)};
}
const request = {contextId: 'fixture-context', snapshotId: 'fixture-snapshot', facts: {'total.spend': {value: 2}}, question: 'brief', system: 'fixture instruction'};
const options = () => ({signal: new AbortController().signal});

test('status is read-only and contains no credentials or fabricated eligibility', async () => {
  const {store, service, session, protocol} = setup();
  const status = await service.status(session);
  assert.equal(status.connected, false); assert.equal(store.writes, 0);
  assert.equal(store.state.hostId, null); assert.equal(protocol.calls.tokens.length, 0);
  assert.match(status.eligibility, /Not established/);
});

test('dynamic registration uses stable host, fresh state/nonce, PKCE and issued client', async () => {
  const {store, service, session, protocol} = setup();
  const {location} = await connect(service, session);
  const query = location.searchParams, exchange = protocol.calls.tokens[0];
  assert.equal(query.get('client_id'), 'dynamic_agent_client'); assert.equal(query.get('agent_name_hint'), 'Campaign Compass');
  assert.equal(query.get('scope'), SCOPES); assert.equal(query.get('code_challenge_method'), 'S256');
  assert.equal(createHash('sha256').update(exchange.code_verifier).digest('base64url'), query.get('code_challenge'));
  assert.equal(exchange.client_id, 'fixture-client'); assert.equal(exchange.redirect_uri, query.get('redirect_uri'));
  const again = new URL(await service.start(session, exchange.redirect_uri, session.profileId));
  assert.equal(again.searchParams.get('ext_agent_host_id'), store.state.hostId);
  assert.equal(again.searchParams.get('client_id'), 'fixture-client'); assert.equal(again.searchParams.has('agent_name_hint'), false);
  assert.notEqual(again.searchParams.get('state'), query.get('state')); assert.notEqual(again.searchParams.get('nonce'), query.get('nonce'));
  assert.equal(again.searchParams.get('id_token_hint'), 'fixture-id');
  assert.doesNotMatch(JSON.stringify(await service.status(session)), /fixture-access|fixture-refresh|fixture-id/);
});

test('callback state is session-bound, single-use and expired states fail', async () => {
  const {service, session, protocol} = setup();
  const other = service.sessionFor(null, true);
  const url = new URL(await service.start(session, 'http://127.0.0.1:4173/auth/callback', null));
  const params = new URLSearchParams({state: url.searchParams.get('state'), code: 'fixture-code', client_id: 'fixture-client'});
  await assert.rejects(service.callback(other, params), error => error.code === 'invalid_state');
  await service.callback(session, params);
  await assert.rejects(service.callback(session, params), error => error.code === 'invalid_state');
  assert.equal(protocol.calls.tokens.length, 1);
  let clock = Date.now(); const expiring = createChatGPTService({store: new MemoryStore(), protocol: mockProtocol(), supported: true, now: () => clock});
  const s = expiring.sessionFor(null, true), location = new URL(await expiring.start(s, 'http://127.0.0.1:4173/auth/callback', null));
  clock += 600001;
  await assert.rejects(expiring.callback(s, new URLSearchParams({state: location.searchParams.get('state'), code: 'x', client_id: 'x'})), error => error.code === 'invalid_state');
});

test('declines, duplicate callback parameters and invalid client changes never enable inference', async () => {
  const {service, session, protocol} = setup();
  const location = new URL(await service.start(session, 'http://127.0.0.1:4173/auth/callback', null));
  await service.callback(session, new URLSearchParams({state: location.searchParams.get('state'), error: 'access_denied'}));
  assert.equal(protocol.calls.tokens.length, 0); assert.equal((await service.status(session)).connected, false);
  await connect(service, session);
  const again = new URL(await service.start(session, 'http://127.0.0.1:4173/auth/callback', session.profileId));
  await assert.rejects(service.callback(session, new URLSearchParams({state: again.searchParams.get('state'), code: 'x', client_id: 'other-client'})), error => error.code === 'invalid_callback');
  await assert.rejects(service.start(session, 'http://localhost:4173/auth/callback', null), error => error.code === 'invalid_callback');
});

test('missing plan permission keeps identity but blocks model requests', async () => {
  const {service, session, protocol} = setup(); const token = protocol.token;
  protocol.token = async (...args) => ({...await token(...args), scope: 'openid profile email offline_access'});
  await connect(service, session);
  assert.equal((await service.status(session)).connected, true); assert.equal((await service.status(session)).sharing, false);
  await assert.rejects(service.models(session), error => error.code === 'permission_required');
  assert.equal(protocol.calls.models.length, 0);
});

test('saved registrations cannot be used by a different browser session', async () => {
  const {service, session, protocol} = setup(); await connect(service, session);
  const other = service.sessionFor(null, true);
  await assert.rejects(service.selectProfile(other, session.profileId), error => error.code === 'disconnected');
  await assert.rejects(service.models(other), error => error.code === 'disconnected');
  assert.equal(protocol.calls.models.length, 0);
});

test('same-email registrations stay separate and returning identity mismatch is rejected', async () => {
  const {service, session, store, protocol} = setup(); await connect(service, session);
  const first = session.profileId;
  await connect(service, session, {clientId: 'fixture-client-2'});
  assert.notEqual(session.profileId, first); assert.equal(store.state.profiles.length, 2);
  const second = session.profileId;
  protocol.identity = async () => ({subject: 'wrong-subject', issuer: 'https://auth.openai.com', email: 'demo@example.invalid'});
  await assert.rejects(connect(service, session, {profileId: first}), error => error.code === 'invalid_identity');
  assert.equal(session.profileId, second);
});

test('rotating refresh is serialized and the newest token is saved atomically', async () => {
  const {service, session, store, protocol} = setup(); await connect(service, session);
  store.state.profiles[0].tokens.expiresAt = 0;
  await Promise.all([service.models(session), service.models(session)]);
  assert.equal(protocol.calls.tokens.filter(call => call.grant_type === 'refresh_token').length, 1);
  assert.equal(store.state.profiles[0].tokens.refresh_token, 'fixture-refresh-2');
  assert.equal(protocol.calls.tokens[1].scope, undefined);
});

test('terminal refresh clears tokens; temporary refresh failure preserves them', async () => {
  for (const code of ['invalid_grant', 'temporary_failure', 'invalid_response']) {
    const {service, session, store, protocol} = setup(); await connect(service, session);
    store.state.profiles[0].tokens.expiresAt = 0;
    protocol.token = async () => { throw new ChatGPTError(code, code === 'invalid_grant' ? 400 : 503); };
    await assert.rejects(service.models(session));
    assert.equal(!!store.state.profiles[0].tokens, code !== 'invalid_grant');
    assert.equal(store.state.profiles[0].clientId, 'fixture-client');
  }
});

test('unentitled and usage-limit failures pause new inference without OAuth loops', async () => {
  for (const code of ['subscription_sharing_user_not_eligible','subscription_sharing_usage_limit_exceeded']) {
    const {service, session, protocol, store} = setup(); await connect(service, session); await service.models(session); service.selectModel(session, 'fixture-model');
    let calls = 0; protocol.infer = async () => { calls++; throw new ChatGPTError(code, code.includes('limit') ? 429 : 403); };
    await assert.rejects(service.invoke(session, request, options()));
    await assert.rejects(service.invoke(session, request, options()));
    assert.equal(calls, 1); assert.equal(store.state.profiles[0].blocked, code); assert.equal(protocol.calls.tokens.length, 1);
    await service.retryUsage(session);
    assert.equal(store.state.profiles[0].blocked, code.includes('limit') ? null : code);
  }
});

test('concurrency is bounded and disconnect aborts work, revokes and clears tokens', async () => {
  const {service, session, protocol, store} = setup(); await connect(service, session); await service.models(session); service.selectModel(session, 'fixture-model');
  let started; const ready = new Promise(resolve => { started = resolve; });
  protocol.infer = async (_, model, data, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new ChatGPTError('cancelled', 499)), {once: true}); started();
  });
  const pending = service.invoke(session, request, options()); const rejected = assert.rejects(pending, error => error.code === 'cancelled');
  await ready; await assert.rejects(service.invoke(session, request, options()), error => error.code === 'busy');
  const result = await service.disconnect(session); await rejected;
  assert.equal(result.confirmed, true); assert.equal(protocol.calls.revoke.length, 1);
  assert.equal(store.state.profiles[0].tokens, undefined); assert.equal(store.state.profiles[0].clientId, 'fixture-client');
  assert.equal(service.connected(session), false);
});

test('unconfirmed revocation still clears local credentials and tells the user', async () => {
  const {service, session, protocol, store} = setup(); await connect(service, session);
  protocol.revoke = async () => { throw new ChatGPTError('temporary_failure', 503); };
  assert.equal((await service.disconnect(session)).confirmed, false);
  assert.equal(store.state.profiles[0].tokens, undefined);
  assert.match((await service.status(session)).notice, /not confirmed/);
});

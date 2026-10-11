import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair, SignJWT} from 'jose';
import {createOpenAIProtocol, verifyIDToken, ISSUER, RESOURCE, SCOPES} from '../server/chatgpt-protocol.mjs';

const config = {issuer: ISSUER, authorization_endpoint: `${ISSUER}/api/accounts/authorize`, token_endpoint: `${ISSUER}/api/accounts/oauth/token`,
  jwks_uri: `${ISSUER}/.well-known/jwks.json`, revocation_endpoint: `${ISSUER}/api/accounts/oauth/revoke`};
const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type':'application/json'}});
const event = value => `data: ${JSON.stringify(value)}\r\n\r\n`;

test('ID token validation rejects bad signature, issuer, audience, expiry and nonce', async () => {
  const key = await generateKeyPair('RS256'), other = await generateKeyPair('RS256');
  const sign = async (overrides = {}, signing = key.privateKey) => new SignJWT({sub: 'fixture-user', iss: ISSUER, aud: 'fixture-client',
    exp: Math.floor(Date.now()/1000)+60, iat: Math.floor(Date.now()/1000), nonce: 'fixture-nonce', ...overrides})
    .setProtectedHeader({alg:'RS256'}).sign(signing);
  assert.equal((await verifyIDToken(await sign(), 'fixture-client', 'fixture-nonce', key.publicKey)).subject, 'fixture-user');
  for (const claims of [{iss:'https://invalid.example'}, {aud:'different-client'}, {exp:1}, {nonce:'different'}, {sub:''}, {aud:['fixture-client','other'],azp:'other'}]) {
    await assert.rejects(verifyIDToken(await sign(claims), 'fixture-client', 'fixture-nonce', key.publicKey), error => error.code === 'invalid_identity');
  }
  await assert.rejects(verifyIDToken(await sign({}, other.privateKey), 'fixture-client', 'fixture-nonce', key.publicKey));
  await assert.rejects(verifyIDToken('not-a-token', 'fixture-client', 'fixture-nonce', key.publicKey));
});

test('discovery pins official issuer/endpoints and tokens use a form-encoded public-client exchange', async () => {
  const calls = [];
  const protocol = createOpenAIProtocol({fetcher: async (url, options) => {
    calls.push({url, options});
    return url.endsWith('openid-configuration') ? json(config) : json({access_token:'fixture-access', refresh_token:'fixture-refresh',
      id_token:'fixture-id', token_type:'Bearer', expires_in:3600, scope:SCOPES});
  }});
  await protocol.token({grant_type:'authorization_code',client_id:'issued-fixture',code:'fixture-code',code_verifier:'fixture-verifier',redirect_uri:'http://127.0.0.1:4173/auth/callback',resource:RESOURCE});
  assert.equal(calls[1].url, config.token_endpoint); assert.equal(calls[1].options.body.get('client_secret'), null);
  assert.equal(calls[1].options.body.get('client_id'), 'issued-fixture'); assert.equal(calls[1].options.redirect, 'error');
  const invalid = createOpenAIProtocol({fetcher: async () => json({...config, jwks_uri:'https://invalid.example/keys'})});
  await assert.rejects(invalid.configuration(), error => error.code === 'invalid_discovery');
});

test('model discovery preserves account catalog order and hides non-list entries', async () => {
  const protocol = createOpenAIProtocol({fetcher: async (url, options) => {
    assert.equal(url, `${RESOURCE}/models`); assert.equal(options.headers.Authorization, 'Bearer fixture-access');
    return json({models:[{slug:'b',display_name:'Model B',visibility:'list'},{slug:'hidden',display_name:'Hidden',visibility:'hide'},{slug:'a',display_name:'Model A',visibility:'list'}]});
  }});
  assert.deepEqual((await protocol.models('fixture-access')).map(model => model.slug), ['b','a']);
});

test('Responses uses only supported fields and waits for completion across split SSE boundaries', async () => {
  const answer = {contextId:'x',snapshotId:'y',intent:'overview',claims:[{metricId:'total.spend',value:1}],recommendationId:'review_measurement'};
  const payload = event({type:'response.output_text.delta',delta:JSON.stringify(answer)}) + event({type:'response.completed',response:{status:'completed',usage:{input_tokens:10,output_tokens:5,total_tokens:15}}});
  const protocol = createOpenAIProtocol({fetcher: async (url, options) => {
    assert.equal(url, `${RESOURCE}/responses`);
    const body = JSON.parse(options.body);
    assert.deepEqual(Object.keys(body).sort(), ['input','instructions','model','store','stream']);
    assert.equal(body.store,false); assert.equal(body.stream,true); assert.ok(Array.isArray(body.input));
    assert.equal(options.headers.Authorization,'Bearer fixture-access');
    return new Response(new ReadableStream({start(controller) { for (const char of payload) controller.enqueue(new TextEncoder().encode(char)); controller.close(); }}), {headers:{'Content-Type':'text/event-stream'}});
  }});
  const result = await protocol.infer('fixture-access','fixture-model',{system:'test',question:'brief',contextId:'x',snapshotId:'y',facts:{}},new AbortController().signal);
  assert.deepEqual(result.answer,answer); assert.equal(result.usage.total,15);
});

test('partial, failed, usage-limited and malformed streams never become model answers', async () => {
  const streams = [event({type:'response.output_text.delta',delta:'{}'}),
    event({type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}),
    event({type:'response.incomplete'}), 'data: not-json\n\n',
    event({type:'response.output_text.delta',delta:'not-json'})+event({type:'response.completed'}),
    event({type:'response.output_text.delta',delta:'x'.repeat(16001)})];
  for (const content of streams) {
    const protocol = createOpenAIProtocol({fetcher: async () => new Response(content,{headers:{'Content-Type':'text/event-stream'}})});
    await assert.rejects(protocol.infer('fixture-access','fixture-model',{},new AbortController().signal));
  }
});

test('admission errors retain bounded codes/request IDs but not raw diagnostic text', async () => {
  const protocol = createOpenAIProtocol({fetcher: async () => new Response(JSON.stringify({detail:'private upstream diagnostic'}), {status:403,headers:{'x-request-id':'fixture-request'}})});
  await assert.rejects(protocol.models('fixture-access'), error => {
    assert.equal(error.code,'restricted'); assert.equal(error.status,403); assert.equal(error.diagnostic.requestId,'fixture-request');
    assert.doesNotMatch(error.message,/private upstream/); return true;
  });
});

test('revocation uses discovery and only sends refresh credentials in the POST body', async () => {
  const protocol = createOpenAIProtocol({fetcher: async (url, options) => {
    if (url.endsWith('openid-configuration')) return json(config);
    assert.equal(url, config.revocation_endpoint); assert.equal(options.body.get('token_type_hint'),'refresh_token');
    assert.equal(options.body.get('client_id'),'fixture-client'); assert.equal(options.body.get('token'),'fixture-refresh');
    return new Response(null,{status:200});
  }});
  await protocol.revoke({clientId:'fixture-client',tokens:{refresh_token:'fixture-refresh'}});
});

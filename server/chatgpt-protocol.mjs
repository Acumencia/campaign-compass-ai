import {createRemoteJWKSet, jwtVerify} from 'jose';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
export const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const USAGE_URL = 'https://chatgpt.com/settings/usage';

const messages = {
  disconnected: 'Connect your ChatGPT account before using your plan.',
  model_required: 'Choose an available model in ChatGPT connection before asking with your plan.',
  invalid_identity: 'The returned OpenAI identity could not be verified. This sign-in was not accepted.',
  invalid_state: 'This sign-in expired or does not match this browser session. Start again from the app.',
  permission_required: 'ChatGPT plan usage is not enabled for this connection. You can review consent with Continue with ChatGPT.',
  subscription_sharing_user_not_eligible: 'ChatGPT plan usage is unavailable for this account, workspace or policy. No request was retried.',
  subscription_sharing_usage_limit_exceeded: 'ChatGPT plan or app usage limit reached. Review Manage usage before trying again.',
  subscription_sharing_usage_unavailable: 'ChatGPT usage availability could not be checked. Try again later.',
  busy: 'One ChatGPT request is already running for this connection. Wait or cancel it first.',
  invalid_grant: 'This connection needs a fresh sign-in. Continue with ChatGPT using the saved connection.',
  cancelled: 'The request was cancelled.',
  incomplete_stream: 'ChatGPT did not complete the response. No partial answer was used.',
  restricted: 'OpenAI denied this request. Review your account or workspace permissions; no alternate billing path was used.',
};
export class ChatGPTError extends Error {
  constructor(code, status = 400, diagnostic = {}) {
    super(messages[code] || 'The ChatGPT request could not be completed. Try again later or review your connection.');
    this.code = code; this.status = status;
    // Keep only bounded machine metadata; raw bodies/messages can contain secrets.
    this.diagnostic = Object.fromEntries(Object.entries(diagnostic).filter(([, v]) => typeof v === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(v)));
  }
}

export async function boundedJSON(response, limit = 128000) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > limit) throw new ChatGPTError('invalid_response', 502);
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ChatGPTError('invalid_response', 502); }
}

export function responseError(status, body, requestId) {
  const raw = body?.error?.code || body?.error;
  const code = typeof raw === 'string' && /^[a-z0-9_]{1,100}$/.test(raw) ? raw : status === 403 || status === 401 ? 'restricted' : 'provider_unavailable';
  return new ChatGPTError(code, status, {requestId, param: body?.error?.param, bodyShape: typeof body?.detail === 'string' ? 'detail' : 'error'});
}

export async function verifyIDToken(idToken, clientId, nonce, key) {
  try {
    const {payload} = await jwtVerify(idToken, key, {issuer: ISSUER, audience: clientId,
      algorithms: ['RS256', 'ES256'], requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5});
    if (typeof payload.sub !== 'string' || !payload.sub || (nonce !== undefined && payload.nonce !== nonce)) throw new Error();
    if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) throw new Error();
    return {subject: payload.sub, email: typeof payload.email === 'string' ? payload.email.slice(0,254) : '', issuer: ISSUER};
  } catch { throw new ChatGPTError('invalid_identity', 401); }
}

export function createOpenAIProtocol({fetcher = fetch, verifyIdentity} = {}) {
  let discovery, jwks;
  async function configuration(signal) {
    if (!discovery) {
      const response = await fetcher(`${ISSUER}/.well-known/openid-configuration`, {signal, redirect: 'error'});
      if (!response.ok) throw new ChatGPTError('discovery_unavailable', 503);
      const data = await boundedJSON(response);
      if (data.issuer !== ISSUER || data.authorization_endpoint !== `${ISSUER}/api/accounts/authorize` ||
          data.token_endpoint !== `${ISSUER}/api/accounts/oauth/token` ||
          ['jwks_uri', 'revocation_endpoint'].some(key => {
            try { const url = new URL(data[key]); return url.origin !== ISSUER || url.username || url.password; } catch { return true; }
          })) throw new ChatGPTError('invalid_discovery', 502);
      discovery = data;
    }
    return discovery;
  }
  async function identity(idToken, clientId, nonce, signal) {
    if (verifyIdentity) return verifyIdentity(idToken, clientId, nonce, signal); // Test injection only.
    const config = await configuration(signal);
    jwks ||= createRemoteJWKSet(new URL(config.jwks_uri), {timeoutDuration: 8000});
    return verifyIDToken(idToken, clientId, nonce, jwks);
  }
  async function token(parameters, signal) {
    const config = await configuration(signal);
    const response = await fetcher(config.token_endpoint, {method: 'POST', redirect: 'error', signal,
      headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(parameters)});
    const data = await boundedJSON(response);
    if (!response.ok) throw responseError(response.status, data, response.headers.get('x-request-id'));
    if (typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token ||
        typeof data.id_token !== 'string' || !data.id_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
        typeof data.scope !== 'string' || data.token_type?.toLowerCase() !== 'bearer') throw new ChatGPTError('invalid_token_response', 502);
    return {...data, receivedAt: Date.now()};
  }
  async function models(accessToken, signal) {
    const response = await fetcher(`${RESOURCE}/models`, {redirect: 'error', signal, headers: {Authorization: `Bearer ${accessToken}`}});
    const data = await boundedJSON(response);
    if (!response.ok) throw responseError(response.status, data, response.headers.get('x-request-id'));
    if (!Array.isArray(data.models)) throw new ChatGPTError('invalid_response', 502);
    return data.models.filter(model => model.visibility === 'list' && typeof model.slug === 'string' && /^[a-zA-Z0-9._:-]{1,120}$/.test(model.slug) && typeof model.display_name === 'string')
      .slice(0,100).map(model => ({slug: model.slug, displayName: model.display_name.slice(0,120)}));
  }
  async function infer(accessToken, model, request, signal) {
    const response = await fetcher(`${RESOURCE}/responses`, {method: 'POST', redirect: 'error', signal,
      headers: {Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({model, instructions: request.system, input: [{role: 'user', content: JSON.stringify({question: request.question, contextId: request.contextId, snapshotId: request.snapshotId, facts: request.facts})}], store: false, stream: true})});
    if (!response.ok) throw responseError(response.status, await boundedJSON(response), response.headers.get('x-request-id'));
    if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new ChatGPTError('invalid_response', 502);
    let buffer = '', bytes = 0, output = '', completed = false, usage = null;
    const decoder = new TextDecoder();
    const processEvent = raw => {
      const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data || data === '[DONE]') return;
      let event; try { event = JSON.parse(data); } catch { throw new ChatGPTError('invalid_response', 502); }
      if (event.type === 'response.failed' || event.type === 'error') throw responseError(502, {error: event.response?.error || event.error || event}, response.headers.get('x-request-id'));
      if (event.type === 'response.incomplete') throw new ChatGPTError('incomplete_stream', 502);
      if (event.type === 'response.output_text.delta') {
        if (typeof event.delta !== 'string' || output.length + event.delta.length > 16000) throw new ChatGPTError('invalid_response', 502);
        output += event.delta;
      }
      if (event.type === 'response.completed') { completed = true; usage = event.response?.usage; }
    };
    for await (const chunk of response.body) {
      bytes += chunk.length; if (bytes > 1024 * 1024) throw new ChatGPTError('invalid_response', 502);
      buffer = (buffer + decoder.decode(chunk, {stream: true})).replace(/\r\n/g, '\n');
      let boundary; while ((boundary = buffer.indexOf('\n\n')) !== -1) { processEvent(buffer.slice(0,boundary)); buffer = buffer.slice(boundary + 2); }
    }
    buffer += decoder.decode(); if (buffer.trim()) processEvent(buffer);
    if (!completed) throw new ChatGPTError('incomplete_stream', 502);
    let answer; try { answer = JSON.parse(output); } catch { throw new ChatGPTError('invalid_response', 502); }
    const tokens = usage && ['input_tokens','output_tokens','total_tokens'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)
      ? {input: usage.input_tokens, output: usage.output_tokens, total: usage.total_tokens} : null;
    return {answer, usage: tokens};
  }
  async function revoke(profile, signal) {
    const config = await configuration(signal);
    const response = await fetcher(config.revocation_endpoint, {method: 'POST', redirect: 'error', signal,
      headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({token: profile.tokens.refresh_token, token_type_hint: 'refresh_token', client_id: profile.clientId})});
    if (response.status !== 200) throw new ChatGPTError('revocation_unconfirmed', response.status);
  }
  return {configuration, identity, token, models, infer, revoke};
}

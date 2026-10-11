import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {ChatGPTStore, windowsProtection} from './chatgpt-store.mjs';
import {createOpenAIProtocol, ChatGPTError, ISSUER, RESOURCE, SCOPES, USAGE_URL} from './chatgpt-protocol.mjs';

const random = () => randomBytes(32).toString('base64url');
const terminalRefresh = new Set(['invalid_grant','invalid_refresh_token','token_expired','refresh_token_expired','refresh_token_invalidated','refresh_token_reused']);
const scopesOf = tokens => tokens.scope.split(/\s+/).filter(Boolean);
const permitted = profile => profile?.scopes?.includes('chatgpt.tokens.use.direct') && profile.scopes.includes('resource.invoke');
const find = (state, id) => state.profiles.find(profile => profile.id === id);
const combine = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);

function adopt(profile, data, identity) {
  profile.subject = identity.subject; profile.issuer = identity.issuer; profile.email = identity.email;
  profile.scopes = scopesOf(data); profile.status = 'connected'; profile.blocked = null;
  profile.tokens = {access_token: data.access_token, refresh_token: data.refresh_token, id_token: data.id_token,
    expiresAt: data.receivedAt + data.expires_in * 1000, earliestRefreshAt: data.earliest_refresh_at ?? null};
  delete profile.pendingTokens;
}

export function createChatGPTService({store = new ChatGPTStore(), protocol = createOpenAIProtocol(),
  supported = windowsProtection.available(), now = Date.now} = {}) {
  const sessions = new Map(), transactions = new Map(), running = new Map(), activeOAuth = new Map();
  function stopSession(session) {
    session.epoch++;
    activeOAuth.get(session.id)?.abort();
    for (const [state, tx] of transactions) if (tx.sessionId === session.id) { tx.controller.abort(); transactions.delete(state); }
    for (const task of running.values()) if (task.sessionId === session.id) task.controller.abort();
  }
  function sessionFor(id, create = false) {
    let session = sessions.get(id);
    if (session && session.expiresAt < now()) { stopSession(session); sessions.delete(id); session = undefined; }
    if (!session && create) {
      if (sessions.size >= 64) { const oldest = sessions.values().next().value; stopSession(oldest); sessions.delete(oldest.id); }
      session = {id: random(), csrf: random(), expiresAt: now() + 8 * 3600000, approved: new Set(), profileId: null,
        models: [], model: null, epoch: 0, notice: null, usage: null};
      sessions.set(session.id, session);
    }
    return session;
  }
  function rotateSession(session) {
    sessions.delete(session.id); session.id = random(); session.csrf = random();
    sessions.set(session.id, session);
  }
  async function status(session) {
    const state = await store.read();
    const selected = session?.approved.has(session.profileId) ? find(state, session.profileId) : null;
    return {supported, csrf: session?.csrf, connected: selected?.status === 'connected' && !!selected.tokens,
      sharing: !!(selected?.tokens && permitted(selected)), blocked: selected?.blocked || null,
      profileId: selected?.id || null, email: selected?.email || '', label: selected?.label || '',
      models: session?.models || [], model: session?.model || null, usage: session?.usage || null,
      usageURL: USAGE_URL, eligibility: 'Not established by sign-in or a model list; checked by OpenAI for each request.',
      notice: session?.notice || null, welcome: !!(selected?.tokens && permitted(selected) && !selected.welcomeSeen),
      profiles: state.profiles.map(profile => ({id: profile.id, label: profile.label, email: profile.email || '',
        status: profile.status, availableInSession: !!session?.approved.has(profile.id)}))};
  }
  async function start(session, redirectUri, profileId, reconsent = false) {
    if (!supported) throw new ChatGPTError('secure_storage_unavailable', 503);
    const url = new URL(redirectUri);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/auth/callback' || url.search || url.hash) throw new ChatGPTError('invalid_callback');
    stopSession(session);
    const controller = new AbortController();
    const config = await protocol.configuration(combine(controller.signal));
    const registration = await store.withLock(async (state, save) => {
      if (!state.hostId) { state.hostId = `urn:uuid:${randomUUID()}`; await save(); }
      const profile = profileId ? find(state, profileId) : null;
      if (profileId && !profile) throw new ChatGPTError('unknown_profile');
      if (!profile && state.profiles.length >= 20) throw new ChatGPTError('profile_limit');
      return {hostId: state.hostId, profile: profile ? structuredClone(profile) : null};
    });
    const state = random(), nonce = random(), verifier = random();
    const tx = {state, nonce, verifier, controller, redirectUri, sessionId: session.id, expiresAt: now() + 600000,
      profileId: registration.profile?.id || null, clientId: registration.profile?.clientId || 'dynamic_agent_client', epoch: session.epoch};
    transactions.set(state, tx);
    // The server sends this URL only as a navigation redirect, never JSON/JS/logs.
    const authorize = new URL(config.authorization_endpoint);
    authorize.search = new URLSearchParams({response_type: 'code', client_id: tx.clientId,
      ext_agent_host_id: registration.hostId, redirect_uri: redirectUri, scope: SCOPES, resource: RESOURCE,
      state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url')}).toString();
    if (!registration.profile) authorize.searchParams.set('agent_name_hint', 'Campaign Compass');
    if (registration.profile?.tokens?.id_token) authorize.searchParams.set('id_token_hint', registration.profile.tokens.id_token);
    if (registration.profile?.email) authorize.searchParams.set('login_hint', registration.profile.email);
    if (reconsent) authorize.searchParams.set('prompt', 'consent');
    return authorize.toString();
  }
  async function callback(session, params) {
    for (const key of ['state','code','client_id','error']) if (params.getAll(key).length > 1) throw new ChatGPTError('invalid_callback');
    const tx = transactions.get(params.get('state'));
    if (!tx || tx.sessionId !== session.id || tx.epoch !== session.epoch || tx.expiresAt < now()) throw new ChatGPTError('invalid_state');
    transactions.delete(tx.state); // Consume once before exchange, including declines.
    if (params.has('error')) { session.notice = 'Sign-in was not completed. No new plan access was enabled.'; return; }
    const supplied = params.get('client_id');
    const clientId = tx.clientId === 'dynamic_agent_client' ? supplied : tx.clientId;
    if (!clientId || !/^[a-zA-Z0-9_-]{1,200}$/.test(clientId) || clientId === 'dynamic_agent_client' ||
        (tx.clientId !== 'dynamic_agent_client' && supplied && supplied !== tx.clientId) || !params.get('code')) throw new ChatGPTError('invalid_callback');
    activeOAuth.set(session.id, tx.controller);
    try { await store.withLock(async (state, save) => {
      let profile = tx.profileId ? find(state, tx.profileId) : null;
      if (!profile) {
        profile = {id: randomUUID(), label: `Connection ${state.profiles.length + 1}`, clientId,
          status: 'registration_pending', scopes: [], subject: null, issuer: ISSUER, email: ''};
        state.profiles.push(profile); tx.profileId = profile.id; await save();
      }
      if (profile.clientId !== clientId) throw new ChatGPTError('invalid_identity', 401);
      const signal = combine(tx.controller.signal);
      const data = await protocol.token({grant_type: 'authorization_code', client_id: clientId,
        code: params.get('code'), code_verifier: tx.verifier, redirect_uri: tx.redirectUri, resource: RESOURCE}, signal);
      const identity = await protocol.identity(data.id_token, clientId, tx.nonce, signal);
      if ((profile.subject && profile.subject !== identity.subject) || identity.issuer !== ISSUER || session.epoch !== tx.epoch || tx.controller.signal.aborted) throw new ChatGPTError('invalid_identity', 401);
      adopt(profile, data, identity); await save();
      session.approved.add(profile.id); session.profileId = profile.id; session.models = []; session.model = null; session.usage = null;
      session.notice = permitted(profile) ? 'ChatGPT connected. Select a model, then explicitly ask for a brief to use your plan.' : 'Signed in, but ChatGPT plan usage was not granted.';
    }); } finally { if (activeOAuth.get(session.id) === tx.controller) activeOAuth.delete(session.id); }
  }
  async function credentials(session, signal) {
    if (!session?.approved.has(session.profileId)) throw new ChatGPTError('disconnected', 401);
    const profileId = session.profileId;
    return store.withLock(async (state, save) => {
      const profile = find(state, profileId);
      if (!profile?.tokens || profile.status !== 'connected') throw new ChatGPTError('disconnected', 401);
      if (profile.blocked) throw new ChatGPTError(profile.blocked, profile.blocked.includes('limit') ? 429 : 403);
      const finishRefresh = async () => {
        const pending = profile.pendingTokens;
        const identity = await protocol.identity(pending.id_token, profile.clientId, undefined, combine(signal));
        if (identity.subject !== profile.subject || identity.issuer !== profile.issuer) throw new ChatGPTError('invalid_identity', 401);
        adopt(profile, pending, identity); await save();
      };
      if (profile.pendingTokens) await finishRefresh();
      if (profile.tokens.expiresAt < now() + 60000) {
        const earliest = profile.tokens.earliestRefreshAt;
        const eligibleAt = typeof earliest === 'number' ? earliest * (earliest < 1e12 ? 1000 : 1) : Date.parse(earliest);
        if (Number.isFinite(eligibleAt) && eligibleAt > now()) throw new ChatGPTError('refresh_not_ready', 503);
        try {
          profile.pendingTokens = await protocol.token({grant_type: 'refresh_token', client_id: profile.clientId,
            refresh_token: profile.tokens.refresh_token, resource: RESOURCE}, combine(signal));
          await save(); // Protect rotating replacement before asynchronous identity validation.
          await finishRefresh();
        } catch (error) {
          if (terminalRefresh.has(error.code)) { delete profile.tokens; delete profile.pendingTokens; profile.status = 'reauth_required'; await save(); }
          throw error;
        }
      }
      if (!permitted(profile)) throw new ChatGPTError('permission_required', 403);
      if (signal?.aborted || session.profileId !== profileId) throw new ChatGPTError('cancelled', 499);
      return {accessToken: profile.tokens.access_token, profileId};
    });
  }
  async function block(profileId, error) {
    if (!['subscription_sharing_user_not_eligible','subscription_sharing_usage_limit_exceeded'].includes(error.code)) return;
    await store.withLock(async (state, save) => { const profile = find(state, profileId); if (profile) { profile.blocked = error.code; await save(); } });
  }
  async function models(session) {
    const epoch = session.epoch, profileId = session.profileId;
    try {
      const credentialsFor = await credentials(session);
      const result = await protocol.models(credentialsFor.accessToken, combine());
      if (epoch !== session.epoch || profileId !== session.profileId) throw new ChatGPTError('cancelled', 499);
      session.models = result; if (!result.some(item => item.slug === session.model)) session.model = null;
      return result;
    } catch (error) { await block(profileId, error); throw error; }
  }
  function selectModel(session, slug) {
    if (!session?.approved.has(session.profileId) || !session.models.some(model => model.slug === slug)) throw new ChatGPTError('invalid_model');
    stopSession(session); session.model = slug;
  }
  async function selectProfile(session, id) {
    if (!session.approved.has(id)) throw new ChatGPTError('disconnected', 401);
    stopSession(session); session.profileId = id; session.model = null; session.models = []; session.usage = null;
  }
  async function invoke(session, request, {signal}) {
    const profileId = session?.profileId, epoch = session?.epoch;
    if (!session?.approved.has(profileId)) throw new ChatGPTError('disconnected', 401);
    if (!session.model) throw new ChatGPTError('model_required');
    if (running.has(profileId)) throw new ChatGPTError('busy', 409);
    const controller = new AbortController();
    const combined = AbortSignal.any([controller.signal, signal]);
    running.set(profileId, {controller, sessionId: session.id});
    try {
      const selected = await credentials(session, combined);
      const result = await protocol.infer(selected.accessToken, session.model, request, combined);
      if (combined.aborted || session.epoch !== epoch || session.profileId !== profileId) throw new ChatGPTError('cancelled', 499);
      session.usage = result.usage;
      return result.answer;
    } catch (error) { await block(profileId, error); throw error; }
    finally { running.delete(profileId); }
  }
  async function disconnect(session) {
    const profileId = session.profileId;
    if (!session.approved.has(profileId)) throw new ChatGPTError('disconnected', 401);
    for (const other of sessions.values()) if (other.approved.has(profileId)) { stopSession(other); other.approved.delete(profileId); if (other.profileId === profileId) { other.profileId = null; other.model = null; other.models = []; other.usage = null; } }
    let confirmed = false;
    await store.withLock(async (state, save) => {
      const profile = find(state, profileId);
      if (profile?.tokens) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try { await protocol.revoke({...profile, tokens: profile.pendingTokens || profile.tokens}, combine()); confirmed = true; break; }
          catch (error) { if (attempt || (error.status && error.status < 500)) break; await delay(250); }
        }
        delete profile.tokens; delete profile.pendingTokens; profile.status = 'disconnected'; profile.scopes = []; profile.blocked = null; await save();
      }
    });
    session.notice = confirmed ? 'Disconnected. The renewable session was revoked.' : 'Disconnected locally. Remote revocation was not confirmed; disconnect this app in ChatGPT Settings.';
    return {confirmed};
  }
  async function acknowledge(session) {
    if (!session.approved.has(session.profileId)) throw new ChatGPTError('disconnected', 401);
    await store.withLock(async (state, save) => { const profile = find(state, session.profileId); if (profile) { profile.welcomeSeen = true; await save(); } });
  }
  async function retryUsage(session) {
    if (!session.approved.has(session.profileId)) throw new ChatGPTError('disconnected', 401);
    await store.withLock(async (state, save) => { const profile = find(state, session.profileId);
      if (profile?.blocked === 'subscription_sharing_usage_limit_exceeded') { profile.blocked = null; await save(); } });
  }
  return {sessionFor, rotateSession, status, start, callback, models, selectModel, selectProfile, invoke, disconnect,
    acknowledge, retryUsage, cancel: stopSession, connected: session => !!session?.approved.has(session.profileId)};
}

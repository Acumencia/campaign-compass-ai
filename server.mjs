import {publicValidationDiagnostics} from './server/rag.mjs';
import {createCampaignRetrieval} from './server/campaign-retrieval.mjs';
import {createCampaignHTTP} from './server/campaign-http.mjs';
import {CAMPAIGN_DEFAULTS,campaignReadiness,createBudgetedCampaignGeneration} from './server/campaign-runtime.mjs';
import {loadCampaignStartup} from './server/campaign-startup.mjs';
import {resolveConversation} from './server/conversation.mjs';
import {evaluateComparisons} from './server/rag-evaluation.mjs';
import {createKeyStore,KeyStoreError} from './server/key-store.mjs';
import http from 'node:http';
import {createAPIProviders} from './server/api-providers.mjs';
import {createRagService} from './server/rag.mjs';
import {ragOptions} from './server/rag-config.mjs';
import {loadKnowledge, manifest, source, askKnowledge, exactFields, KnowledgeError} from './server/knowledge.mjs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {parseCSV, validateFilters} from './src/metrics.mjs';
import {createInferenceSnapshot, snapshotIdentity, runInference, InferenceError} from './server/inference.mjs';
import {createChatGPTService} from './server/chatgpt.mjs';
import {ChatGPTError} from './server/chatgpt-protocol.mjs';
import {timingSafeEqual} from 'node:crypto';

const root = fileURLToPath(new URL('.', import.meta.url));
const allowed = new Set(['local-review.css','local-review.html','index.html','styles.css','src/app.mjs','src/metrics.mjs','src/assistant.mjs','src/glossary.mjs','src/chatgpt-client.mjs','src/connection-ui.mjs','src/knowledge-ui.mjs','data/campaigns.csv','campaign.html','campaign.css','src/campaign-ui.mjs','src/campaign-readiness.mjs']);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.csv':'text/csv; charset=utf-8'};
const loadDataset = async () => parseCSV(await readFile(path.join(root, 'data/campaigns.csv'), 'utf8'));
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function fields(value, expected) {
  if (!isRecord(value) || Object.keys(value).length !== expected.length ||
      Object.keys(value).some(key => !expected.includes(key))) {
    throw new InferenceError(400, 'invalid_request', 'Request fields do not match the inference contract.');
  }
}

async function readText(req, type = 'application/json', maxBytes = 8192) {
  if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== type) {
    throw new InferenceError(415, 'content_type_required', `Use ${type}.`);
  }
  if (Number(req.headers['content-length']) > maxBytes) {
    throw new InferenceError(413, 'request_too_large', `Request exceeds ${maxBytes} bytes.`);
  }
  let bytes = 0;
  const chunks = [];
  // Keep the connection available for a bounded JSON error on chunked bodies.
  for await (const chunk of req.iterator({destroyOnReturn: false})) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new InferenceError(413, 'request_too_large', `Request exceeds ${maxBytes} bytes.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function readJSON(req, maxBytes = 8192) {
  try { return JSON.parse(await readText(req,'application/json',maxBytes)); }
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

export function createServer({invoke, timeoutMs = 30000, loadRows = loadDataset, loadCorpus = loadKnowledge, apiKey = createAPIProviders(), credentials = null, rag, ragStoreDirectory, campaignDirectory=path.join(root,'data/campaign-private'), campaignService, campaignDefaultsEnabled=true, campaignFetch=globalThis.fetch, campaignAPI=null, campaignRetrievalAPI=null, campaignRetrievalAuthorize=null, campaignIndexedCorpus=null, campaignRetrieveBrand=null, campaignBudgetPolicy, campaignGenerationFactory=createBudgetedCampaignGeneration, chatgpt = createChatGPTService()} = {}) {
  if ((invoke !== undefined && typeof invoke !== 'function') || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new Error('Invalid inference configuration.');
  }
  const apiFor=session=>{const service=credentials?.providers||apiKey;return service.forSession?service.forSession(session):service;};
  const campaignAPIFor=session=>campaignAPI||apiFor(session);
  const retrievalAPIFor=session=>campaignRetrievalAPI||apiFor(session);
  const retrievalAuthorized=session=>{
    const api=retrievalAPIFor(session),state=api.status();
    if(campaignRetrievalAuthorize)return campaignRetrievalAuthorize({session,api})===true;
    return !!session&&(!credentials||session.keyRevision===credentials.revision)&&
      (state.storage?.backend==='pinecone'?session.pineconeConsent===true:true)&&
      (state.storage?.config?.mode==='integrated'||session.embeddingConsent===true);
  };
  const retrievalReadiness=session=>{
    const state=retrievalAPIFor(session).status(),backend=state.storage?.backend||'local',integrated=state.storage?.config?.mode==='integrated';
    const configured=state.retrievalConfigured===true&&!state.embeddingBlocked;
    const authorized=retrievalAuthorized(session);
    return {configured,authorized,backend,method:backend==='pinecone'?(integrated?'pinecone-integrated-cosine':'pinecone-vector-cosine'):'vector-cosine',
      blocked:!configured?'Configure the existing vector backend in Knowledge. Campaigns do not substitute lexical retrieval.':!authorized?'Allow retrieval in Knowledge settings for this browser session.':backend==='pinecone'&&!state.storage.checked?'Run Check connection in Knowledge before creating a live campaign.':null};
  };
  const connectionStatus=async session=>({...session?.apiOnly?{csrf:session.csrf}:await chatgpt.status(session),keySettings:credentials?.status()||{available:false},apiKey:{...apiFor(session).status(),pineconeConsent:session?.pineconeConsent===true,embeddingConsent:session?.embeddingConsent===true,consent:session?.apiKeyConsent===true}});
  const knowledgeBusy=new Set();
  const campaignHTTP=createCampaignHTTP({directory:campaignDirectory,service:campaignService});
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
    // Canonicalize only the dashboard document before creating browser state.
    // Do not transfer query strings, cookies, form bodies or OAuth callbacks
    // between localhost and 127.0.0.1: these are distinct browser origins.
    if (name === 'index.html' && ['GET', 'HEAD'].includes(req.method) && req.headers.host === `localhost:${server.address().port}`) {
      res.writeHead(302, {Location: `http://127.0.0.1:${server.address().port}/`}); res.end(); return;
    }
    // A native same-origin POST inherits the document policy. `no-referrer`
    // makes its Origin "null" in Chrome, correctly rejected by sameOrigin().
    // Keep an exact origin on the app form; OAuth redirects retain no-referrer.
    if (name === 'index.html') res.setHeader('Referrer-Policy', 'same-origin');
    const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('cc_session='))?.slice(11);
    let session = chatgpt.sessionFor(cookie);
    if(session&&credentials&&session.keyRevision!==credentials.revision){session.apiKeyConsent=false;session.embeddingConsent=false;session.pineconeConsent=false;session.keyRevision=credentials.revision;}

    const requestKeyRevision=credentials?.revision;
    if(await campaignHTTP({name,req,res,session,sameOrigin,csrf,readJSON:req=>readJSON(req,65536),json,
      campaignDefaults:{...CAMPAIGN_DEFAULTS,...(campaignBudgetPolicy?{capUsd:campaignBudgetPolicy.ceilingUsd,policyVersion:campaignBudgetPolicy.policyVersion}:{}),enabled:campaignDefaultsEnabled},readiness:()=>({...campaignReadiness(campaignAPIFor(session),campaignDefaultsEnabled),settingsAvailable:!campaignAPI&&(credentials?.status().available??false),retrieval:retrievalReadiness(session)}),
      generator:name.startsWith('api/campaign/') ? (run,save)=>campaignGenerationFactory({run,save,policy:campaignBudgetPolicy,api:campaignAPIFor(session),fetcher:campaignFetch,authorize:()=>campaignDefaultsEnabled&&campaignReadiness(campaignAPIFor(session)).configured&&(!!campaignAPI||!credentials||(credentials.revision===requestKeyRevision&&session.keyRevision===credentials.revision))}) : undefined,
      retrieveBrand:campaignRetrieveBrand|| (async ({query,limit,signal})=>{
        const api=retrievalAPIFor(session),revision=credentials?.revision;
        const retrieval=createCampaignRetrieval({api,session,getCorpus:loadCorpus,...(campaignIndexedCorpus?{getIndexedCorpus:campaignIndexedCorpus}:{}),storeDirectory:ragStoreDirectory,
          authorize:()=>retrievalAuthorized(session)&&(!credentials||credentials.revision===revision)});
        return retrieval.retrieveBrand({query,limit,signal});
      }),
      ensureSession:()=>{
      session ||= chatgpt.sessionFor(null,true);session.apiOnly=true;
      res.setHeader('Set-Cookie',`cc_session=${session.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
      return session;
    }})) return;



    if(name==='api/session'){
      if(req.method!=='GET'||!sameOrigin(req)){json(res,403,{error:{code:'session_unavailable',message:'Use the local application origin.'}});return;}
      session ||= chatgpt.sessionFor(null,true);session.apiOnly=true;
      res.setHeader('Set-Cookie',`cc_session=${session.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
      json(res,200,{csrf:session.csrf,keySettings:credentials?.status()||{available:false},apiKey:{...apiFor(session).status(),pineconeConsent:session.pineconeConsent===true,embeddingConsent:session.embeddingConsent===true,consent:session.apiKeyConsent===true}});return;
    }
    if(name==='api/provider/storage'||name==='api/provider/pinecone-consent'){
      try{if(!sameOrigin(req)||req.method!=='POST')throw new InferenceError(403,'invalid_request','Use a same-origin POST.');csrf(session,req.headers['x-cc-csrf']);const body=await readJSON(req);
        if(name.endsWith('pinecone-consent')){fields(body,['enabled']);if(typeof body.enabled!=='boolean')throw new InferenceError(400,'invalid_request','Use boolean permission.');if(body.enabled&&!apiFor(session).status().storage?.configured)throw new InferenceError(409,'pinecone_not_ready','Save the Pinecone key and index settings first.');session.pineconeConsent=body.enabled;}
        else{if(!credentials?.configureStorage)throw new InferenceError(503,'settings_unavailable','Storage settings unavailable.');credentials.configureStorage(body);session.apiKeyConsent=false;session.embeddingConsent=false;session.pineconeConsent=false;session.keyRevision=credentials.revision;}
        json(res,200,await connectionStatus(session));
      }catch(e){json(res,e instanceof KnowledgeError||e instanceof InferenceError||e instanceof KeyStoreError?e.status:500,{error:e instanceof KnowledgeError||e instanceof InferenceError||e instanceof KeyStoreError?{code:e.code,message:e.message}:{code:'settings_failed',message:'Storage settings could not be saved.'}});}return;
    }
    if(name==='api/provider/embedding'||name==='api/provider/embedding-consent'){
      try{if(!sameOrigin(req)||req.method!=='POST')throw new InferenceError(403,'invalid_request','Use a same-origin POST.');csrf(session,req.headers['x-cc-csrf']);const body=await readJSON(req);
        if(name.endsWith('embedding-consent')){fields(body,['enabled']);if(typeof body.enabled!=='boolean')throw new InferenceError(400,'invalid_request','Use boolean consent.');if(body.enabled&&(!apiFor(session).status().embeddingsConfigured||apiFor(session).status().embeddingBlocked))throw new InferenceError(409,'embeddings_not_ready','Save an OpenAI key and embedding model first.');session.embeddingConsent=body.enabled;}
        else{fields(body,['model','dimensions']);if(!credentials?.configureEmbedding)throw new InferenceError(503,'settings_unavailable','Embedding settings are unavailable.');credentials.configureEmbedding(body.model,body.dimensions);session.apiKeyConsent=false;session.embeddingConsent=false;session.pineconeConsent=false;session.keyRevision=credentials.revision;}
        json(res,200,await connectionStatus(session));
      }catch(e){json(res,e instanceof InferenceError||e instanceof KeyStoreError?e.status:500,{error:e instanceof InferenceError||e instanceof KeyStoreError?{code:e.code,message:e.message}:{code:'settings_failed',message:'Embedding settings could not be saved.'}});}return;
    }
    if(name==='api/provider/configure'){
      if(!sameOrigin(req)){json(res,403,{error:{code:'cross_origin',message:'Use the application origin.'}});return;}
      try{
        if(req.method!=='POST')throw new InferenceError(405,'method_not_allowed','Use POST.');
        csrf(session,req.headers['x-cc-csrf']);if(!credentials?.configure)throw new InferenceError(503,'settings_unavailable','Restart the server to use model settings.');
        const body=await readJSON(req);fields(body,Object.hasOwn(body,'maxOutputTokens')?['provider','enabled','model','maxOutputTokens']:['provider','enabled','model']);credentials.configure(body.provider,body.enabled,body.model,body.maxOutputTokens);session.apiKeyConsent=false;session.embeddingConsent=false;session.pineconeConsent=false;session.keyRevision=credentials.revision;
        json(res,200,await connectionStatus(session));
      }catch(e){json(res,e instanceof InferenceError||e instanceof KeyStoreError?e.status:500,{error:e instanceof InferenceError||e instanceof KeyStoreError?{code:e.code,message:e.message}:{code:'settings_failed',message:'Model settings could not be applied.'}});}
      return;
    }
    if(name==='api/provider/key'){
      if(!sameOrigin(req)){json(res,403,{error:{code:'cross_origin',message:'Use the application origin.'}});return;}
      try{
        if(req.method!=='POST')throw new InferenceError(405,'method_not_allowed','Use POST.');
        csrf(session,req.headers['x-cc-csrf']);
        if(!credentials)throw new InferenceError(503,'settings_unavailable','Local key settings are unavailable.');
        const body=await readJSON(req);fields(body,['provider','key','replace']);
        await credentials.save(body.provider,body.key,body.replace);body.key='';
        session.apiKeyConsent=false;session.embeddingConsent=false;session.pineconeConsent=false;session.keyRevision=credentials.revision;
        json(res,200,await connectionStatus(session));
      }catch(e){json(res,e instanceof InferenceError||e instanceof KeyStoreError?e.status:500,{error:e instanceof InferenceError||e instanceof KeyStoreError?{code:e.code,message:e.message}:{code:'save_failed',message:'Local key save failed.'}});}
      return;
    }

    if(name==='api/provider/status'||name==='api/provider/consent'||name==='api/provider/select'){
      if(!sameOrigin(req)){json(res,403,{error:{code:'cross_origin',message:'Use the application origin.'}});return;}
      try{
        if(name==='api/provider/status'&&req.method==='GET'){json(res,200,{...apiFor(session).status(),pineconeConsent:session?.pineconeConsent===true,embeddingConsent:session?.embeddingConsent===true,consent:session?.apiKeyConsent===true});return;}
        if(name==='api/provider/select'&&req.method==='POST'){
          const body=await readJSON(req);fields(body,['provider']);csrf(session,req.headers['x-cc-csrf']);
          if(!(credentials?.providers||apiKey).select||!['','openai','anthropic'].includes(body.provider))throw new InferenceError(400,'invalid_provider','Choose a supported API provider.');
          credentials?.select?.(body.provider);(credentials?.providers||apiKey).select(session,body.provider);json(res,200,await connectionStatus(session));return;
        }
        if(name!=='api/provider/consent'||req.method!=='POST')throw new InferenceError(405,'method_not_allowed','Use the supported provider action.');
        const body=await readJSON(req);fields(body,['enabled']);csrf(session,req.headers['x-cc-csrf']);
        if(typeof body.enabled!=='boolean')throw new InferenceError(400,'invalid_request','Use a boolean consent value.');
        if(body.enabled&&(!apiFor(session).status().generationConfigured||apiFor(session).status().blocked))throw new InferenceError(409,'api_not_ready','Configure API generation and review any provider block before enabling requests.');
        session.apiKeyConsent=body.enabled;
        json(res,200,await connectionStatus(session));
      }catch(e){json(res,(e instanceof InferenceError||e instanceof KeyStoreError)?e.status:500,{error:(e instanceof InferenceError||e instanceof KeyStoreError)?{code:e.code,message:e.message}:{code:'provider_unavailable',message:'Local provider settings are unavailable.'}});}
      return;
    }

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
          json(res, 200, await connectionStatus(session)); return;
        }
        if (!session) throw new InferenceError(401, 'session_required', 'Refresh the app before connecting.');
        if (name === 'auth/start' && req.method === 'POST') {
          if (!req.headers.host.startsWith('127.0.0.1:')) throw new InferenceError(400, 'loopback_required', `Open http://127.0.0.1:${server.address().port}/ and start a new sign-in there. A form already opened at localhost cannot be reused.`);
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
        json(res, 200, await connectionStatus(session));
      } catch (error) { json(res, error instanceof InferenceError || error instanceof ChatGPTError ? error.status : 500, {error: publicError(error)}); }
      return;
    }


    if (name.startsWith('api/knowledge/')) {
      const requestAPI=apiFor(session);const requestRag=rag||createRagService({...ragOptions(requestAPI),getCorpus:loadCorpus,...(ragStoreDirectory?{storeDirectory:ragStoreDirectory}:{})});
      if (!sameOrigin(req)) { json(res,403,{error:{code:'cross_origin',message:'Use the application origin.'}}); return; }
      if(req.method!=='POST'){res.setHeader('Allow','POST');json(res,405,{error:{code:'method_not_allowed',message:'Use POST.'}});return;}
      let ownsBusy=false;const controller=new AbortController();
      const cancel=()=>{if(!res.writableEnded)controller.abort();};
      req.once('aborted',cancel);res.once('close',cancel);
      try {
        const body=await readJSON(req);
        const contracts={'api/knowledge/manifest':[],'api/knowledge/source':['sourceId','corpusVersion'],'api/knowledge/ask':['question','corpusVersion'],'api/knowledge/rag':['question','corpusVersion','topK','sourceIds'],'api/knowledge/compare':['question','corpusVersion','topK','sourceIds'],'api/knowledge/pinecone-check':['corpusVersion'],'api/knowledge/index':['corpusVersion'],'api/knowledge/evaluate':['corpusVersion']};
        if(!Object.hasOwn(contracts,name))throw new KnowledgeError(404,'not_found','Unknown Knowledge action.');
        exactFields(body,[...contracts[name],...(['api/knowledge/rag','api/knowledge/compare'].includes(name)&&Object.hasOwn(body,'conversation')?['conversation']:[])]);
        // Read-only local corpus operations do not use account credentials or invoke providers.
        const corpus=await loadCorpus();
        if(controller.signal.aborted)return;
        if(name!=='api/knowledge/manifest' && body.corpusVersion!==corpus.corpusVersion)throw new KnowledgeError(409,'stale_corpus','Refresh Knowledge before continuing.');
        let result;
        if((name==='api/knowledge/rag'&&requestRag.usesProviders)||['api/knowledge/pinecone-check','api/knowledge/compare','api/knowledge/index','api/knowledge/evaluate'].includes(name)){
          csrf(session,req.headers['x-cc-csrf']);if(knowledgeBusy.has(session.id))throw new KnowledgeError(409,'knowledge_busy','A Knowledge operation is already running. Cancel or wait before retrying.');knowledgeBusy.add(session.id);ownsBusy=true;
        }
        if(name==='api/knowledge/pinecone-check'){result=await requestRag.checkConnection(corpus,{signal:controller.signal});}
        else if(name==='api/knowledge/index'){
          const state=apiFor(session).status();if(state.storage?.backend==='pinecone'&&!session.pineconeConsent)throw new KnowledgeError(403,'pinecone_consent_required','Explicitly allow Pinecone uploads and search charges first.');if(state.storage?.config?.mode!=='integrated'&&(!session.embeddingConsent||!state.embeddingsConfigured||state.embeddingBlocked))throw new KnowledgeError(403,'embedding_consent_required','Configure embeddings and explicitly allow embedding charges first.');
          result=await requestRag.buildIndex({signal:controller.signal});
        }else if(name==='api/knowledge/evaluate'){
          await requestRag.authorize({session,signal:controller.signal});if(!requestRag.usesProviders)throw new KnowledgeError(409,'not_configured','Configure both providers before live evaluation.');
          const fixtures=JSON.parse(await readFile(path.join(root,'eval/knowledge-questions.json'),'utf8'));result=await evaluateComparisons(corpus,fixtures,{service:requestRag,allowProviderCalls:true,signal:controller.signal});
        }else if(name==='api/knowledge/rag'||name==='api/knowledge/compare'){
          // Local-session CSRF is separate from provider entitlement; both gates apply.
          if(requestRag.usesProviders){csrf(session,req.headers['x-cc-csrf']);
            // The narrow standalone clarification branch returns before any provider work.
            // It does not grant consent; specific/source-scoped questions and comparison stay gated.
            const localOnly=name==='api/knowledge/rag'&&typeof body.question==='string'&&Array.isArray(body.sourceIds)&&resolveConversation(corpus,body).clarification!==null;
            if(!localOnly)await requestRag.authorize({session,signal:controller.signal});
          }
          if(controller.signal.aborted)return;
          result=await requestRag[name.endsWith('/compare')?'compare':'ask'](corpus,body,{signal:controller.signal});result.maxOutputTokens=requestAPI.status().maxOutputTokens??null;
        }else result=name==='api/knowledge/manifest'?{...manifest(corpus),rag:{...requestRag.status(),pineconeKeyStatus:credentials?.status().pinecone||'not_configured',index:await requestRag.readiness(corpus),pineconeConsent:session?.pineconeConsent===true,embeddingConsent:session?.embeddingConsent===true,generationConsent:session?.apiKeyConsent===true,generationOutputTokens:apiFor(session).status().maxOutputTokens??null}}:name==='api/knowledge/source'?source(corpus,body.sourceId):askKnowledge(corpus,body);
        if((await loadCorpus()).corpusVersion!==corpus.corpusVersion)throw new KnowledgeError(409,'stale_corpus','Sources changed during the request. Refresh Knowledge.');
        if(!controller.signal.aborted)json(res,200,result);
      }catch(error){if(!controller.signal.aborted)json(res,error instanceof KnowledgeError||error instanceof InferenceError?error.status:500,{error:error instanceof KnowledgeError||error instanceof InferenceError?{code:error.code,message:error.message,diagnostics:publicValidationDiagnostics(error)}:{code:'knowledge_unavailable',message:'Knowledge is unavailable. Check local ingestion.'}});}
      finally{if(ownsBusy)knowledgeBusy.delete(session.id);req.off('aborted',cancel);res.off('close',cancel);}
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
        const connected = !session?.apiOnly&&chatgpt.connected(session);
        const selectedAPI=apiFor(session);
        const useApiKey=session?.apiKeyConsent===true&&selectedAPI.status().generationConfigured;
        if (connected||useApiKey) csrf(session, req.headers['x-cc-csrf']);
        const currentInvoke = invoke || (useApiKey ? (request,options)=>selectedAPI.invokeMetric(request,options) : connected ? (request, options) => chatgpt.invoke(session, request, options) : undefined);
        if (name === 'api/snapshot') { json(res, 200, {...snapshotIdentity(snap), mode: currentInvoke ? 'adapter_configured' : 'demo'}); return; }
        if (body.snapshotId !== snap.snapshotId || body.contextId !== snap.id) {
          throw new InferenceError(409, 'stale_snapshot', 'Refresh the dataset and filter snapshot before asking again.');
        }
        const result = await runInference({invoke: currentInvoke, timeoutMs, question: body.question, snap, signal: controller.signal});
        if(useApiKey&&!invoke){result.provider=selectedAPI.status().provider==='anthropic'?'anthropic_api_key':'openai_api_key';if(result.mode==='fallback')result.notice='Selected API output was unavailable or rejected; no switch to another provider occurred.';}
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
  server.on('close',()=>campaignHTTP.close());
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const credentials=await createKeyStore({filename:path.join(root,'key.json'),environment:process.env});
  const campaignAPI=await loadCampaignStartup(root);
  createServer({credentials,campaignAPI}).listen(port, '127.0.0.1', () => console.log(`Campaign Compass: http://127.0.0.1:${port} (loopback only; campaign calls require user action and persisted budget)`));
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnthropicKeyService} from '../server/anthropic-api-key.mjs';
import {createAPIProviders} from '../server/api-providers.mjs';
import {validateGroundedAnswer,createRagService} from '../server/rag.mjs';
import {buildCorpus} from '../server/knowledge.mjs';
import {ragOptions} from '../server/rag-config.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const KEY='anthropic-fixture-not-a-real-credential',OTHER='openai-fixture-not-a-real-credential';
const env=(extra={})=>({CAMPAIGN_ANTHROPIC_ENABLED:'1',CAMPAIGN_ANTHROPIC_API_KEY:KEY,CAMPAIGN_ANTHROPIC_GENERATION_MODEL:'claude-sonnet-4-6',...extra});
const body=answer=>({type:'message',role:'assistant',model:'claude-sonnet-4-6',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(answer)}]});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const req={system:'Only evidence.',input:'test',maxOutputCharacters:16000};
const answer={corpusVersion:'v1',status:'answered',message:'',claims:[{text:'The bottle holds 650 milliliters.',citations:[{chunkId:'c1',quote:'The bottle holds 650 milliliters.'}]}]};

test('Claude disabled/absent keys fail closed, no native embeddings or startup calls',()=>{
 const disabled=createAnthropicKeyService({environment:{CAMPAIGN_ANTHROPIC_ENABLED:'0',get CAMPAIGN_ANTHROPIC_API_KEY(){throw Error('must not read');}},fetcher:()=>{throw Error('no calls');}});
 assert.equal(disabled.status().keyStatus,'not_read_disabled');assert.equal(disabled.generation,null);
 for(const key of ['',undefined])assert.equal(createAnthropicKeyService({environment:env({CAMPAIGN_ANTHROPIC_API_KEY:key})}).generation,null);
 const configured=createAnthropicKeyService({environment:env()});assert.equal(configured.embedding,null);assert.equal(configured.status().embeddingsConfigured,false);assert.equal(JSON.stringify(configured.status()).includes(KEY),false);
});
test('Messages uses isolated key, fixed endpoint, version, native schema and validated application citations',async()=>{
 const service=createAnthropicKeyService({environment:env({CAMPAIGN_GENERATION_BASE_URL:'https://evil.invalid'}),fetcher:async(url,options)=>{
  assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(options.headers['x-api-key'],KEY);assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers['anthropic-version'],'2023-06-01');assert.equal(options.redirect,'error');
  const b=JSON.parse(options.body);assert.equal(b.model,'claude-sonnet-4-6');assert.equal(b.system,req.system);assert.deepEqual(b.messages,[{role:'user',content:req.input}]);assert.equal(b.output_config.format.type,'json_schema');assert.equal(b.output_config.format.schema.additionalProperties,false);assert.equal(b.max_tokens,2048);assert.equal(b.stream,false);assert.equal(b.tools,undefined);assert.equal(b.store,undefined);assert.equal(b.text,undefined);return json(body(answer));
 }});
 const result=await service.generation.generate(req),contract={corpusVersion:'v1',matches:[{chunkId:'c1',text:'The bottle holds 650 milliliters.'}]};assert.deepEqual(validateGroundedAnswer(result,contract),answer);
 assert.throws(()=>validateGroundedAnswer({...result,claims:[{...result.claims[0],citations:[{chunkId:'invented',quote:'The bottle holds 650 milliliters.'}]}]},contract),{code:'invalid_answer'});
});
test('Claude incomplete/refusal/tool blocks, malformed JSON and reflected keys are rejected',async()=>{
 const cases=[{...body(answer),stop_reason:'max_tokens'},{...body(answer),stop_reason:'refusal'},{...body(answer),content:[{type:'tool_use'}]},body(KEY),{...body(answer),content:[{type:'text',text:'bad json'}]},body({key:KEY})];
 for(const value of cases){const service=createAnthropicKeyService({environment:env(),fetcher:async()=>json(value)});await assert.rejects(service.generation.generate(req),e=>!e.message.includes(KEY)&&['api_refusal','api_invalid_response','api_output_limit','api_json_invalid'].includes(e.code));}
});
test('Claude authentication/permission/limit blocks are sanitized and never retried',async()=>{
 for(const status of [401,403,429]){let calls=0;const s=createAnthropicKeyService({environment:env(),fetcher:async()=>{calls++;return json({error:KEY},status);}});await assert.rejects(s.generation.generate(req),e=>!String(e.stack).includes(KEY));await assert.rejects(s.generation.generate(req));assert.equal(calls,1);assert.ok(s.status().blocked);}
});
test('Claude network errors, redirects and response limits cannot expose secrets',async()=>{
 for(const fetcher of [async()=>{throw Error(KEY);},async()=>new Response(null,{status:302,headers:{Location:'https://evil.invalid'}}),async()=>new Response(KEY,{headers:{'Content-Type':'text/html'}}),async()=>json(body('x'.repeat(1000001)))]){const s=createAnthropicKeyService({environment:env(),fetcher});await assert.rejects(s.generation.generate(req),e=>!String(e.stack).includes(KEY));}
});
test('Claude forwards cancellation and enforces a hard deadline',async()=>{
 const c=new AbortController();let observed;const s=createAnthropicKeyService({environment:env(),fetcher:async(_,{signal})=>{observed=signal;c.abort();throw Error(KEY);}});await assert.rejects(s.generation.generate(req,{signal:c.signal}),{code:'api_cancelled'});assert.equal(observed.aborted,true);
 const timeout=createAnthropicKeyService({environment:env(),timeoutMs:20,fetcher:()=>new Promise(()=>{})});await assert.rejects(timeout.generation.generate(req),{code:'api_timeout'});
});
test('provider switching is explicit, session-local and resets consent; embeddings require independent selection',async()=>{
 const calls=[],environment=env({CAMPAIGN_OPENAI_ENABLED:'1',CAMPAIGN_OPENAI_API_KEY:OTHER,CAMPAIGN_OPENAI_GENERATION_MODEL:'gpt-6-astra',CAMPAIGN_OPENAI_EMBEDDING_MODEL:'text-embedding-3-small',CAMPAIGN_OPENAI_EMBEDDING_DIMENSIONS:'3'});
 const providers=createAPIProviders({environment,fetcher:async(url,o)=>{calls.push(url);if(url.includes('anthropic')){assert.equal(o.headers['x-api-key'],KEY);assert.equal(JSON.stringify(o).includes(OTHER),false);return json(body(answer));}assert.equal(o.headers.Authorization,'Bearer '+OTHER);assert.equal(JSON.stringify(o).includes(KEY),false);return json({status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(answer)}]}]});}});
 assert.equal(providers.status().generationConfigured,false);assert.equal(providers.embedding,null);assert.equal(calls.length,0);
 const session={apiKeyConsent:true};providers.select(session,'anthropic');assert.equal(session.apiKeyConsent,false);await providers.forSession(session).generation.generate(req);assert.equal(providers.status().generationConfigured,false);
 session.apiKeyConsent=true;providers.select(session,'openai');assert.equal(session.apiKeyConsent,false);await providers.forSession(session).generation.generate(req);assert.equal(calls.length,2);assert.throws(()=>providers.select(session,'custom'),{code:'invalid_provider'});
 const rag=createAPIProviders({environment:{...environment,CAMPAIGN_GENERATION_PROVIDER:'anthropic',CAMPAIGN_OPENAI_GENERATION_MODEL:'',CAMPAIGN_EMBEDDING_PROVIDER:'openai'}});assert.equal(rag.generation.spec.provider,'anthropic-api-key');assert.equal(rag.embedding.spec.provider,'openai-api-key');
 const blank=createAPIProviders({environment:env({CAMPAIGN_GENERATION_PROVIDER:'anthropic',CAMPAIGN_ANTHROPIC_API_KEY:''})});assert.equal(blank.generation,null);assert.equal(blank.embedding,null);
});
test('Claude RAG runs mocked embedding/retrieval/JSON citations together and rejects fabricated quotes',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'claude-rag-fixture-'));t.after(()=>rm(directory,{recursive:true,force:true}));const corpus=buildCorpus([{name:'bottle.md',text:'# Bottle\nThe bottle holds 650 milliliters.'}]);let bad=false;const calls=[];
 const providers=createAPIProviders({environment:env({CAMPAIGN_GENERATION_PROVIDER:'anthropic',CAMPAIGN_EMBEDDING_PROVIDER:'openai',CAMPAIGN_OPENAI_ENABLED:'1',CAMPAIGN_OPENAI_API_KEY:OTHER,CAMPAIGN_OPENAI_EMBEDDING_MODEL:'text-embedding-3-small',CAMPAIGN_OPENAI_EMBEDDING_DIMENSIONS:'3'}),fetcher:async(url,o)=>{calls.push(url);const b=JSON.parse(o.body);if(url.endsWith('/embeddings')){assert.equal(o.headers.Authorization,'Bearer '+OTHER);return json({model:b.model,data:b.input.map((_,index)=>({object:'embedding',index,embedding:[1,0,0]}))});}assert.equal(o.headers['x-api-key'],KEY);const data=JSON.parse(b.messages[0].content),e=data.evidence[0];return json(body({corpusVersion:data.corpusVersion,status:'answered',message:'',claims:[{text:e.text,citations:[{chunkId:e.chunkId,quote:bad?'fabricated quote not in sources':e.text}]}]}));}});
 const rag=createRagService({...ragOptions(providers),storeDirectory:directory,getCorpus:async()=>corpus});await rag.buildIndex();const q={question:'bottle capacity',corpusVersion:corpus.corpusVersion,topK:5,sourceIds:[]};await rag.authorize({session:{apiKeyConsent:true,embeddingConsent:true}});assert.equal((await rag.ask(corpus,q)).status,'answered');assert.equal(calls.length,3);bad=true;await assert.rejects(rag.ask(corpus,q),{code:'invalid_answer'});
});

test('Claude thinking blocks are ignored while final structured text is validated',async()=>{
 const payload=body(answer);payload.content.unshift({type:'thinking',thinking:'PRIVATE TEST REASONING',signature:'test'},{type:'redacted_thinking',data:'opaque'});
 const service=createAnthropicKeyService({environment:env(),fetcher:async()=>json(payload)});
 assert.deepEqual(await service.generation.generate(req),answer);assert.equal(JSON.stringify(service.status()).includes('PRIVATE TEST'),false);
});
test('Claude failure diagnostics retain only fixed messages and numeric HTTP status',async()=>{
 for(const [status,code] of [[400,'api_request_invalid'],[404,'api_model_unavailable'],[529,'api_overloaded']]){
  const service=createAnthropicKeyService({environment:env(),fetcher:async()=>json({error:{type:KEY,message:KEY},request_id:KEY},status)});
  await assert.rejects(service.generation.generate(req),e=>e.code===code&&e.diagnostic.httpStatus===status&&!JSON.stringify(e).includes(KEY));
  assert.deepEqual(Object.keys(service.status().lastIssue).sort(),['code','httpStatus','message']);assert.equal(JSON.stringify(service.status()).includes(KEY),false);
 }
});

test('Claude diagnostics omit unsafe request IDs and distinguish connection failures',async()=>{
 for(const id of [KEY,'not-a-request-id','req_bad value']){
  const service=createAnthropicKeyService({environment:env(),fetcher:async()=>new Response('{}',{status:400,headers:{'request-id':id}})});
  await assert.rejects(service.generation.generate(req));assert.equal(service.status().lastIssue.requestId,undefined);
 }
 const service=createAnthropicKeyService({environment:env(),fetcher:async()=>{throw Error(KEY);}});
 await assert.rejects(service.generation.generate(req),{code:'api_network'});assert.equal(JSON.stringify(service.status()).includes(KEY),false);assert.equal(service.status().lastIssue.httpStatus,undefined);
});

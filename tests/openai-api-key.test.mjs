import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAIKeyService} from '../server/openai-api-key.mjs';
import {ragOptions} from '../server/rag-config.mjs';
const TEST_KEY='unit-test-not-a-real-credential';
const env=(changes={})=>({CAMPAIGN_OPENAI_ENABLED:'1',CAMPAIGN_OPENAI_API_KEY:TEST_KEY,CAMPAIGN_OPENAI_GENERATION_MODEL:'gpt-6-astra',CAMPAIGN_OPENAI_EMBEDDING_MODEL:'text-embedding-3-small',CAMPAIGN_OPENAI_EMBEDDING_DIMENSIONS:'3',...changes});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const completion=(answer,overrides={})=>({status:'completed',error:null,output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(answer)}]}],...overrides});
const request={system:'Return JSON.',input:'{"question":"test"}',maxOutputCharacters:16000};
test('disabled service does not read a key; independent configuration returns no secret or automatic calls',()=>{
 const environment={CAMPAIGN_OPENAI_ENABLED:'0',get CAMPAIGN_OPENAI_API_KEY(){throw Error('must not read');}};const disabled=createOpenAIKeyService({environment,fetcher:()=>{throw Error('must not call');}});assert.equal(disabled.status().keyStatus,'not_read_disabled');assert.equal(disabled.generation,null);
 const missing=createOpenAIKeyService({environment:env({CAMPAIGN_OPENAI_API_KEY:''})});assert.equal(missing.status().keyPresent,false);assert.equal(missing.embedding,null);
 const generationOnly=createOpenAIKeyService({environment:env({CAMPAIGN_OPENAI_EMBEDDING_MODEL:''})});assert.equal(generationOnly.status().generationConfigured,true);assert.equal(generationOnly.status().embeddingsConfigured,false);
 const embeddingOnly=createOpenAIKeyService({environment:env({CAMPAIGN_OPENAI_GENERATION_MODEL:''})});assert.equal(embeddingOnly.status().generationConfigured,false);assert.equal(embeddingOnly.status().embeddingsConfigured,true);
 assert.equal(JSON.stringify(generationOnly).includes(TEST_KEY),false);assert.equal(JSON.stringify(generationOnly.status()).includes(TEST_KEY),false);
 const options=ragOptions(generationOnly);assert.equal(options.config.enabled,true);assert.equal(options.embedding,null);
});
test('embedding HTTP request uses pinned origin, bearer server key, float vectors and restores index order',async()=>{
 let calls=0;const service=createOpenAIKeyService({environment:env(),fetcher:async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/embeddings');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,`Bearer ${TEST_KEY}`);assert.deepEqual(JSON.parse(options.body),{model:'text-embedding-3-small',input:['one','two'],dimensions:3,encoding_format:'float'});return json({model:'text-embedding-3-small',data:[{object:'embedding',index:1,embedding:[0,1,0]},{object:'embedding',index:0,embedding:[1,0,0]}]});}});
 const result=await service.embedding.embed(['one','two']);assert.deepEqual(result.vectors,[[1,0,0],[0,1,0]]);assert.equal(result.revision,'embeddings-http-contract-v1');assert.equal(calls,1);
});
test('embedding transport rejects duplicate indexes, model mismatch, dimensions and oversized input',async()=>{
 for(const data of [{model:'wrong',data:[]},{model:'text-embedding-3-small',data:[{object:'embedding',index:0,embedding:[1,0]}]},{model:'text-embedding-3-small',data:[{object:'embedding',index:2,embedding:[1,0,0]}]}]){const service=createOpenAIKeyService({environment:env(),fetcher:async()=>json(data)});await assert.rejects(service.embedding.embed(['test']),{code:'api_invalid_response'});}
 let calls=0;const service=createOpenAIKeyService({environment:env(),fetcher:()=>{calls++;}});await assert.rejects(service.embedding.embed(['x'.repeat(8001)]),{code:'api_input_size'});assert.equal(calls,0);
});
test('Responses transport uses strict JSON schema, bounded output, no storage or tools, and complete messages only',async()=>{
 const service=createOpenAIKeyService({environment:env(),fetcher:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');const b=JSON.parse(options.body);assert.equal(b.model,'gpt-6-astra');assert.equal(b.instructions,request.system);assert.equal(b.text.format.type,'json_schema');assert.equal(b.text.format.strict,true);assert.equal(b.text.format.schema.additionalProperties,false);assert.equal(b.store,false);assert.equal(b.stream,false);assert.equal(b.max_output_tokens,2048);assert.equal(b.tools,undefined);return json(completion({result:'mock only'}));}});assert.deepEqual(await service.generation.generate(request),{result:'mock only'});
});
test('Responses rejects incomplete, refusal, malformed and reflected-secret outputs without echoes',async()=>{
 const cases=[completion({}, {status:'incomplete'}),completion({}, {output:[{type:'message',role:'assistant',status:'completed',content:[{type:'refusal',refusal:'test only'}]}]}),completion(TEST_KEY),completion({}, {output:[]})];
 for(const body of cases){const service=createOpenAIKeyService({environment:env(),fetcher:async()=>json(body)});await assert.rejects(service.generation.generate(request),e=>!e.message.includes(TEST_KEY)&&['api_invalid_response','api_refusal'].includes(e.code));}
});
test('HTTP authentication, permission and rate-limit errors are sanitized, paused and never retried',async()=>{
 for(const status of [401,403,429]){let calls=0;const service=createOpenAIKeyService({environment:env(),fetcher:async()=>{calls++;return json({error:{message:TEST_KEY}},status);}});await assert.rejects(service.generation.generate(request),e=>!e.message.includes(TEST_KEY));assert.ok(service.status().blocked);await assert.rejects(service.generation.generate(request));assert.equal(calls,1);assert.equal(JSON.stringify(service.status()).includes(TEST_KEY),false);}
});
test('network/HTML/redirect errors never expose response or exception text',async()=>{
 for(const fetcher of [async()=>{throw Error(TEST_KEY);},async()=>new Response(TEST_KEY,{headers:{'Content-Type':'text/html'}}),async()=>new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/'}})]){const service=createOpenAIKeyService({environment:env(),fetcher});await assert.rejects(service.generation.generate(request),e=>!String(e.stack).includes(TEST_KEY));}
});
test('cancellation and a hard deadline reach transport without retries or secret errors',async()=>{
 const controller=new AbortController();let observed;const service=createOpenAIKeyService({environment:env(),fetcher:async(_,{signal})=>{observed=signal;controller.abort();throw Error(TEST_KEY);}});await assert.rejects(service.generation.generate(request,{signal:controller.signal}),{code:'api_cancelled'});assert.equal(observed.aborted,true);
 const timeout=createOpenAIKeyService({environment:env(),timeoutMs:30,fetcher:()=>new Promise(()=>{})});await assert.rejects(timeout.generation.generate(request),{code:'api_timeout'});
});
test('API-key metric adapter preserves immutable numeric evidence request and schema',async()=>{
 const metric={system:'metric prompt',question:'brief',contextId:'ctx',snapshotId:'snap',facts:{'total.spend':{value:1}}};
 const service=createOpenAIKeyService({environment:env(),fetcher:async(_,options)=>{const b=JSON.parse(options.body);assert.deepEqual(JSON.parse(b.input[0].content),{question:'brief',contextId:'ctx',snapshotId:'snap',facts:metric.facts});assert.equal(b.text.format.name,'campaign_metrics');return json(completion({contextId:'ctx',snapshotId:'snap',intent:'overview',claims:[{metricId:'total.spend',value:1}],recommendationId:'review_measurement'}));}});assert.equal((await service.invokeMetric(metric)).claims[0].value,1);
});

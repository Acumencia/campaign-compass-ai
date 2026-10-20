import {createHash,randomUUID} from 'node:crypto';
import {readFile,lstat,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {KnowledgeError,exactFields} from './knowledge.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=(code,message,status=409)=>new KnowledgeError(status,code,message);
const hostPattern=/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.svc\.(?:[a-z0-9-]+\.)*pinecone\.io$/;
export function validatePineconeConfig(value){
 exactFields(value,['backend','mode','indexName','host','namespacePrefix','model','dimensions','metric','field']);
 if(!['local','pinecone'].includes(value.backend))throw fail('pinecone_configuration','Choose local or Pinecone storage.',400);
 if(value.backend==='local')return {backend:'local'};
 if(!['integrated','external'].includes(value.mode)||typeof value.host!=='string'||!hostPattern.test(value.host)||value.host.includes('.private.')||typeof value.indexName!=='string'||!/^[a-z0-9](?:[a-z0-9-]{0,43}[a-z0-9])?$/.test(value.indexName)||typeof value.namespacePrefix!=='string'||!/^[a-z][a-z0-9-]{0,19}$/.test(value.namespacePrefix)||typeof value.model!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value.model)||!Number.isInteger(value.dimensions)||value.dimensions<1||value.dimensions>4096||value.metric!=='cosine'||typeof value.field!=='string'||!/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(value.field)||value.field.startsWith('cc_'))throw fail('pinecone_configuration','Use an existing public Pinecone host/name, a namespace prefix, exact model/dimensions, cosine metric and a nonreserved field name.',400);
 return {...value};
}
export function createPineconeStore({config,key='',fetcher=globalThis.fetch,timeoutMs=30000}={}){
 const c=validatePineconeConfig(config);let checked=null,busy=false;
 const keyPresent=typeof key==='string'&&key.length>=20&&key.length<=512&&!/\s|[^\x21-\x7e]/.test(key);
 if(keyPresent&&Object.values(c).some(v=>typeof v==='string'&&v.includes(key)))throw fail('pinecone_configuration','A secret cannot be used as index configuration.',400);
 const fingerprint=hash(c),receiptPath=directory=>path.join(directory,`pinecone-${fingerprint}.json`);
 const status=()=>({backend:'pinecone',configured:c.backend==='pinecone'&&keyPresent,keyPresent,config:c,checked:!!checked,apiFamily:checked?.family||null});
 const spec={provider:'pinecone-integrated',model:c.model,revision:'pinecone-2026-07',dimensions:c.dimensions};
 const abort=signal=>{if(signal?.aborted)throw fail('cancelled','Pinecone operation cancelled. Partial uploads may remain.',499);};
 async function exclusive(work){if(busy)throw fail('pinecone_busy','A Pinecone operation is already running. Wait or cancel it.');busy=true;try{return await work();}finally{busy=false;}}
 async function request(url,{method='POST',body,ndjson=false,signal,empty=false}={}){
  abort(signal);if(!keyPresent)throw fail('pinecone_key_required','Save your Pinecone API key locally first.',403);
  const controller=new AbortController(),onAbort=()=>controller.abort();signal?.addEventListener('abort',onAbort,{once:true});let timed=false;const timer=setTimeout(()=>{timed=true;controller.abort();},timeoutMs);
  try{
   let response;try{response=await fetcher(url,{method,headers:{'Api-Key':key,'X-Pinecone-Api-Version':'2026-07',...(body===undefined?{}:{'Content-Type':ndjson?'application/x-ndjson':'application/json'})},...(body===undefined?{}:{body:ndjson?body:JSON.stringify(body)}),signal:controller.signal,redirect:'error'});}catch{abort(signal);throw fail(timed?'pinecone_timeout':'pinecone_network',timed?'Pinecone timed out. No automatic retry was made.':'Pinecone connection failed. No automatic retry was made.',502);}
   if(response.redirected||response.status>=300&&response.status<400)throw fail('pinecone_redirect','Pinecone redirects are not followed.',502);
   if(!response.ok){await response.body?.cancel().catch(()=>{});const issue={401:['pinecone_auth','Pinecone rejected authentication (HTTP 401). Verify the complete Pinecone API key saved in this app and its project; generation-provider keys cannot authenticate Pinecone.'],403:['pinecone_permission','Pinecone denied access (HTTP 403). Review this key\'s permissions for the requested index/project.'],404:['pinecone_not_found','Pinecone returned HTTP 404. Verify the existing index name, host and project.'],402:['pinecone_billing','Pinecone returned HTTP 402. Review billing or quota requirements in your Pinecone account.'],429:['pinecone_rate_limit','Pinecone returned HTTP 429. A rate or resource limit was reached.']}[response.status]||['pinecone_http',`Pinecone returned HTTP ${response.status}. The request did not complete.`];throw fail(issue[0],issue[1]+' No automatic retry was made.',502);}
   const reader=response.body?.getReader();let text='',bytes=0;const decoder=new TextDecoder();
   if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2000000){await reader.cancel();throw fail('pinecone_response','Pinecone response exceeded its bound.',502);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
   abort(signal);if(timed)throw fail('pinecone_timeout','Pinecone timed out.',504);if(text.includes(key))throw fail('pinecone_response','Pinecone returned an unsafe response.',502);
   if(empty&&!text.trim())return {};if(!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw fail('pinecone_response','Pinecone returned an unsupported response.',502);
   try{const data=JSON.parse(text);if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch{throw fail('pinecone_response','Pinecone returned invalid JSON.',502);}
  }catch(e){if(e instanceof KnowledgeError)throw e;abort(signal);throw fail(timed?'pinecone_timeout':'pinecone_response','Pinecone response was unavailable. No automatic retry was made.',502);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);controller.abort();}
 }
 const endpoint=p=>`https://${c.host}${p}`;
 async function readReceipt(directory,corpus){
  let result;try{const file=receiptPath(directory),stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>100000)throw Error();result=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw fail('pinecone_receipt','The local Pinecone receipt is invalid. No remote write was made.');}
  if(result.configHash!==fingerprint||result.corpusVersion!==corpus.corpusVersion||typeof result.namespace!=='string'||!new RegExp('^'+c.namespacePrefix+'-cc-[a-f0-9]{16}-[a-f0-9]{12}$').test(result.namespace)||result.expectedChunks!==corpus.chunks.length||typeof result.complete!=='boolean'||typeof result.visible!=='boolean')throw fail('pinecone_stale','The Pinecone upload does not match this corpus/configuration. Upload a new isolated namespace.');
  return result;
 }
 async function saveReceipt(directory,value){await mkdir(directory,{recursive:true});const file=receiptPath(directory),tmp=file+'.'+randomUUID()+'.tmp';try{try{const st=await lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw Error();}catch(e){if(e.code!=='ENOENT')throw e;}await writeFile(tmp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});await rename(tmp,file);}catch{throw fail('pinecone_receipt','Could not save the local upload receipt. Remote uploads may exist; inspect the displayed namespace.');}finally{await rm(tmp,{force:true}).catch(()=>{});}}
 function compatibility(data,embedding){
  if(data.name!==c.indexName||data.host!==c.host||data.status?.ready!==true)throw fail('pinecone_index_mismatch','Index name/host mismatch or index is not ready. No upload was made.');
  let family,dimension,metric,model,field;
  const fields=data.schema?.fields;
  if(c.mode==='integrated'){
   if(data.embed){family='records';dimension=data.dimension;metric=data.metric;model=data.embed.model;field=data.embed.field_map?.text;}
   else if(fields?.[c.field]?.type==='semantic_text'){family='records';const e=fields[c.field].embed||fields[c.field];dimension=e.dimension;metric=e.metric;model=e.model;field=c.field;}
   else if(fields?.[c.field]?.type==='string'&&fields[c.field].embed){throw fail('pinecone_index_type','This is a newer document-integrated index. This adapter supports legacy integrated records and external dense vectors; no upload was made.');}
   else throw fail('pinecone_index_type','The selected field is not a supported integrated dense embedding index.');
   if(model!==c.model||field!==c.field)throw fail('pinecone_embedding_mismatch','Integrated model or text field mapping differs from your configuration.');
  }else{
   if(data.embed||fields?.[c.field]?.embed)throw fail('pinecone_index_type','This index field uses integrated embeddings. Choose integrated mode.');
   if(fields){const v=fields[c.field];if(v?.type!=='dense_vector')throw fail('pinecone_index_type','The selected field is not a dense vector field.');family='documents';dimension=v.dimension;metric=v.metric;}
   else{family='vectors';dimension=data.dimension;metric=data.metric;}
   if(!embedding||embedding.spec.model!==c.model||embedding.spec.dimensions!==c.dimensions)throw fail('pinecone_embedding_mismatch','Configure the same external embedding model and dimensions before checking Pinecone.');
  }
  if(dimension!==c.dimensions||metric!==c.metric)throw fail('pinecone_dimension_mismatch','Pinecone dimensions or metric differ. This adapter requires matching dimensions and cosine similarity.');
  return {family};
 }
 async function check(corpus,{directory,embedding,signal}={}){return exclusive(async()=>{
  checked=null;const data=await request(`https://api.pinecone.io/indexes/${encodeURIComponent(c.indexName)}`,{method:'GET',signal});checked=compatibility(data,embedding);
  let receipt;try{receipt=await readReceipt(directory,corpus);}catch(e){if(e.code!=='pinecone_stale')throw e;}
  if(receipt?.complete){try{const stats=await request(endpoint('/describe_index_stats'),{signal});
   const counts=(value,camel,snake)=>{const a=value?.[camel],b=value?.[snake],n=a??b;return a!==undefined&&b!==undefined&&a!==b?null:Number.isSafeInteger(n)&&n>=0?n:null;};
   const namespaces=stats.namespaces,hasNamespace=!!namespaces&&typeof namespaces==='object'&&!Array.isArray(namespaces)&&Object.hasOwn(namespaces,receipt.namespace);
   const row=hasNamespace?namespaces[receipt.namespace]:null,count=counts(row,'vectorCount','vector_count');
   receipt.countCheck={observedCount:count,totalIndexCount:counts(stats,'totalVectorCount','total_vector_count'),checkedAt:new Date().toISOString(),status:!hasNamespace?'missing_namespace':count===null?'unknown_count':count===receipt.expectedChunks?'match':'mismatch'};
   receipt.visible=count!==null&&count===receipt.expectedChunks;await saveReceipt(directory,receipt);
  }catch(error){checked=null;throw error;}}
  return {...await readiness(corpus,{directory}),checked:true,apiFamily:checked.family,notice:'Connection/schema checked. No index created and no source uploaded.'};
 });}
 async function readiness(corpus,{directory}={}){
  const base={backend:'pinecone',host:c.host,indexName:c.indexName,namespacePrefix:c.namespacePrefix,mode:c.mode,model:c.model,dimensions:c.dimensions,metric:c.metric,field:c.field,checked:!!checked,expectedChunks:corpus.chunks.length};
  if(!keyPresent)return {...base,status:'not_configured',message:'Save a Pinecone key and check the existing index.'};
  try{const receipt=await readReceipt(directory,corpus);if(!receipt)return {...base,status:checked?'missing':'check_required',message:'Check the connection, then explicitly upload into a new isolated namespace.'};return {...base,namespace:receipt.namespace,countCheck:receipt.countCheck||null,status:!checked?'check_required':!receipt.complete?'partial':!receipt.visible?'uploaded_unverified':'ready',uploadedChunks:receipt.uploadedChunks,message:!checked?'Run the separate connection check.':!receipt.complete?'Upload incomplete. A partial namespace remains; a new upload uses a fresh namespace.':!receipt.visible?'Upload acknowledged. Run Check connection again to verify indexed record count.':'Upload and indexed count verified for this corpus. Search results are still validated locally.'};}catch(e){return {...base,status:'stale',message:e.message};}
 }
 async function requireReady(corpus,{directory}={}){const state=await readiness(corpus,{directory});if(state.status!=='ready')throw fail('pinecone_not_ready',state.message);return readReceipt(directory,corpus);}
 async function build(corpus,{directory,embedding,signal,batchSize=16}={}){return exclusive(async()=>{
  if(!checked)throw fail('pinecone_check_required','Run Check connection before uploading.');
  if(c.mode==='external'&&(!embedding||embedding.spec.model!==c.model||embedding.spec.dimensions!==c.dimensions))throw fail('pinecone_embedding_mismatch','External embedding configuration changed. Check again.');
  const namespace=c.namespacePrefix+'-cc-'+hash(corpus.corpusVersion).slice(0,16)+'-'+randomUUID().replace(/-/g,'').slice(0,12);
  const stats=await request(endpoint('/describe_index_stats'),{signal});if(!stats.namespaces||typeof stats.namespaces!=='object'||Object.hasOwn(stats.namespaces,namespace))throw fail('pinecone_namespace_collision','Could not confirm a fresh namespace. No source upload was made.');
  const receipt={configHash:fingerprint,corpusVersion:corpus.corpusVersion,namespace,expectedChunks:corpus.chunks.length,uploadedChunks:0,complete:false,visible:false,createdAt:new Date().toISOString()};await saveReceipt(directory,receipt);let batches=0;
  for(let start=0;start<corpus.chunks.length;start+=batchSize){abort(signal);const chunks=corpus.chunks.slice(start,start+batchSize);const texts=chunks.map(x=>`${x.heading}\n${x.text}`);if(texts.some(t=>t.length>8000))throw fail('pinecone_input_size','A chunk exceeds the upload text limit.');let vectors;
   if(c.mode==='external'){const response=await embedding.embed(texts,{signal,purpose:'document'});if(response.model!==c.model||response.dimensions!==c.dimensions||response.revision!==embedding.spec.revision||!Array.isArray(response.vectors)||response.vectors.length!==chunks.length)throw fail('pinecone_embedding_mismatch','Embedding response metadata/count mismatch.');vectors=response.vectors;for(const v of vectors)validateVector(v);}
   const rows=chunks.map((x,i)=>{const metadata={cc_corpus:corpus.corpusVersion,cc_hash:x.contentHash,cc_source:x.sourceId,cc_status:x.metadata?.status||'active'};return checked.family==='vectors'?{id:x.chunkId,values:vectors[i],metadata}:{_id:x.chunkId,...metadata,[c.field]:c.mode==='integrated'?texts[i]:vectors[i]};});
   if(checked.family==='records')await request(endpoint(`/records/namespaces/${namespace}/upsert`),{body:rows.map(x=>JSON.stringify(x)).join('\n'),ndjson:true,empty:true,signal});
   else{const data=await request(endpoint(checked.family==='vectors'?'/vectors/upsert':`/namespaces/${namespace}/documents/upsert`),{body:checked.family==='vectors'?{namespace,vectors:rows}:{documents:rows},signal});if(data.upsertedCount!==rows.length&&data.upserted_count!==rows.length)throw fail('pinecone_partial_upload','Pinecone did not acknowledge all records. Partial data may remain.');}
   receipt.uploadedChunks+=rows.length;batches++;await saveReceipt(directory,receipt);
  }
  abort(signal);receipt.complete=true;await saveReceipt(directory,receipt);return {corpusVersion:corpus.corpusVersion,namespace,chunks:receipt.uploadedChunks,providerBatches:batches,backend:'pinecone',host:c.host,indexName:c.indexName,notice:'Upload acknowledged; run Check connection to verify indexed count. No records were deleted.'};
 });}
 function validateVector(v){if(!Array.isArray(v)||v.length!==c.dimensions||v.some(x=>typeof x!=='number'||!Number.isFinite(x))||!Number.isFinite(Math.hypot(...v))||Math.hypot(...v)===0)throw fail('pinecone_embedding_mismatch','Embedding vector dimensions or values are invalid.');}
 async function search(corpus,query,{directory,embedding,signal,topK,sourceIds,minScore}={}){return exclusive(async()=>{
  const receipt=await requireReady(corpus,{directory});let vector,embeddingMs=0;const start=performance.now();
  if(c.mode==='external'){if(!embedding||embedding.spec.model!==c.model||embedding.spec.dimensions!==c.dimensions)throw fail('pinecone_embedding_mismatch','External embedding model changed.');const data=await embedding.embed([query],{signal,purpose:'query'});if(data.model!==c.model||data.dimensions!==c.dimensions||data.revision!==embedding.spec.revision||data.vectors?.length!==1)throw fail('pinecone_embedding_mismatch','Query embedding metadata mismatch.');vector=data.vectors[0];validateVector(vector);embeddingMs=performance.now()-start;}
  const filter={cc_corpus:{$eq:corpus.corpusVersion},...(sourceIds.length?{cc_source:{$in:sourceIds}}:{cc_status:{$eq:'active'}})},namespace=receipt.namespace;let data;
  if(checked.family==='records')data=await request(endpoint(`/records/namespaces/${namespace}/search`),{signal,body:{query:{inputs:{text:query},top_k:topK,filter},fields:['cc_corpus','cc_hash','cc_source','cc_status']}});
  else if(checked.family==='vectors')data=await request(endpoint('/query'),{signal,body:{namespace,vector,topK,filter,includeMetadata:true,includeValues:false}});
  else data=await request(endpoint(`/namespaces/${namespace}/documents/search`),{signal,body:{score_by:[{type:'dense_vector',fields:[c.field],values:vector}],top_k:topK,filter,include_fields:['cc_corpus','cc_hash','cc_source','cc_status']}});
  if(data.namespace!==undefined&&data.namespace!==namespace)throw fail('pinecone_result_mismatch','Pinecone returned another namespace.');
  const rows=checked.family==='records'?data.result?.hits:data.matches;if(!Array.isArray(rows)||rows.length>topK)throw fail('pinecone_result_mismatch','Invalid Pinecone search response.');const byId=new Map(corpus.chunks.map(x=>[x.chunkId,x])),seen=new Set();
  const matches=rows.map(row=>{const id=checked.family==='vectors'?row.id:row._id,score=checked.family==='vectors'?row.score:row._score,metadata=checked.family==='records'?row.fields:checked.family==='vectors'?row.metadata:row,chunk=byId.get(id);
   if(!chunk||seen.has(id)||!Number.isFinite(score)||score< -1.001||score>1.001||!metadata||metadata.cc_corpus!==corpus.corpusVersion||metadata.cc_hash!==chunk.contentHash||metadata.cc_source!==chunk.sourceId||metadata.cc_status!==(chunk.metadata?.status||'active')||(sourceIds.length?!sourceIds.includes(chunk.sourceId):(chunk.metadata?.status||'active')!=='active'))throw fail('pinecone_result_mismatch','Search evidence failed local source/version validation. No remote text was trusted.');seen.add(id);return {...chunk,score:Math.max(-1,Math.min(1,score))};}).filter(x=>x.score>=minScore);
  return {matches,embeddingMs,searchMs:performance.now()-start-embeddingMs,namespace,method:c.mode==='integrated'?'pinecone-integrated-cosine':'pinecone-vector-cosine',integratedEmbedding:c.mode==='integrated'};
 });}
 return {status,spec,mode:c.mode,check,readiness,requireReady,build,search};
}

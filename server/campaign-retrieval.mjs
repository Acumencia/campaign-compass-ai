import {createRagService} from './rag.mjs';
import {loadKnowledge,source,KnowledgeError} from './knowledge.mjs';

const fail=(code,message,status=400)=>new KnowledgeError(status,code,message);
const nativeId=id=>typeof id==='string'&&/^brand:[a-z0-9][a-z0-9-]{0,60}$/.test(id)?id.slice(6):null;
const prefix=chunk=>({...chunk,sourceId:`brand:${chunk.sourceId}`});
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

/** Prove a retained indexed snapshot differs only in document raw-byte hashes.
 * Never rewrite an index receipt/version. Canonical text, metadata, licensing,
 * document identity, chunk ordering and every complete chunk must match exactly.
 */
export function validateIndexedCorpusCompatibility(local,indexed){
 const valid=corpus=>record(corpus)&&/^sha256:[a-f0-9]{64}$/.test(corpus.corpusVersion||'')&&corpus.schemaVersion===1&&record(corpus.config)&&Array.isArray(corpus.documents)&&corpus.documents.length>0&&corpus.documents.length<=50&&Array.isArray(corpus.chunks)&&corpus.chunks.length>0&&corpus.chunks.length<=5000&&corpus.documents.every(document=>record(document)&&typeof document.text==='string'&&typeof document.sourceId==='string'&&/^[a-f0-9]{64}$/.test(document.contentHash||''));
 const withoutRawHashes=documents=>documents.map(({contentHash,...document})=>document);
 if(!valid(local)||!valid(indexed)||JSON.stringify(local.config)!==JSON.stringify(indexed.config)||JSON.stringify(local.chunks)!==JSON.stringify(indexed.chunks)||JSON.stringify(withoutRawHashes(local.documents))!==JSON.stringify(withoutRawHashes(indexed.documents)))throw fail('campaign_corpus_incompatible','The retained indexed snapshot does not match the complete local canonical sources and chunks. No evidence can be accepted; use matching verified snapshots.',409);
 return {indexCorpusVersion:indexed.corpusVersion,localCorpusVersion:local.corpusVersion,equivalence:local.corpusVersion===indexed.corpusVersion?'identical-corpus-version':'canonical-content-identical'};
}

/** Reuse the configured Week 2 vector/Pinecone service without invoking a writer.
 * The caller owns session/credential-revision checks in authorize; no keys,
 * endpoints, consent state, uploads or ingestion are selected by this adapter.
 * getIndexedCorpus is an optional trusted server-side loader for a retained
 * verified snapshot, never an HTTP/model path. Its actual version is queried;
 * a local-version mapping is returned only after full canonical equivalence.
 */
export function createCampaignRetrieval({api,authorize=()=>false,session,getCorpus=loadKnowledge,getIndexedCorpus,storeDirectory,config={},allowTestProviders=false}={}){
 if(!api||typeof api.status!=='function'||typeof authorize!=='function'||(getIndexedCorpus!==undefined&&typeof getIndexedCorpus!=='function'))throw Error('A trusted configured retrieval API, snapshot loaders and authorization callback are required.');
 const selected=api.status();
 const permit=async context=>{
  if(context?.signal?.aborted)throw fail('cancelled','Campaign retrieval was cancelled.',499);
  if(await authorize({...context,session,operation:'retrieval',retrievalOnly:true})!==true)throw fail('provider_access_required','Authorize the existing retrieval backend before grounding a live campaign.',403);
  if(context?.signal?.aborted)throw fail('cancelled','Campaign retrieval was cancelled.',499);
  return true;
 };
 const snapshots=async()=>{
  const local=await getCorpus();
  if(!getIndexedCorpus)return {local,indexed:local,mapping:{indexCorpusVersion:local.corpusVersion,localCorpusVersion:local.corpusVersion,equivalence:'identical-corpus-version'}};
  let indexed;try{indexed=await getIndexedCorpus();}catch(error){if(error instanceof KnowledgeError)throw error;throw fail('campaign_indexed_corpus_unavailable','The trusted retained indexed snapshot could not be read or verified. No substitute index was used.',409);}
  return {local,indexed,mapping:validateIndexedCorpusCompatibility(local,indexed)};
 };
 // retrieveOnly performs authorization before invoking this loader. Re-check the
 // full equivalence on every freshness check, not just once at construction.
 const service=createRagService({config:{enabled:selected.enabled===true,maxEmbeddingCharacters:8000,...config},embedding:api.embedding||null,storage:api.storage||null,generation:null,authorizeAccess:permit,getCorpus:async()=>(await snapshots()).indexed,allowTestProviders,...(storeDirectory?{storeDirectory}:{})});
 async function searchEvidence(query,filters={layer:'brand'},limit=4,{signal}={}){
  if(!filters||typeof filters!=='object'||Array.isArray(filters)||filters.layer!=='brand'||Object.keys(filters).some(key=>!['layer','sourceIds'].includes(key)))throw fail('campaign_retrieval_filter','Campaign vector retrieval accepts only the brand layer and explicit source IDs.');
  if(typeof query!=='string'||!query.trim()||query.length>500||!Number.isInteger(limit)||limit<1||limit>10)throw fail('campaign_retrieval_query','Use a nonempty query of at most 500 characters and a limit of 1 to 10.');
  const ids=filters.sourceIds??[];
  if(!Array.isArray(ids)||ids.length>50||ids.some(id=>!nativeId(id))||new Set(ids).size!==ids.length)throw fail('campaign_retrieval_filter','Use unique brand-prefixed source IDs.');
  await permit({signal});const {local,indexed,mapping}=await snapshots();await permit({signal});
  const result=await service.retrieveOnly(indexed,{question:query,corpusVersion:indexed.corpusVersion,topK:limit,sourceIds:ids.map(nativeId)},{session,signal});
  await permit({signal});const current=await snapshots();await permit({signal});
  if(current.local.corpusVersion!==local.corpusVersion||current.indexed.corpusVersion!==indexed.corpusVersion)throw fail('stale_corpus','A source snapshot changed during campaign retrieval. Retry only after checking the current sources.',409);
  if(result.status!=='retrieved'||!result.retrieval.matches.length)throw fail('campaign_retrieval_empty','No vector evidence met the retrieval threshold. Review the query or existing index; lexical evidence was not substituted.',409);
  return {layer:'brand',retrievalMode:'vector-only',corpusVersion:local.corpusVersion,indexCorpusVersion:result.corpusVersion,corpusMapping:mapping,method:result.retrieval.method,backend:result.diagnostics.backend,matches:result.retrieval.matches.map(prefix),transport:{protocol:'internal-vector-retrieval',backend:result.diagnostics.backend,method:result.retrieval.method,namespace:result.retrieval.namespace,requestId:result.runId,durationMs:Math.round(result.diagnostics.totalMs),...mapping},diagnostics:{...result.diagnostics,...mapping}};
 }
 async function fetchSource(sourceId,{signal}={}){
  const id=nativeId(sourceId);if(!id)throw fail('campaign_retrieval_source','Use a brand-prefixed source ID.');
  await permit({signal});const corpus=await getCorpus(),result=source(corpus,id);await permit({signal});
  return {layer:'brand',corpusVersion:corpus.corpusVersion,document:{...result.document,sourceId},chunks:result.chunks.map(prefix),transport:{protocol:'local-source-validation',backend:'local',method:'canonical-source-by-id'}};
 }
 return {searchEvidence,fetchSource,retrieveBrand:({query,limit=4,signal,sourceIds=[]})=>searchEvidence(query,{layer:'brand',sourceIds},limit,{signal}),status:()=>({retrievalMode:'vector-only',backend:selected.storage?.backend||'local',configured:service.usesRetrievalProviders,generation:false,lexicalFallback:false}),close(){}};
}

// TEST ONLY: all vectors, Pinecone transport and credentials are local fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRagService} from '../server/rag.mjs';
import {createCampaignRetrieval,validateIndexedCorpusCompatibility} from '../server/campaign-retrieval.mjs';
import {buildCorpus} from '../server/knowledge.mjs';
import {createPineconeStore} from '../server/pinecone.mjs';
import {fixture,docs} from './rag-fixtures.mjs';
import {KEY,config,mockPinecone,mockEmbedding} from './pinecone-fixtures.mjs';

const request=corpus=>({question:'bottle capacity',corpusVersion:corpus.corpusVersion,topK:5,sourceIds:[]});
const apiFor=f=>({status:()=>({enabled:true,storage:f.store?.status()||{backend:'local'}}),embedding:f.embedding,storage:f.store||null});

test('generation-free local vector retrieval reuses current index with exact source citations and no writer',async t=>{
 const f=await fixture(t);await f.service.buildIndex();let authorizations=0;
 const service=createRagService({...f.options,generation:null,authorizeAccess:async context=>{authorizations++;assert.equal(context.operation,'retrieval');assert.equal(context.session.id,'scope-a');return true;}});
 assert.equal(service.usesProviders,false);assert.equal(service.usesRetrievalProviders,true);
 const found=await service.retrieveOnly(f.corpus,f.request(),{session:{id:'scope-a'}});
 assert.equal(found.mode,'retrieval-only');assert.equal(found.status,'retrieved');assert.equal(found.retrieval.method,'vector-cosine-v1');assert.equal(found.retrieval.matches[0].contentHash,f.corpus.chunks[0].contentHash);assert.equal(found.retrieval.matches[0].text,f.corpus.chunks[0].text);assert.equal(found.diagnostics.generationMs,null);assert.equal(f.calls.generation,0);assert.equal(f.calls.query,1);assert.ok(authorizations>=3);
});

test('denied retrieval authorization precedes corpus/index/receipt reads and embeddings even without generation',async t=>{
 const f=await fixture(t);let reads=0;
 const service=createRagService({...f.options,generation:null,getCorpus:async()=>{reads++;return f.corpus;},authorizeAccess:async()=>false});
 await assert.rejects(service.retrieveOnly(f.corpus,f.request()),{code:'provider_access_required'});assert.equal(reads,0);assert.equal(f.calls.query,0);
 const helper=createCampaignRetrieval({api:apiFor(f),authorize:()=>false,getCorpus:async()=>{reads++;return f.corpus;},storeDirectory:f.directory,allowTestProviders:true});
 await assert.rejects(helper.searchEvidence('bottle',{layer:'brand'},2),{code:'provider_access_required'});await assert.rejects(helper.fetchSource('brand:bottle'),{code:'provider_access_required'});assert.equal(reads,0);
});

test('missing or empty vector evidence never substitutes lexical matches',async t=>{
 const f=await fixture(t),helper=createCampaignRetrieval({api:apiFor(f),authorize:()=>true,getCorpus:async()=>f.corpus,storeDirectory:f.directory,allowTestProviders:true});
 await assert.rejects(helper.searchEvidence('bottle',{layer:'brand'},2),{code:'vector_index_missing'});assert.equal(f.calls.query,0);
 await f.service.buildIndex();
 await assert.rejects(helper.searchEvidence('bottle',{layer:'brand',sourceIds:['brand:pack']},2),{code:'campaign_retrieval_empty'});assert.equal(f.calls.generation,0);assert.equal(f.calls.query,1);
});

test('campaign wrapper returns vector-only backend provenance and canonical prefixed brand chunks',async t=>{
 const f=await fixture(t);await f.service.buildIndex();const helper=createCampaignRetrieval({api:apiFor(f),authorize:()=>true,getCorpus:async()=>f.corpus,storeDirectory:f.directory,allowTestProviders:true});
 const found=await helper.retrieveBrand({query:'bottle',limit:2});assert.equal(found.retrievalMode,'vector-only');assert.equal(found.backend,'local');assert.equal(found.method,'vector-cosine-v1');assert.equal(found.matches[0].sourceId,'brand:bottle');assert.equal(found.matches[0].chunkId,f.corpus.chunks[0].chunkId);assert.equal(found.transport.protocol,'internal-vector-retrieval');assert.ok(found.transport.namespace);
 const full=await helper.fetchSource('brand:bottle');assert.equal(full.document.sourceId,'brand:bottle');assert.equal(full.chunks[0].contentHash,found.matches[0].contentHash);
 await assert.rejects(helper.searchEvidence('bottle',{layer:'trail'},2),{code:'campaign_retrieval_filter'});await assert.rejects(helper.searchEvidence('bottle',{layer:'brand',sourceIds:['../../secret']},2),{code:'campaign_retrieval_filter'});assert.equal(f.calls.generation,0);
});

async function pinecone(t,mode='integrated',family){
 const directory=await mkdtemp(path.join(tmpdir(),'campaign-vector-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));const corpus=buildCorpus(docs),c=config(mode),mock=mockPinecone(c,family),embedding=mode==='external'?mockEmbedding(c):null,store=createPineconeStore({config:c,key:KEY,fetcher:mock.fetcher}),opts={directory,embedding};
 // Populate only an in-memory mock and temporary receipt. No provider or real index.
 await store.check(corpus,opts);await store.build(corpus,opts);await store.check(corpus,opts);mock.calls.length=0;if(embedding)embedding.calls.length=0;
 return {directory,corpus,c,mock,embedding,store,opts};
}

for(const [mode,family] of [['integrated','records'],['external','vectors'],['external','documents']])test(`${family}: campaign retrieval uses existing Pinecone search without generation, upload or lexical fallback`,async t=>{
 const f=await pinecone(t,mode,family),helper=createCampaignRetrieval({api:apiFor(f),authorize:()=>true,getCorpus:async()=>f.corpus,storeDirectory:f.directory,allowTestProviders:true});
 const result=await helper.searchEvidence('bottle',{layer:'brand',sourceIds:['brand:bottle']},2);
 assert.equal(result.backend,'pinecone');assert.equal(result.method,mode==='integrated'?'pinecone-integrated-cosine':'pinecone-vector-cosine');assert.equal(result.matches.length,1);assert.equal(result.matches[0].sourceId,'brand:bottle');assert.equal(result.matches[0].text,f.corpus.chunks[0].text);assert.doesNotMatch(result.matches[0].text,/REMOTE TEXT/);assert.equal(f.mock.calls.length,1);assert.ok(f.mock.calls.every(c=>!c.url.endsWith('/upsert')&&new URL(c.url).host!== 'api.pinecone.io'));assert.equal(result.diagnostics.generationMs,null);if(f.embedding)assert.deepEqual(f.embedding.calls.map(c=>c.purpose),['query']);
});

test('revoked consent after query embedding prevents Pinecone search',async t=>{
 const f=await pinecone(t,'external');let allowed=true;const original=f.embedding.embed;f.embedding.embed=async(...args)=>{const response=await original.apply(f.embedding,args);allowed=false;return response;};
 const helper=createCampaignRetrieval({api:apiFor(f),authorize:()=>allowed,getCorpus:async()=>f.corpus,storeDirectory:f.directory,allowTestProviders:true});
 await assert.rejects(helper.searchEvidence('bottle',{layer:'brand'},2),{code:'provider_access_required'});assert.equal(f.mock.calls.length,0);assert.equal(f.embedding.calls.length,1);
});

test('stale corpus and forged Pinecone citation metadata fail closed',async t=>{
 const f=await pinecone(t),service=createRagService({config:{enabled:true},storage:f.store,generation:null,getCorpus:async()=>f.corpus,storeDirectory:f.directory,authorizeAccess:()=>true});
 await assert.rejects(service.retrieveOnly(f.corpus,{...request(f.corpus),corpusVersion:'old'}),{code:'stale_corpus'});assert.equal(f.mock.calls.length,0);
 f.mock.setMutate(data=>{data.result.hits[0].fields.cc_hash='forged';return data;});await assert.rejects(service.retrieveOnly(f.corpus,request(f.corpus)),{code:'pinecone_result_mismatch'});assert.equal(f.mock.calls.length,1);
});

test('retrieval-only validates storage results against canonical chunks, filters and duplicates',async()=>{
 const corpus=buildCorpus(docs);let matches=[{...corpus.chunks[0],score:.9}],calls=0;
 const storage={mode:'integrated',spec:{provider:'fixture',model:'fixture',revision:'1',dimensions:3},status:()=>({configured:true,backend:'pinecone'}),search:async()=>{calls++;return {matches,embeddingMs:0,searchMs:0,namespace:'fixture-ns',method:'pinecone-integrated-cosine',integratedEmbedding:true};}};
 const service=createRagService({config:{enabled:true},storage,getCorpus:async()=>corpus,authorizeAccess:()=>true});
 for(const bad of [[{...corpus.chunks[0],score:.9,text:'forged'}],[{...corpus.chunks[0],score:.9},{...corpus.chunks[0],score:.8}],[{...corpus.chunks[0],score:.9,sourceId:'other'}]]){matches=bad;await assert.rejects(service.retrieveOnly(corpus,request(corpus)),{code:'retrieval_contract'});}
 matches=[{...corpus.chunks[0],score:.9}];await assert.rejects(service.retrieveOnly(corpus,{...request(corpus),sourceIds:['pack']}),{code:'retrieval_contract'});assert.equal(calls,4);
});

test('retrieval-only timeout aborts one storage search without retry or stale success',async()=>{
 const corpus=buildCorpus(docs);let calls=0,observedSignal;
 const storage={mode:'integrated',spec:{provider:'fixture',model:'fixture',revision:'1',dimensions:3},status:()=>({configured:true,backend:'pinecone'}),search:async(_,__,options)=>{calls++;observedSignal=options.signal;return await new Promise(()=>{});}};
 const service=createRagService({config:{enabled:true,timeoutMs:10},storage,getCorpus:async()=>corpus,authorizeAccess:()=>true});
 await assert.rejects(service.retrieveOnly(corpus,request(corpus)),{code:'timeout'});assert.equal(calls,1);assert.equal(observedSignal.aborted,true);
});

function alternateRawSnapshot(corpus){const copy=structuredClone(corpus);copy.corpusVersion='sha256:'+'f'.repeat(64);copy.documents=copy.documents.map(document=>({...document,contentHash:'e'.repeat(64)}));return copy;}

test('retained index snapshot with only raw document hash differences is explicitly mapped after full canonical proof',async t=>{
 const f=await fixture(t);await f.service.buildIndex();const local=alternateRawSnapshot(f.corpus);
 const helper=createCampaignRetrieval({api:apiFor(f),authorize:()=>true,getCorpus:async()=>local,getIndexedCorpus:async()=>f.corpus,storeDirectory:f.directory,allowTestProviders:true});
 const found=await helper.retrieveBrand({query:'bottle',limit:2});
 assert.equal(found.corpusVersion,local.corpusVersion);assert.equal(found.indexCorpusVersion,f.corpus.corpusVersion);assert.equal(found.transport.indexCorpusVersion,f.corpus.corpusVersion);assert.equal(found.transport.localCorpusVersion,local.corpusVersion);assert.equal(found.transport.equivalence,'canonical-content-identical');assert.equal(found.matches[0].chunkId,local.chunks[0].chunkId);assert.equal(found.matches[0].contentHash,local.chunks[0].contentHash);assert.equal(f.calls.query,1);assert.equal(f.calls.generation,0);
});

test('Pinecone queries the actual retained receipt version and records canonical local mapping',async t=>{
 const f=await pinecone(t),local=alternateRawSnapshot(f.corpus);
 const helper=createCampaignRetrieval({api:apiFor(f),authorize:()=>true,getCorpus:async()=>local,getIndexedCorpus:async()=>f.corpus,storeDirectory:f.directory});
 const found=await helper.searchEvidence('bottle',{layer:'brand'},2);
 assert.equal(f.mock.calls.length,1);assert.equal(f.mock.calls[0].body.query.filter.cc_corpus.$eq,f.corpus.corpusVersion);assert.notEqual(f.mock.calls[0].body.query.filter.cc_corpus.$eq,local.corpusVersion);assert.equal(found.transport.equivalence,'canonical-content-identical');assert.equal(found.corpusVersion,local.corpusVersion);assert.equal(found.indexCorpusVersion,f.corpus.corpusVersion);
});

test('changed canonical text, metadata, chunks, configuration or missing documents reject compatibility before network',async t=>{
 const f=await pinecone(t),local=alternateRawSnapshot(f.corpus);
 const mutations=[
  corpus=>{corpus.documents[0].text+=' Changed fact.';},
  corpus=>{corpus.documents[0].metadata.status='expired';},
  corpus=>{corpus.documents[0].license='Changed rights';},
  corpus=>{corpus.chunks[0].text+=' Changed block.';},
  corpus=>{corpus.chunks.pop();},
  corpus=>{corpus.documents.pop();},
  corpus=>{corpus.config.maxWords++;},
  corpus=>{delete corpus.documents[0].contentHash;}
 ];
 for(const mutate of mutations){const indexed=structuredClone(f.corpus);mutate(indexed);const helper=createCampaignRetrieval({api:apiFor(f),authorize:()=>true,getCorpus:async()=>local,getIndexedCorpus:async()=>indexed,storeDirectory:f.directory});await assert.rejects(helper.searchEvidence('bottle',{layer:'brand'},2),{code:'campaign_corpus_incompatible'});}
 assert.equal(f.mock.calls.length,0);
 assert.throws(()=>validateIndexedCorpusCompatibility(local,null),{code:'campaign_corpus_incompatible'});
});

test('indexed snapshot is never read without authorization and unavailable snapshots do not fall back',async t=>{
 const f=await fixture(t);let reads=0;
 const denied=createCampaignRetrieval({api:apiFor(f),authorize:()=>false,getCorpus:async()=>f.corpus,getIndexedCorpus:async()=>{reads++;return f.corpus;},storeDirectory:f.directory,allowTestProviders:true});
 await assert.rejects(denied.searchEvidence('bottle',{layer:'brand'},2),{code:'provider_access_required'});assert.equal(reads,0);
 const absent=createCampaignRetrieval({api:apiFor(f),authorize:()=>true,getCorpus:async()=>f.corpus,getIndexedCorpus:async()=>{throw Error('private path');},storeDirectory:f.directory,allowTestProviders:true});
 await assert.rejects(absent.searchEvidence('bottle',{layer:'brand'},2),error=>error.code==='campaign_indexed_corpus_unavailable'&&!error.message.includes('private path'));assert.equal(f.calls.query,0);
});

test('canonical mapping is rechecked after retrieval and concurrent local changes discard results',async t=>{
 const f=await pinecone(t);let local=alternateRawSnapshot(f.corpus);f.mock.setMutate(data=>{local=structuredClone(local);local.documents[0].text+=' Concurrent change.';return data;});
 const helper=createCampaignRetrieval({api:apiFor(f),authorize:()=>true,getCorpus:async()=>local,getIndexedCorpus:async()=>f.corpus,storeDirectory:f.directory});
 await assert.rejects(helper.searchEvidence('bottle',{layer:'brand'},2),{code:'campaign_corpus_incompatible'});assert.equal(f.mock.calls.length,1);
});

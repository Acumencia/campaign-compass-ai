// TEST ONLY: hand-authored numeric fixtures and canned JSON. Never import from app code.
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildCorpus} from '../server/knowledge.mjs';
import {createRagService} from '../server/rag.mjs';
export const docs=[{name:'bottle.md',text:'# Bottle\n## Capacity\nThe bottle holds 650 milliliters.'},{name:'pack.md',text:'# Pack\n## Capacity\nThe pack holds 18 liters.'},{name:'returns.md',text:'# Returns\n## Window\nUnused items may be returned within 30 days.'}];
export function fixtureProviders(){
 const calls={document:0,query:0,generation:0};
 const embedding={testOnly:true,spec:{provider:'TEST ONLY',model:'hand-authored-vectors',revision:'fixture-v1',dimensions:3},async embed(texts,{signal,purpose}){calls[purpose]++;if(signal.aborted)throw Error('cancelled');return {model:this.spec.model,revision:this.spec.revision,dimensions:this.spec.dimensions,vectors:texts.map(s=>/bottle/i.test(s)?[1,0,0]:/pack/i.test(s)?[0,1,0]:[0,0,1])};}};
 const generation={testOnly:true,spec:{provider:'TEST ONLY',model:'canned-json',revision:'fixture-v1'},async generate(request){calls.generation++;const data=JSON.parse(request.input),e=data.evidence[0];return {corpusVersion:data.corpusVersion,status:'answered',message:'',claims:[{text:e.text,citations:[{chunkId:e.chunkId,quote:e.text}]}]};}};
 return {embedding,generation,calls};
}
export async function fixture(t,overrides={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'cc-rag-test-only-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const corpus=buildCorpus(docs),providers=fixtureProviders();
 const options={config:{enabled:true,batchSize:1},...providers,storeDirectory:directory,getCorpus:async()=>corpus,allowTestProviders:true,...overrides};delete options.calls;
 const service=createRagService(options);
 return {directory,corpus,service,options,...providers,request:(question='bottle capacity',extra={})=>({question,corpusVersion:corpus.corpusVersion,topK:5,sourceIds:[],...extra})};
}

// Disposable visual fixture. No credential loading or provider network calls.
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createServer} from '../server.mjs';import {createCampaignService} from '../server/campaign.mjs';
import {createCampaignGeneration} from '../server/campaign-generation.mjs';
import {createAPIProviders} from '../server/api-providers.mjs';import {createChatGPTService} from '../server/chatgpt.mjs';import {MemoryStore,mockProtocol} from '../tests/chatgpt-fixtures.mjs';
import {campaignVectorFixture} from '../tests/campaign-vector-fixture.mjs';
import {loadTrails} from '../server/trails.mjs';
export async function createMockReviewServer({directory,revisionDelayMs=400}={}){
 if(!directory)throw Error('A disposable fixture directory is required.');
 let calls=0,retrievalCalls=0;const plannedBatches=[];
const mockGeneration={spec:{provider:'MOCK ONLY',model:'canned-fixture'},async generateStructured(request,{signal}={}){
 calls++;if(signal?.aborted)throw Object.assign(Error('Mock cancelled'),{code:'cancelled'});
 const input=JSON.parse(request.input);
 if(request.name==='campaign_critic')return {findings:input.artifacts.find(a=>a.id==='linkedin')?.text.includes('Mock revision for clarity.')?[]:[{artifactId:'linkedin',issue:'Mock reviewer asks for clearer narrative.',suggestion:'Add the labelled mock revision.'}]};
 const revising=request.name==='campaign_revision';
 if(revising)await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,revisionDelayMs);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(Object.assign(Error('Mock cancelled'),{code:'cancelled'}));},{once:true});});
 return {artifacts:input.artifacts.map(a=>{
  const routes=input.evidence.map(t=>({...t,facts:t.facts.filter(f=>a.permittedFactIds.includes(f.id))})).filter(t=>t.facts.length);
  const chosen=a.kind==='ads'?routes.slice(0,2).map(t=>t.facts[0]):[routes[0].facts[0]];
  return {artifactId:a.id,fields:a.requiredFields.map((name,i)=>({name,text:(revising?'Mock revision for clarity. ':'')+'Explore this fictional concept with curiosity and share what you would like to discover.',...(a.kind==='ads'?{factIds:[chosen[Math.min(i,chosen.length-1)].id]}:{})})),claims:chosen.map(f=>({text:f.text,quote:f.text,factId:f.id,sourceId:f.sourceId})),assumptions:['A proposed introductory conversation and reflective close.']};
 })};
}};
const generatorFor=()=>createCampaignGeneration({generation:mockGeneration,authorize:()=>true,maxCalls:12,reserveBatch:async({requests})=>{const plan={mode:'MOCK ONLY',requestCount:requests.length,artifactIds:requests.flatMap(r=>JSON.parse(r.input).artifacts.map(a=>a.id)),cost:0,cleaned:false};plannedBatches.push(plan);return ()=>{plan.cleaned=true;};}});
const vector=campaignVectorFixture(loadTrails);const retrieveBrand=async args=>{retrievalCalls++;return vector.retrieveBrand(args);};
const service=createCampaignService({directory,evidenceTools:vector.evidenceTools});
const facade={...service,advance:(o,id,args)=>service.advance(o,id,{...args,generator:generatorFor(),retrieveBrand}),revise:(o,id,args)=>service.revise(o,id,{...args,generator:generatorFor()}),review:(o,id,args)=>service.review(o,id,{...args,generator:generatorFor()}),decide:(o,id,args)=>service.decide(o,id,{...args,generator:generatorFor()})};
const campaignAPI={status:()=>({provider:'anthropic',generationModel:'claude-opus-5-5',generationConfigured:true,keyPresent:true}),generation:{withTransport:()=>{throw Error('Mock facade must handle all generation');}}};
const server=createServer({campaignService:facade,campaignDirectory:directory,campaignAPI,campaignRetrieveBrand:retrieveBrand,campaignRetrievalAPI:{status:()=>({retrievalConfigured:true,embeddingBlocked:false,storage:{backend:'local'}})},campaignRetrievalAuthorize:()=>true,apiKey:createAPIProviders({environment:{}}),campaignFetch:async()=>{throw Error('Provider access prohibited in mock fixture');},chatgpt:createChatGPTService({store:new MemoryStore(),protocol:mockProtocol(),supported:false})});
const listener=server.listeners('request')[0];server.removeListener('request',listener);
const html=(await readFile(new URL('../campaign.html',import.meta.url),'utf8')).replace('<body>','<body><p role="status" class="notice">MOCK QA ONLY — canned model responses, simulated vector retrieval, synthetic readiness, zero external/provider calls. No embedding or vector service is queried. Separate disposable database. This is not the live rehearsal.</p>');
server.on('request',(req,res)=>{if(req.url==='/mock-fixture-status'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({mode:'MOCK ONLY',providerNetworkCalls:0,structuredMockCalls:calls,mockRetrievalCalls:retrievalCalls,retrieval:'SIMULATED vector-cosine-v1 fixture; no embedding or vector service queried',plannedBatches}));return;}if(req.url==='/campaign.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);}else listener(req,res);});
return {server,directory};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await mkdir('.tmp',{recursive:true});
 const directory=await mkdtemp(path.join(os.tmpdir(),'cc-mock-review-'));
 const {server}=await createMockReviewServer({directory});
 server.listen(4185,'127.0.0.1',async()=>{await writeFile('.tmp/mock-review-server.json',JSON.stringify({pid:process.pid,directory,port:4185}));console.log('MOCK QA on http://127.0.0.1:4185/campaign.html; simulated vector retrieval and canned model calls only');});
}

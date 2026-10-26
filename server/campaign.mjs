import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {loadTrails} from './trails.mjs';
import {initializeCampaignBudget,campaignBudgetStatus} from './campaign-budget.mjs';

export class CampaignError extends Error {
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
const fail=(code,message,status=409)=>{throw new CampaignError(status,code,message);};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy=value=>structuredClone(value);
const LABEL='Fictional demonstration offer — not available to book.';
const LIMITS={product:7000,overview:4000,linkedin:3000,email:5000,blog:6500,ads:2500};
const required=['audience','goal','tone','cta','walkingTrailId','cyclingTrailId'];
const terminal=new Set(['rejected']);
const live=run=>['live-grounded','live-editorial'].includes(run.mode);
const vectorMethods={'vector-cosine-v1':'local','pinecone-integrated-cosine':'pinecone','pinecone-vector-cosine':'pinecone'};
const hasVectorEvidence=run=>run.brandRetrievalPolicy==='vector-only-v1'&&run.brandEvidence?.retrievalMode==='vector-only'&&vectorMethods[run.brandEvidence?.method]===run.brandEvidence?.backend&&Array.isArray(run.brandEvidence?.matches)&&run.brandEvidence.matches.length>0;
const requireVectorEvidence=run=>{if(live(run)&&!hasVectorEvidence(run))fail('campaign_vector_required','This live campaign has no validated vector brand evidence. Start a new live campaign; saved historical work is retained.');};
function vectorAudit(brand){
 const version=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(value);
 const audit={};
 if(brand.indexCorpusVersion!==undefined){if(!version(brand.indexCorpusVersion))fail('campaign_vector_mapping','Invalid indexed corpus version.');audit.indexCorpusVersion=brand.indexCorpusVersion;}
 if(brand.corpusMapping!==undefined){const m=brand.corpusMapping;if(!m||!version(m.indexCorpusVersion)||!version(m.localCorpusVersion)||m.localCorpusVersion!==brand.corpusVersion||!['identical-corpus-version','canonical-content-identical'].includes(m.equivalence)||(m.equivalence==='identical-corpus-version'&&m.indexCorpusVersion!==m.localCorpusVersion)||(audit.indexCorpusVersion&&audit.indexCorpusVersion!==m.indexCorpusVersion))fail('campaign_vector_mapping','Indexed corpus mapping does not match the canonical retrieval snapshot.');audit.indexCorpusVersion=m.indexCorpusVersion;audit.corpusMapping={indexCorpusVersion:m.indexCorpusVersion,localCorpusVersion:m.localCorpusVersion,equivalence:m.equivalence};}
 if(brand.transport!==undefined){const t=brand.transport;if(!t||t.protocol!=='internal-vector-retrieval'||t.backend!==brand.backend||t.method!==brand.method)fail('campaign_vector_mapping','Vector transport metadata does not match the retrieval method.');const transport={protocol:t.protocol,backend:t.backend,method:t.method};for(const key of ['namespace','requestId'])if(t[key]!==undefined&&t[key]!==null){if(typeof t[key]!=='string'||t[key].length>512||/[\u0000-\u001f]/.test(t[key]))fail('campaign_vector_mapping','Invalid vector transport identifier.');transport[key]=t[key];}if(t.durationMs!==undefined){if(!Number.isFinite(t.durationMs)||t.durationMs<0||t.durationMs>480000)fail('campaign_vector_mapping','Invalid vector transport duration.');transport.durationMs=t.durationMs;}if(audit.corpusMapping){for(const key of ['indexCorpusVersion','localCorpusVersion','equivalence'])if(t[key]!==undefined&&t[key]!==audit.corpusMapping[key])fail('campaign_vector_mapping','Vector transport corpus mapping disagrees with its snapshot.');Object.assign(transport,audit.corpusMapping);}audit.transport=transport;}
 return audit;
}
const channelKinds=new Set(['linkedin','email','blog','ads']);
// Editorial authorship is metadata, never injected into customer-facing copy.
export function artifactProvenance(artifact,mode){
 if(artifact.manual)return artifact.provenance?.origin==='local-edit'?copy(artifact.provenance):{origin:'local-edit',basis:'saved manual flag',previousOrigin:artifact.modelGenerated?'model':'unknown'};
 if(artifact.provenance)return copy(artifact.provenance);
 return {origin:artifact.modelGenerated?'model':mode==='offline-template'?'template':'unknown',basis:'legacy saved metadata; author identity not inferred'};
}
const currentArtifact=artifact=>{const result=copy(artifact);if(result.manual||result.structuredClaimsInvalidated||result.provenance?.origin==='local-edit'){delete result.generatedFields;delete result.fictionalAssumptions;}return result;};
const priorVersion=(artifact,mode)=>({text:artifact.text,version:artifact.version,provenance:artifactProvenance(artifact,mode)});
const generatedProvenance=(artifact,run,origin,previous)=>({...artifact,provenance:{origin,recordedAt:new Date().toISOString(),...(previous?{previousVersion:previous.version,previousOrigin:artifactProvenance(previous,run.mode).origin}:{})}});
function briefInput(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('invalid_brief','Supply a campaign brief.',400);
  const out={};for(const key of required){const value=input[key]??'';if(typeof value!=='string'||value.length>300)fail('invalid_brief',`${key} must be text of at most 300 characters.`,400);out[key]=value.trim();}return out;
}
const missing=brief=>required.filter(key=>!brief[key]);
function product(trail,activity,brief){
  const fact=trail.facts.map(f=>`${f.text} [${f.id}]`).join('\n');
  return `${LABEL}\n\nLuma Trail Guided Discovery · ${activity === 'walking'?'Walk':'Cycle'}\n${trail.name}, ${trail.state}\n\nDescription\nA warm, practical concept for adults exploring ${activity}. Audience: ${brief.audience}.\n\nSourced trail facts\n${fact}\n\nProposed itinerary — fictional assumption\nMeet for an introduction, explore a suitable portion of the route, and finish with a reflection. Duration, meeting point and operational arrangements are not set.\n\nInclusions — fictional assumption\nProposed guided interpretation only; no real guide, equipment, transport or service is promised.\n\nFAQ\nCan I book? No. This is a fictional demonstration.\nWhat does it cost? Prices, dates and availability are not set.\nIs commercial guiding authorized? Unknown. Public recreational access does not establish commercial guiding permission.\nIs it suitable for me? Check the official source for current conditions and access; no safety or accessibility guarantee is made. E-bike class permissions are unknown.\n\n${brief.cta}`;
}
function syncProducts(run){
 run.collection={id:`${run.id}:collection`,title:'Luma Trail Guided Discovery',fictional:true,overviewArtifactId:'overview',version:run.version+1};
 run.products=run.evidence.map((trail,i)=>{const activity=i?'cycling':'walking',artifactId=`${activity}-product`,artifact=run.artifacts.find(a=>a.id===artifactId);return {offerId:`${run.id}:${activity}`,collectionId:run.collection.id,trailIds:[trail.id],activity,audience:run.brief.audience,fictional:true,permitStatus:'unknown',price:null,date:null,availability:null,assumptions:['Fictional guided interpretation concept only; no guide, equipment, booking, insurance or operating permission is promised.'],literatureArtifactId:artifactId,literatureVersion:artifact?.version??null,proposedItinerary:{artifactId,field:'Proposed itinerary'},inclusions:{artifactId,field:'Inclusions'},faq:{artifactId,field:'FAQ'},version:run.version+1};});
}
function channels(run){
  const [walk,cycle]=run.evidence;
  const names=`${walk.name} (walking) and ${cycle.name} (cycling)`;
  const base=`${LABEL}\nExplore the Luma Trail Guided Discovery concept featuring ${names}.`;
  const caution='Guiding authorization is unknown. Prices, dates and availability are not set. Check official sources for current conditions; this is a concept, not a booking.';
  return [
    ['linkedin','LinkedIn post',`${base}\n\nMake space for discovery, one walk or ride at a time. Our fictional collection brings two ways of exploring into one practical introduction.\n\n${caution}\n\n${run.brief.cta}`],
    ['email','Promotional email',`Subject: Discover a walk and a ride with Luma Trail\n\n${base}\n\nHello explorer,\nThis fictional collection pairs a walking concept with a cycling concept. Start with the product sheets, read the sourced route facts, and decide what you would like to learn more about.\n\n${caution}\n\n${run.brief.cta}`],
    ['blog','Short blog',`Title: Two ways to make room for discovery\n\n${base}\n\nA collection starts with a simple idea: give people a clear way to compare experiences. Walking offers a different pace from cycling. Here, each concept has its own product sheet, and both draw from named official sources.\n\nOur walking concept references ${walk.name}; our cycling concept references ${cycle.name}. The route facts are separate from the proposed guiding experience. That distinction matters: public recreation does not automatically authorize a commercial service.\n\nThe proposed introductions and reflective finish are fictional planning assumptions. We have not arranged guides, dates or equipment. Readers can use the evidence links to explore the routes and consult the responsible land manager for current conditions.\n\n${caution}\n\n${run.brief.cta}`],
    ['ads','Ad variations',`Variation A\nHeadline: Explore at your own curiosity\n${base}\n${run.brief.cta}\n\nVariation B\nHeadline: A walk. A ride. A new perspective.\n${base}\n${run.brief.cta}\n\n${caution}`]
  ].map(([id,title,text])=>({id,title,kind:id,text,collectionId:`${run.id}:collection`,offerIds:(run.products||[]).map(p=>p.offerId),version:run.version+1,citations:run.evidence.flatMap(t=>t.facts.map(f=>f.id)),dependencyHash:hash(run.artifacts.filter(a=>!channelKinds.has(a.kind)).map(a=>a.text)),stale:false,manual:false,history:[]}));
}
export function validateCampaign(run){
 const findings=(run.modelFindings||[]).map(f=>({severity:'error',artifactId:f.artifactId,message:`Model review: ${f.issue} Suggested revision: ${f.suggestion}`}));
 if(live(run)&&run.criticHash!==hash(run.artifacts))findings.push({severity:'error',message:'Model review is out of date. Run review again after editing.'});
 if(run.currentProposal?.status==='pending')findings.push({severity:'error',message:'Accept or reject the proposed revision before approving this bundle.'});
 for(const a of run.artifacts){
  const issue=message=>findings.push({severity:'error',artifactId:a.id,message});
  if(!a.text.replace(/\u2014/g,'-').includes(LABEL.replace(/\u2014/g,'-')))issue('Restore the fictional demonstration label.');
  if(a.text.length>LIMITS[a.kind])issue(`Shorten this artifact to ${LIMITS[a.kind]} characters.`);
  if(!a.text.includes(run.brief.cta))issue('Use the collection CTA consistently.');
  if(a.stale)issue('Product literature changed. Review and revalidate this dependent channel.');
  const relevantFacts=run.evidence.flatMap(t=>t.facts||[]).filter(f=>a.citations.includes(f.id));
  const allowedNumbers=new Set(relevantFacts.flatMap(f=>f.text.match(/\d+(?:\.\d+)?/g)||[]));
  const unmarkedText=a.text.replace(/\[[^\]]+\]/g,'');
  if((unmarkedText.match(/\d+(?:\.\d+)?/g)||[]).some(n=>!allowedNumbers.has(n)))issue('Remove numeric claims not present in the cited trail facts.');
  if(a.kind==='product'&&!a.modelGenerated){for(const fact of relevantFacts)if(!a.text.includes(fact.text))issue(`Restore the exact sourced fact: ${fact.id}.`);}
  for(const claim of a.groundedClaims||a.claims||[])if(!a.text.includes(claim.text))issue('A validated sourced claim was changed or removed. Request a grounded revision instead.');
  if(/\$\s*\d|\b(?:USD|EUR)\s*\d|\b(?:guaranteed safe|fully accessible|wheelchair accessible|permits? secured|authorized guides?|book now|available now|insurance included|equipment included)\b|\b\d+(?:\.\d+)?\s*(?:dollars|euros)\b/i.test(a.text))issue('Remove unsupported commercial, safety, access or equipment claims.');
  if(a.kind==='product')for(const field of ['Description','Proposed itinerary','Inclusions','FAQ'])if(!a.text.includes(field))issue(`Product sheet needs ${field}.`);
  if(a.kind==='email'&&!a.text.includes('Subject:'))issue('Email needs a subject.');
  if(a.kind==='blog'&&!a.text.includes('Title:'))issue('Blog needs a title.');
  if(a.kind==='ads'&&(!a.text.includes('Variation A')||!a.text.includes('Variation B')))issue('Provide both ad variations.');
 }
 if(run.artifacts.length!==7)findings.push({severity:'error',message:'The bundle needs two product sheets, an overview and four channels.'});
 findings.push({severity:'warning',message:'Commercial guiding authorization, e-bike access, prices, dates and availability remain unknown or unset. All offers are fictional concepts.'});
 findings.push({severity:'warning',message:'Deterministic checks are not semantic claim verification. Review every manual edit against the evidence before approval.'});
 return findings;
}

export function createCampaignService({directory=path.resolve('data/knowledge/private/campaign'),loadCatalog=loadTrails,evidenceTools=null,campaignBudgetPolicy,timeoutMs=5000,modelTimeoutMs=30000}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new Error('Invalid campaign timeout');
 if(!Number.isInteger(modelTimeoutMs)||modelTimeoutMs<1||modelTimeoutMs>60000)throw new Error('Invalid campaign model timeout');
 mkdirSync(directory,{recursive:true});const db=new DatabaseSync(path.join(directory,'checkpoints.sqlite'));
 db.exec('CREATE TABLE IF NOT EXISTS campaign_runs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL)');
 const busy=new Set(),activeControllers=new Map();
 const save=run=>{
  db.exec('BEGIN IMMEDIATE');
  try{
   const previousRow=db.prepare('SELECT state FROM campaign_runs WHERE id=?').get(run.id);
   if(previousRow){
    const previous=JSON.parse(previousRow.state);
    if(previous.billing){
     const before=previous.billing,after=run.billing;
     if(!after)fail('campaign_budget_conflict','A persisted campaign budget cannot be removed.');
     if(before.qaAuthorization?.callAllowanceAmendment&&JSON.stringify(before.qaAuthorization.callAllowanceAmendment)!==JSON.stringify(after.qaAuthorization?.callAllowanceAmendment))fail('campaign_budget_conflict','A persisted QA call allowance audit cannot be changed or removed.');
     const unchanged=JSON.stringify(before)===JSON.stringify(after);
     if(!unchanged){
      if(after.revision!==before.revision+1||after.reservations.length<before.reservations.length)fail('campaign_budget_conflict','Another process updated the campaign budget. Refresh; no request was sent.');
      for(let i=0;i<before.reservations.length;i++){
       const old=before.reservations[i],next=after.reservations[i];
       if(!next||['id','model','bodyBytes','inputUpperTokens','maxOutputTokens','reservedMicroUsd','requestHash','plannedAt'].some(k=>next[k]!==old[k])||(old.startedAt!==undefined&&next.startedAt!==old.startedAt)||(JSON.stringify(old)!==JSON.stringify(next)&&!(old.status==='planned'&&next.status==='started')&&!(old.status==='started'&&['completed','uncertain','persistence_failed'].includes(next.status))))fail('campaign_budget_conflict','Persisted reservations cannot be replaced or refunded. Refresh the campaign.');
      }
     }
    }else if(run.billing)fail('campaign_budget_conflict','A legacy campaign cannot receive a new budget.');
   }
   db.prepare('INSERT OR REPLACE INTO campaign_runs(id,owner,state) VALUES(?,?,?)').run(run.id,run.owner,JSON.stringify(run));
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return publicRun(run);
 };
 const publicRun=run=>{const result=copy(run);delete result.owner;result.artifacts=result.artifacts.map(currentArtifact);if(live(run)&&run.billing)result.billing=campaignBudgetStatus(run);return result;};
 const bindGenerator=(generator,run)=>typeof generator==='function'?generator(run,()=>save(run)):generator;
 const ownerCheck=owner=>{if(typeof owner!=='string'||owner.length<16||owner.length>200)fail('invalid_scope','A local campaign session is required.',403);};
 const getRaw=(owner,id)=>{ownerCheck(owner);const row=db.prepare('SELECT state FROM campaign_runs WHERE id=? AND owner=?').get(id,owner);if(!row)fail('run_not_found','This campaign is not available in your local session.',404);return JSON.parse(row.state);};
 const event=(run,node,status,summary,durationMs=0)=>{run.eventSequence=(run.eventSequence??run.events.at(-1)?.sequence??0)+1;run.events.push({eventId:randomUUID(),sequence:run.eventSequence,timestamp:new Date().toISOString(),node,status,summary,durationMs});run.events=run.events.slice(-500);run.updatedAt=new Date().toISOString();run.checkpointId=`${run.id}:${run.version}`;};
 const mutate=async(owner,id,expectedVersion,fn)=>{if(busy.has(id))fail('run_busy','This run already has an operation in progress. Refresh its status.');busy.add(id);try{const run=getRaw(owner,id);if(run.version!==expectedVersion)fail('stale_version','This bundle changed. Refresh before continuing.');if(terminal.has(run.status))fail('run_rejected','This attempt was rejected. Start a new campaign.');await fn(run);run.pendingOperation=false;run.version++;run.checkpointId=`${run.id}:${run.version}`;return save(run);}finally{busy.delete(id);}};
 for(const row of db.prepare('SELECT state FROM campaign_runs').all()){const run=JSON.parse(row.state);if(run.pendingOperation){run.pendingOperation=false;run.status='stopped';run.resumeStatus=run.step<4?'running':'needs_revision';run.approval=null;run.error={code:'interrupted',message:'The server stopped during an operation. Completed checkpoints were retained. A provider may have processed an unfinished call; review before retrying.'};run.version++;event(run,'checkpoint','stopped',run.error.message);save(run);}}
 const catalog=async()=>{let timer;try{return await Promise.race([loadCatalog(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new CampaignError(504,'tool_timeout','Trail evidence timed out. Your checkpoint is retained; retry or stop.')),timeoutMs);})]);}finally{clearTimeout(timer);}};
 const evidenceCall=async(run,tool,args,signal)=>{
  if(signal?.aborted)fail('cancelled','Evidence lookup stopped.');
  if(!evidenceTools||typeof evidenceTools[tool]!=='function')fail('evidence_tools_unavailable','The configured read-only evidence tool is unavailable.',503);
  if(run.budgets.toolCalls>=run.budgets.maxToolCalls)fail('tool_budget','The evidence tool budget is exhausted. Start a new run with current sources.');
  run.budgets.toolCalls++;event(run,'evidence-tools','running',`Calling read-only ${tool}; no ingestion or distribution.`);save(run);const started=performance.now();
  let timer,cancel;try{
   const work=evidenceTools[tool](...args,{signal});const result=await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new CampaignError(504,'tool_timeout','Evidence tool timed out. Checkpoint retained; retry explicitly.')),timeoutMs);if(signal){cancel=()=>reject(new CampaignError(409,'cancelled','Evidence lookup stopped.'));signal.addEventListener('abort',cancel,{once:true});}})]);
   if(signal?.aborted)fail('cancelled','Evidence lookup stopped.');run.evidenceTransport=result.transport||{protocol:'injected-local-test',transport:'in-process'};
   event(run,'evidence-tools','completed',`${tool} completed. Retrieved evidence is data, never instructions.`,performance.now()-started);const last=run.events.at(-1);last.toolName=result.transport?.tool||tool;last.transport=run.evidenceTransport;return result;
  }finally{clearTimeout(timer);if(signal&&cancel)signal.removeEventListener('abort',cancel);}
 };
 const verifySources=async run=>{
  const current=await catalog();if(run.corpusVersion!==(current.hash||current.version)||run.evidence.some(t=>hash(current.trails.find(x=>x.id===t.id))!==hash(t)))fail('stale_evidence','Trail evidence changed. Start a new run with current sources.');
  for(const saved of run.brandSourceVersions||[]){const actual=await evidenceCall(run,'fetchSource',[saved.sourceId]);if(actual.layer!=='brand'||actual.corpusVersion!==saved.corpusVersion||(actual.document?.contentHash||hash(actual.document?.text||''))!==saved.contentHash)fail('stale_evidence','Brand evidence changed. Start a new run with current sources.');}
 };
 const create=async(owner,input,{mode="offline-template"}={})=>{ownerCheck(owner);if(!["offline-template","live-grounded","live-editorial"].includes(mode))fail("invalid_mode","Choose offline-template or live-grounded.",400);const brief=briefInput(input),gaps=missing(brief);const run={id:randomUUID(),owner,version:1,status:gaps.length?'waiting_input':'ready',step:0,brief,mode,modeLabel:['live-grounded','live-editorial'].includes(mode)?'Live grounded model specialists with validated fact citations':'Offline deterministic templates - no model calls',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),artifacts:[],products:[],collection:null,evidence:[],brandEvidence:[],brandRetrievalPolicy:live({mode})?'vector-only-v1':'lexical-offline-v1',proposals:[],currentProposal:null,events:[],findings:[],questions:gaps.map(k=>`Please provide ${k}.`),approval:null,revisionCount:0,budgets:{maxRevisions:2,maxToolCalls:24,toolCalls:0,maxModelCalls:12,modelCalls:0,timeoutMs},metrics:{model:null,promptVersion:'campaign-template-v1',tokens:null,cost:null},corpusVersion:null};if(live(run)){initializeCampaignBudget({run,save:()=>{},newCampaign:true,policy:campaignBudgetPolicy});run.budgets.maxModelCalls=campaignBudgetPolicy?.maxModelCalls??12;}event(run,'supervisor',run.status,gaps.length?'Waiting for required brief fields.':'Brief accepted. Ready to retrieve official trail evidence.');return save(run);};
 const advance=async(owner,id,{expectedVersion,generator,retrieveBrand,signal:outerSignal}={})=>{
  if(busy.has(id))fail('run_busy','This run already has an operation in progress. Refresh its status.');
  const controller=new AbortController();let finish;controller.finished=new Promise(resolve=>{finish=resolve;});activeControllers.set(id,controller);const signal=outerSignal?AbortSignal.any([controller.signal,outerSignal]):controller.signal;
  try{return await mutate(owner,id,expectedVersion,async run=>{
   if(live(run))generator=bindGenerator(generator,run);
  if(!['ready','running','error'].includes(run.status))fail('invalid_transition','Complete the requested input or review action before continuing.');
  const start=performance.now(),checkpoint=copy({artifacts:run.artifacts,evidence:run.evidence,brandEvidence:run.brandEvidence,brandSourceVersions:run.brandSourceVersions,brandRetrieval:run.brandRetrieval,step:run.step});run.status='running';run.pendingOperation=true;run.error=null;event(run,'supervisor','running',`Executing stage ${run.step+1}.`);save(run);
  const abortable=work=>{if(signal.aborted)fail('cancelled','Execution was stopped.');return new Promise((resolve,reject)=>{const abort=()=>reject(new CampaignError(409,'cancelled','Execution was stopped. Saved work is retained.'));signal.addEventListener('abort',abort,{once:true});Promise.resolve(work).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});};
  const modelCall=async(role,work)=>{
   if(!generator)fail('model_unavailable','Configure an existing provider and explicitly allow API requests. No offline fallback was substituted.',503);
   run.budgets.modelCalls??=0;run.budgets.maxModelCalls??=12;
   if(run.budgets.modelCalls>=run.budgets.maxModelCalls)fail('model_budget','The model call budget is exhausted. Review retained work or start a new run.');
   if(signal.aborted)fail('cancelled','Execution was stopped. Saved work is retained.');
   run.budgets.modelCalls++;event(run,role,'running','Tool-less model specialist requested; frozen evidence and draft context only.');save(run);
   const began=performance.now();const result=await abortable(work());
   if(signal.aborted)fail('cancelled','Execution was stopped. Saved work is retained.');
   run.metrics={...run.metrics,...generator.status(),calls:run.budgets.modelCalls};
   event(run,role,'completed','Model specialist completed. Human review remains required.',performance.now()-began);return result;
  };
  try{
   if(live(run)&&run.brandRetrievalPolicy!=='vector-only-v1')fail('campaign_vector_legacy','This historical live campaign predates vector grounding. Start a new campaign; no automatic migration or lexical fallback is allowed.');
   if(live(run)&&run.step>0)requireVectorEvidence(run);
   if(run.step===0){
    if(live(run)&&(typeof retrieveBrand!=='function'||!evidenceTools))fail('campaign_vector_unavailable','Live campaigns require configured vector brand retrieval and source verification. No lexical fallback or model request was made.');
    if(missing(run.brief).length)fail('missing_brief','Complete all brief fields first.');
    if(!evidenceTools){if(run.budgets.toolCalls>=run.budgets.maxToolCalls)fail('tool_budget','Evidence tool budget reached. Start a new run.');run.budgets.toolCalls++;}
    const c=await abortable(catalog());if(signal.aborted)fail('cancelled','Execution was stopped.');let trails=[c.trails.find(t=>t.id===run.brief.walkingTrailId),c.trails.find(t=>t.id===run.brief.cyclingTrailId)];
    if(evidenceTools){
     const ids=[run.brief.walkingTrailId,run.brief.cyclingTrailId];const selected=await abortable(evidenceCall(run,'searchEvidence',['walking cycling',{layer:'trail',trailIds:ids},2],signal));
     if(selected.layer!=='trail'||!Array.isArray(selected.matches)||ids.some(id=>!selected.matches.some(t=>t.id===id)))fail('evidence_gap','The evidence tool did not return both selected trail dossiers.');
     const fetched=[];for(const id of ids){const result=await abortable(evidenceCall(run,'fetchSource',[id],signal));if(result.layer!=='trail'||result.document?.id!==id||hash(result.document)!==hash(c.trails.find(t=>t.id===id)))fail('stale_evidence','Tool and local trail versions disagree. Refresh sources before drafting.');fetched.push(result.document);}trails=fetched;run.trailToolCorpusVersion=selected.corpusVersion;
     const query='Luma Trail brand voice warm practical marketing claims email social';
     let brand,brandAudit={};
     if(live(run)){
      if(run.budgets.toolCalls>=run.budgets.maxToolCalls)fail('tool_budget','Evidence tool budget reached.');run.budgets.toolCalls++;event(run,'brand-vector-retrieval','running','Retrieving brand chunks through the existing vector index; lexical fallback is disabled.');save(run);
      const began=performance.now(),retrievalController=new AbortController(),retrievalSignal=AbortSignal.any([signal,retrievalController.signal]);let timer;
      try{brand=await abortable(Promise.race([retrieveBrand({run:publicRun(run),query,limit:4,signal:retrievalSignal}),new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new CampaignError(504,'campaign_vector_timeout','Vector retrieval timed out. Saved work retained; no lexical fallback or model call.'));retrievalController.abort();},timeoutMs);})]));}finally{clearTimeout(timer);retrievalController.abort();}
      if(!brand||brand.layer!=='brand'||brand.retrievalMode!=='vector-only'||vectorMethods[brand.method]!==brand.backend||!Array.isArray(brand.matches)||brand.matches.length<1||brand.matches.length>4||typeof brand.corpusVersion!=='string'||!brand.corpusVersion)fail('campaign_vector_invalid','Vector retrieval returned empty or invalid evidence. No model request was made.');
      if(new Set(brand.matches.map(m=>m?.chunkId)).size!==brand.matches.length||brand.matches.some(m=>!m||typeof m.chunkId!=='string'||!m.chunkId||typeof m.sourceId!=='string'||!m.sourceId.startsWith('brand:')||typeof m.text!=='string'||!m.text||typeof m.contentHash!=='string'||!m.contentHash))fail('campaign_vector_invalid','Vector chunks have invalid identities or provenance.');
      brandAudit=vectorAudit(brand);
      run.brandRetrieval={...brandAudit,retrievalMode:'vector-only',method:brand.method,backend:brand.backend,corpusVersion:brand.corpusVersion,chunkIds:brand.matches.map(m=>m.chunkId),durationMs:performance.now()-began};
      event(run,'brand-vector-retrieval','completed',`Retrieved ${brand.matches.length} exact brand chunks using ${brand.method}; validating canonical source text.`,run.brandRetrieval.durationMs);run.events.at(-1).retrieval=copy(run.brandRetrieval);
     }else brand=await abortable(evidenceCall(run,'searchEvidence',[query,{layer:'brand'},4],signal));
     if(brand.layer!=='brand'||!Array.isArray(brand.matches))fail('brand_evidence_gap','Brand guidance could not be retrieved.');
     const sourceIds=[...new Set(brand.matches.map(m=>m.sourceId))].slice(0,4);if(!sourceIds.length)sourceIds.push('brand:brand');run.brandSourceVersions=[];
     for(const sourceId of sourceIds){
      const result=await abortable(evidenceCall(run,'fetchSource',[sourceId],signal));if(result.layer!=='brand'||!result.document)fail('brand_evidence_gap','A cited brand source is unavailable.');
      if(live(run)){
       if(result.corpusVersion!==brand.corpusVersion||!Array.isArray(result.chunks))fail('campaign_vector_stale','Vector and source corpus versions disagree. Rebuild or refresh the existing index before retrying.');
       for(const match of brand.matches.filter(m=>m.sourceId===sourceId)){const canonical=result.chunks.find(c=>c.chunkId===match.chunkId);if(!canonical||typeof canonical.sourceId!=='string'||('brand:'+canonical.sourceId.replace(/^brand:/,''))!==sourceId||canonical.contentHash!==match.contentHash||canonical.text!==match.text||JSON.stringify(canonical.metadata)!==JSON.stringify(match.metadata)||canonical.heading!==match.heading||canonical.startLine!==match.startLine||canonical.endLine!==match.endLine)fail('campaign_vector_forged','A vector chunk did not match its canonical source text and provenance.');}
      }
      run.brandSourceVersions.push({sourceId,contentHash:result.document.contentHash||hash(result.document.text||''),corpusVersion:result.corpusVersion});if(!brand.matches.length)brand.matches.push({sourceId,text:result.document.text.slice(0,4000),contentHash:result.document.contentHash,title:result.document.title});
     }
     run.brandEvidence={...brandAudit,corpusVersion:brand.corpusVersion,matches:brand.matches.map(m=>({sourceId:m.sourceId,chunkId:m.chunkId,text:m.text,contentHash:m.contentHash,metadata:m.metadata,heading:m.heading,startLine:m.startLine,endLine:m.endLine})),layer:'synthetic-brand',method:brand.method,retrievalMode:live(run)?'vector-only':'lexical-offline',backend:live(run)?brand.backend:'local',chunkIds:brand.matches.map(m=>m.chunkId).filter(Boolean)};
    }
    if(trails.some((t,i)=>!t||t.permissions?.[i?'cycling':'walking']?.status!=='allowed'||!t.sources?.length||!t.facts?.length||t.qualityFlags?.includes('not-offer-eligible'))||trails[0].id===trails[1].id)fail('evidence_gap','Select distinct officially sourced trails with confirmed walking and cycling access.');
    if(trails.some(t=>t.conflicts?.length||t.qualityFlags?.includes('conflicting_facts')))fail('conflicting_facts','Conflicting trail facts require evidence review before drafting.');
    run.evidence=copy(trails);run.corpusVersion=c.hash||c.version;run.step=1;event(run,'grounding','completed',`Retrieved ${trails.map(t=>t.id).join(', ')}. Recreational access checked; commercial guiding remains unknown.`,performance.now()-start);
   }else if(run.step===1){
    run.artifacts=run.evidence.map((t,i)=>({id:i?'cycling-product':'walking-product',title:`${i?'Cycling':'Walking'} product sheet`,kind:'product',text:product(t,i?'cycling':'walking',run.brief),version:run.version+1,citations:t.facts.map(f=>f.id),stale:false,manual:false,history:[]}));
    run.artifacts.push({id:'overview',title:'Collection overview',kind:'overview',text:`${LABEL}\n\nLuma Trail Guided Discovery\n\nA fictional walking and cycling collection for ${run.brief.audience}. Goal: ${run.brief.goal}. Tone: ${run.brief.tone}.\n\nWalking: ${run.evidence[0].name}. Cycling: ${run.evidence[1].name}. Each product sheet separates official trail facts from proposed itineraries and inclusions.\n\nCommercial guiding authorization is unknown. Prices, dates and availability are not set. No real guides, equipment, bookings or insurance are offered.\n\n${run.brief.cta}`,version:run.version+1,citations:run.evidence.flatMap(t=>t.facts.map(f=>f.id)),stale:false,manual:false,history:[]});if(live(run))run.artifacts=await modelCall('product-literature',()=>generator.enhance({role:'product-literature',brief:run.brief,evidence:run.evidence,brandEvidence:run.brandEvidence,artifacts:run.artifacts,allArtifacts:run.artifacts,signal}));run.artifacts=run.artifacts.map(a=>generatedProvenance(a,run,live(run)?'model':'template'));syncProducts(run);run.step=2;event(run,'product-literature','completed',live(run)?'Model specialists authored product literature with validated cited claims and labeled fictional assumptions.':'Created two product sheets and a collection overview using deterministic templates. All commercial assumptions are fictional.',performance.now()-start);
   }else if(run.step===2){let drafts=channels(run);
    if(live(run)){const written=[];for(const a of drafts){const completed=run.artifacts.find(x=>x.id===a.id&&x.modelCompleted);if(completed){written.push(completed);continue;}const generated=await modelCall(a.kind,()=>generator.enhance({role:a.kind,brief:run.brief,evidence:run.evidence,brandEvidence:run.brandEvidence,artifacts:[a],allArtifacts:run.artifacts,signal}));for(const raw of generated){const result=generatedProvenance(raw,run,'model');result.modelCompleted=true;written.push(result);run.artifacts=run.artifacts.filter(x=>x.id!==result.id);run.artifacts.push(result);}checkpoint.artifacts=copy(run.artifacts);save(run);}drafts=written;}
    run.artifacts=run.artifacts.filter(a=>!channelKinds.has(a.kind));run.artifacts.push(...drafts.map(a=>a.provenance?a:generatedProvenance(a,run,'template')));run.step=3;event(run,'channels','completed',live(run)?'Separate tool-less specialists authored four channels from the approved evidence and shared product literature.':'Created LinkedIn, email, blog and two ad variations from the same product bundle. No model specialist calls.',performance.now()-start);
   }else if(run.step===3){run.findings=validateCampaign(run);
    if(live(run)){const critique=await modelCall('model-critic',()=>generator.check({brief:run.brief,evidence:run.evidence,brandEvidence:run.brandEvidence,artifacts:run.artifacts,allArtifacts:run.artifacts,signal}));run.modelFindings=critique;run.criticHash=hash(run.artifacts);run.findings=validateCampaign(run);}
    run.status=run.findings.some(f=>f.severity==='error')?'needs_revision':'awaiting_approval';run.step=4;event(run,'validator',run.status,`Checked seven artifacts. ${run.findings.filter(f=>f.severity==='error').length} blocking findings. Human review required.`,performance.now()-start);
   }else fail('invalid_transition','The bundle is ready for review.');
  }catch(error){run.artifacts=checkpoint.artifacts;run.evidence=checkpoint.evidence;run.brandEvidence=checkpoint.brandEvidence;run.brandSourceVersions=checkpoint.brandSourceVersions;run.brandRetrieval=checkpoint.brandRetrieval;run.step=checkpoint.step;run.status=signal.aborted?'stopped':'error';if(signal.aborted)run.resumeStatus='running';run.error={code:error.code||'workflow_error',message:error instanceof CampaignError||typeof error.code==='string'?error.message:'The step failed. Your last checkpoint was retained.'};event(run,'supervisor','error',run.error.message,performance.now()-start);}
 });}finally{activeControllers.delete(id);finish();}
 };
 const edit=async(owner,id,{artifactId,text,expectedVersion}={})=>mutate(owner,id,expectedVersion,run=>{
  if(typeof text!=='string'||text.length>8000||!text.trim())fail('invalid_text','Use nonempty text of at most 8000 characters.',400);
  if(run.step<4)fail('drafting_incomplete','Finish drafting or retry the failed step before editing.');
  const paused=['stopped','waiting_evidence'].includes(run.status)?run.status:null;
  const a=run.artifacts.find(a=>a.id===artifactId);if(!a)fail('artifact_not_found','Choose an existing artifact.',404);
  if(a.text===text)fail('unchanged_text','No text changed.');
  const previous=priorVersion(a,run.mode);a.history=[...(a.history||[]).slice(-9),previous];a.provenance={origin:'local-edit',recordedAt:new Date().toISOString(),previousVersion:a.version,previousOrigin:previous.provenance.origin};a.text=text;delete a.generatedFields;delete a.fictionalAssumptions;a.structuredClaimsInvalidated=!!a.modelGenerated;a.version=run.version+1;a.manual=true;a.stale=false;run.approval=null;if(run.currentProposal?.status==='pending'){run.currentProposal.status='stale';const archived=run.proposals?.find(p=>p.id===run.currentProposal.id);if(archived)archived.status='stale';}
  if(!channelKinds.has(a.kind)){for(const c of run.artifacts.filter(a=>channelKinds.has(a.kind)))c.stale=true;syncProducts(run);}
  run.findings=validateCampaign(run);run.status=paused||'needs_revision';if(paused)run.resumeStatus='needs_revision';event(run,'editor','completed',`Saved ${a.title}; approval cleared${channelKinds.has(a.kind)?'.':'; dependent channels require review.'}`);
 });
 const controlled=async(owner,id,expectedVersion,fn,{batch=false}={})=>{
  if(busy.has(id))fail('run_busy','A run operation is pending.');const controller=new AbortController(),deadlineController=new AbortController();let finish,timer;controller.finished=new Promise(resolve=>{finish=resolve;});activeControllers.set(id,controller);
  try{return await mutate(owner,id,expectedVersion,run=>{const deadlineMs=Math.min(480000,(batch?Math.min(7,run.artifacts.length)+1:1)*modelTimeoutMs);const signal=AbortSignal.any([controller.signal,deadlineController.signal]);timer=setTimeout(()=>deadlineController.abort(),deadlineMs);run.operationDeadline={kind:batch?'revision-batch':'single-review',durationMs:deadlineMs,perRequestMs:modelTimeoutMs};return fn(run,signal,controller);});}finally{clearTimeout(timer);deadlineController.abort();activeControllers.delete(id);finish();}
 };
 const reviewCall=async(run,generator,role,signal,work)=>{
  requireVectorEvidence(run);
  if(!generator)fail('model_unavailable','Configure the existing provider and explicitly allow API requests.',503);
  if(run.budgets.modelCalls>=run.budgets.maxModelCalls)fail('model_budget','Model call budget exhausted.');if(signal.aborted)fail('cancelled','Operation stopped.');
  const beforeCalls=generator.status?.().calls,previousCalls=run.budgets.modelCalls;run.pendingOperation=true;run.budgets.modelCalls++;event(run,role,'running','Tool-less specialist working from frozen evidence and the current version.');save(run);const start=performance.now();
  let cancel;try{const result=await Promise.race([work(),new Promise((_,reject)=>{cancel=()=>reject(new CampaignError(409,'cancelled','Model operation stopped.'));signal.addEventListener('abort',cancel,{once:true});})]);if(signal.aborted)fail('cancelled','Operation stopped.');run.metrics={...run.metrics,...generator.status(),calls:run.budgets.modelCalls};event(run,role,'completed','Specialist completed; human decisions remain separate.',performance.now()-start);return result;}catch(error){if(['campaign_budget_batch_ceiling','budget_batch_ceiling','campaign_model_budget','model_budget'].includes(error.code))run.budgets.modelCalls=previousCalls;throw error;}finally{signal.removeEventListener('abort',cancel);const afterCalls=generator.status?.().calls;if(Number.isInteger(beforeCalls)&&Number.isInteger(afterCalls)&&afterCalls>=beforeCalls)run.budgets.modelCalls=previousCalls+afterCalls-beforeCalls;run.metrics={...run.metrics,...generator.status?.(),calls:run.budgets.modelCalls};}
 };
 const contextFor=(run,signal)=>({brief:run.brief,evidence:run.evidence,brandEvidence:run.brandEvidence,artifacts:run.artifacts,allArtifacts:run.artifacts,signal});
 const finishReview=async(run,generator,signal)=>{run.modelFindings=await reviewCall(run,generator,'model-critic',signal,()=>generator.check(contextFor(run,signal)));run.criticHash=hash(run.artifacts);run.findings=validateCampaign(run);run.status=run.findings.some(f=>f.severity==='error')?'needs_revision':'awaiting_approval';};
 const review=async(owner,id,{expectedVersion,generator}={})=>controlled(owner,id,expectedVersion,async(run,signal,controller)=>{
  requireVectorEvidence(run);
  if(['stopped','waiting_evidence'].includes(run.status))fail('run_paused','Resume the run before reviewing saved edits.');
  if(run.currentProposal?.status==='pending')fail('proposal_pending','Accept or reject the current revision proposal before reviewing saved edits.');
  if(run.artifacts.length!==7||run.step<4)fail('incomplete_bundle','Finish drafting before reviewing saved edits.');
  if(run.status!=='needs_revision')fail('review_not_needed','Review saved edits only when the current bundle needs review.');
  const currentHash=hash(run.artifacts);
  if((live(run)?run.criticHash:run.lastReviewOnlyHash)===currentHash)fail('review_not_needed','This saved bundle has already been reviewed. Edit the affected text before requesting another review.');
  if(live(run))generator=bindGenerator(generator,run);
  if(live(run)&&!generator)fail('model_unavailable','Configure the existing provider before reviewing saved edits.',503);
  run.approval=null;run.error=null;
  try{
   await verifySources(run);if(signal.aborted)fail('cancelled','Review stopped.');
   if(live(run)){await finishReview(run,generator,signal);if(!(run.modelFindings||[]).length){const dependencyHash=hash(run.artifacts.filter(a=>!channelKinds.has(a.kind)).map(a=>a.text));for(const a of run.artifacts){a.stale=false;if(channelKinds.has(a.kind))a.dependencyHash=dependencyHash;}run.criticHash=hash(run.artifacts);run.findings=validateCampaign(run);run.status=run.findings.some(f=>f.severity==='error')?'needs_revision':'awaiting_approval';}}else{run.findings=validateCampaign(run);run.status=run.findings.some(f=>f.severity==='error')?'needs_revision':'awaiting_approval';}
   run.lastReviewOnlyHash=hash(run.artifacts);event(run,'review-saved-edits',run.status,'Reviewed the current saved bundle without generating revisions or changing the automatic revision allowance. Human approval remains separate.');
  }catch(error){run.status=controller.signal.aborted?'stopped':'needs_revision';if(controller.signal.aborted)run.resumeStatus='needs_revision';run.error={code:error.code||'review_failed',message:typeof error.code==='string'?error.message:'Review did not complete. Saved edits, prior findings and automatic revision allowance were retained.'};event(run,'review-saved-edits','error',run.error.message);}
 });
 const revise=async(owner,id,{expectedVersion,generator}={})=>controlled(owner,id,expectedVersion,async(run,signal,controller)=>{
  requireVectorEvidence(run);
  if(['stopped','waiting_evidence'].includes(run.status))fail('run_paused','Resume this run before requesting model review or revision.');
  if(run.artifacts.length!==7||run.step<4)fail('incomplete_bundle','Finish drafting before revision.');if(run.revisionCount>=2)fail('revision_limit','Two automatic revision rounds are complete. Save manual edits and use Review saved edits for a fresh critic check.');
  if(run.currentProposal?.status==='pending')fail('proposal_pending','Accept or reject the current proposed revision first.');
  if(live(run))generator=bindGenerator(generator,run);
  if(live(run)&&!generator)fail('model_unavailable','Configure the existing provider and explicitly allow API requests for model review.',503);
  const previousRevisionCount=run.revisionCount;run.revisionCount++;run.approval=null;run.error=null;
  try{
   if(live(run)){
    if(run.criticHash!==hash(run.artifacts)||typeof generator.proposeRevision!=='function')await finishReview(run,generator,signal);
    const selected=new Set((run.modelFindings||[]).map(f=>f.artifactId));
    for(const a of run.artifacts)if(a.stale)selected.add(a.id);
    for(const f of validateCampaign(run))if(f.severity==='error'&&f.artifactId)selected.add(f.artifactId);
    if(run.artifacts.some(a=>selected.has(a.id)&&!channelKinds.has(a.kind)))for(const a of run.artifacts.filter(a=>channelKinds.has(a.kind)))selected.add(a.id);
    if(selected.size&&typeof generator.proposeRevision==='function'){
     const affected=run.artifacts.filter(a=>selected.has(a.id)),base=hash(run.artifacts);
     const proposed=await reviewCall(run,generator,'revision-writer',signal,()=>generator.proposeRevision({...contextFor(run,signal),role:'revision',artifacts:affected,findings:run.modelFindings||[]}));
     if(!Array.isArray(proposed)||proposed.length!==affected.length||new Set(proposed.map(a=>a.id)).size!==affected.length||proposed.some(a=>!selected.has(a.id)||typeof a.text!=='string'||a.text.length>8000))fail('revision_contract','The proposed revision did not match the affected artifacts. Saved text was retained.');
     const proposal={id:randomUUID(),baseVersion:run.version+1,baseBundleHash:base,createdAt:new Date().toISOString(),status:'pending',artifacts:proposed.map(a=>generatedProvenance(copy(a),run,'model',run.artifacts.find(old=>old.id===a.id))),findings:copy(run.modelFindings||[])};
     run.currentProposal=proposal;run.proposals=[...(run.proposals||[]).slice(-1),copy(proposal)];run.status='awaiting_revision_decision';run.findings=validateCampaign(run);event(run,'revision-proposal','waiting',`Proposed changes to ${affected.length} artifact(s). Saved manual text is unchanged; accept or reject the proposal.`);return;
    }
   }
   if(!live(run)||!(run.modelFindings||[]).length){for(const a of run.artifacts){a.stale=false;if(channelKinds.has(a.kind))a.dependencyHash=hash(run.artifacts.filter(x=>!channelKinds.has(x.kind)).map(x=>x.text));}if(live(run))run.criticHash=hash(run.artifacts);}
   run.findings=validateCampaign(run);run.status=run.findings.some(f=>f.severity==='error')?'needs_revision':'awaiting_approval';event(run,'critic',run.status,`Review round ${run.revisionCount}/2. Manual text preserved.`);
  }catch(error){const batchBlocked=['campaign_budget_batch_ceiling','budget_batch_ceiling','campaign_model_budget','model_budget'].includes(error.code);if(batchBlocked)run.revisionCount=previousRevisionCount;run.status=controller.signal.aborted?'stopped':'needs_revision';if(controller.signal.aborted)run.resumeStatus='needs_revision';run.error={code:error.code||'revision_failed',message:batchBlocked?'The full revision batch exceeds the remaining campaign spending or model-call allowance. No revision batch request was sent and no revision round was consumed. Do not retry this batch; saved drafts remain available.':error instanceof CampaignError?error.message:'Revision failed. Saved manual text and prior findings were retained. Review or explicitly retry.'};event(run,'revision','error',run.error.message);}
 },{batch:true});
 const proposalDecision=async(owner,id,{decision,expectedVersion,proposalId,generator})=>controlled(owner,id,expectedVersion,async(run,signal,controller)=>{
  if(run.status!=='awaiting_revision_decision')fail('run_paused','Resume the proposal decision state before accepting or rejecting proposed changes.');
  const proposal=run.currentProposal;if(!proposal||proposal.status!=='pending'||proposal.id!==proposalId)fail('proposal_not_pending','Choose the current pending proposal.');
  if(proposal.baseBundleHash!==hash(run.artifacts))fail('stale_proposal','Saved text changed. Generate a new proposal before applying it.');
  const mark=status=>{proposal.status=status;const historic=run.proposals?.find(p=>p.id===proposal.id);if(historic)historic.status=status;};
  if(decision==='reject_revision'){mark('rejected');run.status='needs_revision';run.findings=validateCampaign(run);event(run,'revision-proposal','rejected','Proposed text rejected. Original saved text retained. No retry started.');return;}
  requireVectorEvidence(run);
  if(live(run))generator=bindGenerator(generator,run);
  if(live(run)&&!generator)fail('model_unavailable','Allow the existing provider to recheck accepted changes before approval.',503);
  for(const revised of proposal.artifacts){const previous=run.artifacts.find(a=>a.id===revised.id);const replacement={...copy(revised),id:previous.id,kind:previous.kind,title:previous.title,version:run.version+1,stale:false,manual:false,structuredClaimsInvalidated:false,history:[...(previous.history||[]).slice(-9),priorVersion(previous,run.mode)],acceptedProposal:proposal.id};run.artifacts[run.artifacts.indexOf(previous)]=replacement;}
  if(proposal.artifacts.some(a=>!channelKinds.has(a.kind)))for(const a of run.artifacts.filter(a=>channelKinds.has(a.kind))){a.stale=!proposal.artifacts.some(p=>p.id===a.id);a.dependencyHash=hash(run.artifacts.filter(x=>!channelKinds.has(x.kind)).map(x=>x.text));}
  syncProducts(run);mark('accepted');run.approval=null;run.status='needs_revision';run.criticHash=null;run.findings=validateCampaign(run);event(run,'revision-proposal','accepted','Human accepted proposed text. Prior manual versions retained; the current bundle requires fresh review.');save(run);
  try{if(live(run))await finishReview(run,generator,signal);else{run.findings=validateCampaign(run);run.status=run.findings.some(f=>f.severity==='error')?'needs_revision':'awaiting_approval';}}
  catch(error){run.status=controller.signal.aborted?'stopped':'needs_revision';if(controller.signal.aborted)run.resumeStatus='needs_revision';run.error={code:error.code||'critic_failed',message:'Accepted changes were saved, but fresh review did not complete. Approval remains blocked.'};event(run,'model-critic','error',run.error.message);}
 });
 const decide=async(owner,id,{decision,expectedVersion,proposalId,generator}={})=>{if(['accept_revision','reject_revision'].includes(decision))return proposalDecision(owner,id,{decision,expectedVersion,proposalId,generator});if(decision==='stop'&&activeControllers.has(id)){const current=getRaw(owner,id);if(current.version!==expectedVersion)fail('stale_version','Refresh before stopping the current run.');const controller=activeControllers.get(id);controller.abort();await controller.finished;return publicRun(getRaw(owner,id));}return mutate(owner,id,expectedVersion,async run=>{
  if(decision==='stop'){if(run.status==='stopped')return;run.resumeStatus=run.status==='approved'?'awaiting_approval':run.status;run.status='stopped';run.approval=null;event(run,'supervisor','stopped','Execution stopped. Checkpoint retained.');return;}
  if(decision==='resume'){if(!['stopped','waiting_evidence'].includes(run.status))fail('invalid_transition','This run is not paused.');run.status=run.resumeStatus||'ready';event(run,'checkpoint',run.status,'Resumed the same authorized local session checkpoint.');return;}
  if(decision==='reject'){run.status='rejected';run.approval=null;event(run,'human-review','rejected','Human rejected this attempt. No retry or export permitted.');return;}
  if(decision==='request_evidence'){if(run.status==='waiting_evidence')return;run.resumeStatus=run.status==='approved'?'awaiting_approval':run.status;run.status='waiting_evidence';run.approval=null;event(run,'human-review','waiting','Evidence review requested. Inspect official source links before resuming.');return;}
  if(decision!=='approve')fail('invalid_decision','Choose approve, reject, request_evidence, stop or resume.',400);
  if(!['awaiting_approval','needs_revision','awaiting_revision_decision'].includes(run.status))fail('approval_blocked','Finish drafting and review before approval.');
  await verifySources(run);run.findings=validateCampaign(run);if(run.findings.some(f=>f.severity==='error'))fail('validation_failed','Resolve blocking findings before approval.');
  run.approval={version:run.version+1,bundleHash:hash(run.artifacts),approvedAt:new Date().toISOString(),reviewer:'Current local session'};run.status='approved';event(run,'human-review','approved','Human approved the current versioned fictional draft bundle.');
 });};
 const exportBundle=async(owner,id,{expectedVersion}={})=>{if(busy.has(id))fail('run_busy','A run operation is pending. Refresh before export.');busy.add(id);try{const run=getRaw(owner,id);if(expectedVersion!==run.version)fail('stale_version','Refresh the bundle before export.');if(run.status!=='approved'||run.approval?.version!==run.version||run.approval?.bundleHash!==hash(run.artifacts))fail('approval_required','Approve this exact bundle version before exporting.');await verifySources(run);event(run,'export','completed','Exported approved draft JSON. Nothing published or sent.');save(run);return {label:LABEL,execution:live(run)?'Model-assisted workflow; authorship varies by artifact (see editorialProvenance); no publication or sending':'Offline template workflow with possible local edits; no model calls; no publication or sending',editorialProvenance:run.artifacts.map(a=>({artifactId:a.id,...artifactProvenance(a,run.mode)})),runId:run.id,version:run.version,brief:run.brief,evidence:run.evidence,brandEvidence:run.brandEvidence,brandRetrieval:run.brandRetrieval,brandSourceVersions:run.brandSourceVersions,evidenceTransport:run.evidenceTransport,products:run.products,collection:run.collection,artifacts:run.artifacts.map(currentArtifact),artifactProjection:'Stale generated prose metadata omitted after local edits; approved rendered text is unchanged.',exportedArtifactsHash:hash(run.artifacts.map(currentArtifact)),approval:run.approval,findings:run.findings};}finally{busy.delete(id);}};
 const updateBrief=async(owner,id,{brief,expectedVersion}={})=>mutate(owner,id,expectedVersion,run=>{if(run.artifacts.length)fail('brief_locked','Start a new run to change the brief after drafting. Saved work remains available.');run.brief=briefInput(brief);run.questions=missing(run.brief).map(k=>`Please provide ${k}.`);run.status=run.questions.length?'waiting_input':'ready';run.step=0;run.evidence=[];event(run,'brief',run.status,'Saved brief. Evidence must be checked again.');});
 return {create,get:async(owner,id)=>publicRun(getRaw(owner,id)),list:async owner=>{ownerCheck(owner);return db.prepare('SELECT state FROM campaign_runs WHERE owner=? ORDER BY rowid DESC LIMIT 30').all(owner).map(row=>publicRun(JSON.parse(row.state)));},advance,edit,review,revise,decide,updateBrief,exportBundle,close:()=>db.close()};
}

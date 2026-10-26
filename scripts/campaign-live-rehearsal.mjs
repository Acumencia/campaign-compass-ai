import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createCampaignService} from '../server/campaign.mjs';
import {createCampaignGeneration} from '../server/campaign-generation.mjs';
import {createEvidenceTools} from '../server/evidence-mcp-client.mjs';
import {createKeyStore} from '../server/key-store.mjs';

export const REHEARSAL_POLICY=Object.freeze({model:'claude-opus-5-5',provider:'anthropic',maxCalls:8,maxOutputTokens:2048,maxSpendUsd:2,inputUsdPerMillion:4,outputUsdPerMillion:20,maxRequestBytes:45000,framingTokenAllowance:4096,priceVerifiedAt:'2026-10-24',priceSource:'https://platform.claude.com/docs/en/models/opus-5-5/overview'});
export const REHEARSAL_BRIEF=Object.freeze({audience:'Adults seeking guided walking and cycling inspiration',goal:'Awareness and inquiries for a fictional collection',tone:'Warm and practical',cta:'Explore the demo collection',walkingTrailId:'nps-ever-anhinga',cyclingTrailId:'nps-ever-shark-valley'});
const problem=(code,message)=>Object.assign(new Error(message),{code});
export function createRehearsalBudget({execute=false,budgetUsd,fetcher=globalThis.fetch,maxOutputTokens=2048,priorRecords=[]}={}){
 if(execute&&(!Number.isFinite(budgetUsd)||budgetUsd<=0||budgetUsd>2))throw problem('explicit_budget_required','Live execution requires an explicit positive --max-spend-usd no greater than 2.');
 if(![2048,6144].includes(maxOutputTokens))throw problem('invalid_output_cap','Unsupported transient output cap.');
 const cap=execute?budgetUsd:2,records=structuredClone(priorRecords);let reserved=records.reduce((sum,r)=>sum+r.reservedUpperUsd,0),uncertain=records.some(r=>r.outcome==='uncertain-no-retry');
 if(records.length>8||!Number.isFinite(reserved)||reserved>cap||records.some(r=>!Number.isFinite(r.reservedUpperUsd)||r.reservedUpperUsd<=0))throw problem('invalid_ledger','Invalid prior reservations.');
 const reserve=body=>{
  if(uncertain)throw problem('outcome_uncertain','An earlier provider outcome is uncertain; no further calls or retries are allowed.');
  const keys=['model','system','messages','output_config','max_tokens','stream'];
  if(!body||Object.keys(body).length!==keys.length||Object.keys(body).some(k=>!keys.includes(k))||typeof body.system!=='string'||!Array.isArray(body.messages)||body.messages.length!==1||body.messages[0]?.role!=='user'||typeof body.messages[0]?.content!=='string'||Object.keys(body.messages[0]).some(k=>!['role','content'].includes(k))||Object.keys(body.output_config||{}).join(',')!=='format'||body.output_config?.format?.type!=='json_schema')throw problem('unpriced_request','Only the reviewed plain-text request shape is permitted; pricing modifiers, caching and other features are blocked.');
  if(body.model!==REHEARSAL_POLICY.model||body.max_tokens!==maxOutputTokens||body.stream!==false||body.tools||body.thinking||body.service_tier||body.cache_control)throw problem('unpriced_request','Only the pinned model, standard nonstreaming text generation and 2048 output tokens are permitted.');
  if(records.length>=8)throw problem('call_budget','Eight model calls have already been reserved.');
  const bytes=Buffer.byteLength(JSON.stringify(body),'utf8');
  if(bytes>45000)throw problem('request_size_budget','The request exceeds the conservative priced input cap. No request sent.');
  const inputTokenUpper=bytes+4096,upperUsd=inputTokenUpper*4/1e6+maxOutputTokens*20/1e6;
  if(reserved+upperUsd>cap)throw problem('spend_budget','The next full input/output reservation exceeds the approved spending ceiling. No request sent.');
  const record={call:records.length+1,inputBytes:bytes,inputTokenUpper,outputTokenCap:maxOutputTokens,reservedUpperUsd:Number(upperUsd.toFixed(6)),outcome:execute?'reserved':'dry-run-only',usage:null};records.push(record);reserved+=upperUsd;return record;
 };
 async function guardedFetch(url,options){
  if(!execute)throw problem('dry_run_network_blocked','Dry run never permits network requests.');
  if(url!=='https://api.anthropic.com/v1/messages'||options.method!=='POST'||options.redirect!=='error')throw problem('endpoint_blocked','Only the existing Anthropic Messages endpoint is allowed.');
  if(Object.keys(options.headers||{}).some(k=>!['content-type','x-api-key','anthropic-version'].includes(k.toLowerCase())))throw problem('unpriced_request','Unreviewed provider feature headers are blocked.');
  let body;try{body=JSON.parse(options.body);}catch{throw problem('invalid_request','Cannot inspect the outbound request budget.');}
  const record=reserve(body);
  try{const response=await fetcher(url,options);record.httpStatus=response.status;record.outcome=response.ok?'response-received':'provider-rejected';
   if(response.ok){try{const data=await response.clone().json();const usage=data.usage;const keys=['input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens'];if(usage&&keys.every(k=>usage[k]===undefined||(Number.isInteger(usage[k])&&usage[k]>=0)))record.usage=Object.fromEntries(keys.filter(k=>usage[k]!==undefined).map(k=>[k,usage[k]]));}catch{record.usage=null;}}
   return response;
  }catch{record.outcome='uncertain-no-retry';uncertain=true;throw problem('outcome_uncertain','Provider transport did not return a verified response. No retry is permitted.');}
 }
 return {reserve,fetcher:guardedFetch,report:()=>({execute,ceilingUsd:cap,reservedUpperUsd:Number(reserved.toFixed(6)),remainingUnreservedUsd:Number((cap-reserved).toFixed(6)),uncertain,records:structuredClone(records),assumption:'Conservative token allowance: one token per serialized UTF-8 request byte plus 4096 framing tokens; all output tokens reserved before each call. This is a cost estimate, not a provider-enforced billing cap.'})};
}
function mockGeneration(budget){return {spec:{provider:'mock-only',model:REHEARSAL_POLICY.model},async generateStructured(request){
 budget.reserve({model:REHEARSAL_POLICY.model,system:request.system,messages:[{role:'user',content:request.input}],output_config:{format:{type:'json_schema',schema:request.schema}},max_tokens:2048,stream:false});
 if(request.name==='campaign_critic')return {findings:[]};const input=JSON.parse(request.input);
 return {artifacts:input.artifacts.map(a=>{const fact=input.evidence.flatMap(t=>t.facts).find(f=>a.permittedFactIds.includes(f.id));return {artifactId:a.id,fields:a.requiredFields.map(name=>({name,text:name==='FAQ'?'What is this concept? A fictional collection intended to invite thoughtful questions.':'Let curiosity shape a thoughtful introduction to the fictional Luma Trail collection. Compare the walking and cycling ideas, reflect on your interests, and explore the sourced route story.'})),claims:[{text:fact.text,quote:fact.text,factId:fact.id,sourceId:fact.sourceId}],assumptions:['A proposed introductory conversation and reflective closing.']};})};
 }};}
export async function runRehearsal({execute=false,configDirectory,budgetUsd,out='evidence/live-rehearsal-proposal.json',fetcher=globalThis.fetch,continueFrom}={}){
 if(execute&&!configDirectory)throw problem('config_directory_required','Live execution requires an explicit existing configuration directory.');
 let priorRecords=[];const maxOutputTokens=continueFrom?6144:2048;
 if(continueFrom){const prior=JSON.parse(await readFile(continueFrom,'utf8'));if(!execute||prior.status!=='LIVE EXECUTION'||prior.budget.uncertain||prior.budget.records.length!==1||prior.budget.reservedUpperUsd!==0.142196||prior.runError?.code!=='api_output_limit')throw problem('invalid_continuation','Continuation requires the verified original ledger.');priorRecords=prior.budget.records;}
 const budget=createRehearsalBudget({execute,budgetUsd,fetcher,maxOutputTokens,priorRecords});let generation;
 if(execute){const keys=await createKeyStore({filename:path.resolve(configDirectory,'key.json'),environment:process.env,fetcher:budget.fetcher,timeoutMs:60000,...(continueFrom?{transientGeneration:{provider:'anthropic',maxOutputTokens}}:{})});const provider=keys.providers.forSession({apiGenerationProvider:'anthropic'}),status=provider.status();if(!keys.status().available||!status.generationConfigured||status.generationModel!==REHEARSAL_POLICY.model||status.maxOutputTokens!==maxOutputTokens)throw problem('configuration_mismatch','Existing approved Anthropic configuration must match the pinned model and 2048 output tokens. No settings were changed.');generation=provider.generation;}
 else generation=mockGeneration(budget);
 const mcpEvents=[],evidenceTools=createEvidenceTools({onEvent:event=>mcpEvents.push(event)}),parent=path.resolve('.tmp');await mkdir(parent,{recursive:true});const directory=await mkdtemp(path.join(parent,execute?'live-rehearsal-':'dry-rehearsal-'));
 const service=createCampaignService({directory,evidenceTools,modelTimeoutMs:60000});let run,proposalReview=null;
 const generator=createCampaignGeneration({generation,authorize:()=>true,maxCalls:8-priorRecords.length,timeoutMs:60000});
 const started=Date.now();
 try{run=await service.create('local-rehearsal-single-owner',REHEARSAL_BRIEF,{mode:'live-grounded'});for(let step=0;step<4;step++){run=await service.advance('local-rehearsal-single-owner',run.id,{expectedVersion:run.version,generator});if(['error','stopped'].includes(run.status))break;}
  if(run.status==='needs_revision'&&run.modelFindings?.length&&budget.report().records.length<8){run=await service.revise('local-rehearsal-single-owner',run.id,{expectedVersion:run.version,generator});if(run.currentProposal?.status==='pending'&&budget.report().records.length<8){const merged=run.artifacts.map(a=>run.currentProposal.artifacts.find(p=>p.id===a.id)||a);try{proposalReview=await generator.check({brief:run.brief,evidence:run.evidence,brandEvidence:run.brandEvidence,artifacts:merged});}catch(error){proposalReview={status:'not_completed',code:error.code||'review_failed'};}}}
 }finally{evidenceTools.close();service.close();}
 const report={status:execute?'LIVE EXECUTION':'DRY RUN - MOCK MODEL OUTPUT; NO NETWORK OR CREDENTIAL READS',createdAt:new Date().toISOString(),policy:{...REHEARSAL_POLICY,maxOutputTokens},continuedFrom:continueFrom||null,brief:REHEARSAL_BRIEF,dataSent:execute?'The fictional brief, the two selected public trail dossiers and their provenance, bounded synthetic brand excerpts, generated product/channel text, role instructions and strict schemas. No credentials occur in prompts; the existing API credential is only an authentication header.':'No data sent to a provider. The same public/synthetic payload shape was measured with mock outputs.',excluded:'No Pinecone calls, embeddings, credential/settings writes, publication, sending, automatic proposal acceptance, approval or export.',budget:budget.report(),durationMs:Date.now()-started,runId:run?.id,runStatus:run?.status,runError:run?.error,artifactCount:run?.artifacts?.length||0,artifacts:run?.artifacts?.map(({id,kind,text,citations})=>({id,kind,characters:text.length,citations})),findings:run?.findings||[],proposalStatus:run?.currentProposal?.status||null,proposalReview,checkpointDirectory:directory,mcp:{status:'actual local MCP stdio',events:mcpEvents},liveExecutionCompleted:execute&&run?.status==='awaiting_approval',liveQualityEstablished:false,note:'Human review is still required. No campaign was approved or exported. Cost reservations are conservative estimates, not measured invoice charges.'};
 await mkdir(path.dirname(path.resolve(out)),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');return report;
}
export function parseRehearsalArgs(args){const options={};for(let i=0;i<args.length;i++){const arg=args[i];if(arg==='--execute')options.execute=true;else if(['--config-directory','--max-spend-usd','--out','--continue-from'].includes(arg)){const value=args[++i];if(!value||value.startsWith('--'))throw problem('missing_argument',`${arg} requires a value.`);if(arg==='--config-directory')options.configDirectory=value;else if(arg==='--max-spend-usd')options.budgetUsd=Number(value);else if(arg==='--continue-from')options.continueFrom=value;else options.out=value;}else throw problem('unknown_argument','Unknown rehearsal option.');}return options;}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const report=await runRehearsal(parseRehearsalArgs(process.argv.slice(2)));console.log(JSON.stringify({status:report.status,runStatus:report.runStatus,artifactCount:report.artifactCount,budget:report.budget,checkpointDirectory:report.checkpointDirectory},null,2));if(report.runStatus==='error')process.exitCode=1;}catch(error){console.error(JSON.stringify({status:'NOT COMPLETED',code:error.code||'rehearsal_failed',message:'The bounded rehearsal stopped. No automatic retry, approval or export was performed.'}));process.exitCode=1;}}

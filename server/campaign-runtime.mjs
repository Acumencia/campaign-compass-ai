import {createCampaignBudget,campaignModelCallAllowance} from './campaign-budget.mjs';
import {createCampaignGeneration} from './campaign-generation.mjs';
export const CAMPAIGN_DEFAULTS=Object.freeze({enabled:true,capUsd:2,provider:'anthropic',model:'claude-opus-5-5',policyVersion:'campaign-usd-v1'});
export function campaignReadiness(api,enabled=true){
 const state=api.status();
 const scoped=enabled&&state.provider==='anthropic'&&state.generationModel===CAMPAIGN_DEFAULTS.model&&state.generationConfigured===true&&state.keyPresent===true&&!state.blocked&&typeof api.generation?.withTransport==='function';
 return {provider:state.provider,model:state.generationModel,configured:scoped,consent:scoped,keyPresent:state.keyPresent===true,maxOutputTokens:scoped?6144:state.maxOutputTokens,blocked:state.blocked||(!enabled?'Campaign generation is disabled.':state.generationConfigured&&!scoped?'Only the approved Anthropic model and budgeted transport are allowed.':null),campaignScoped:true};
}
export function createBudgetedCampaignGeneration({run,save,api,authorize=()=>false,fetcher=globalThis.fetch,policy}){
 const readiness=campaignReadiness(api);
 if(!readiness.configured)throw Object.assign(new Error('The approved Anthropic configuration is not available for this campaign. No model request was sent.'),{code:'campaign_budget_provider_unavailable',status:409});
 const budget=createCampaignBudget({run,save,fetcher,policy});
 const generation=api.generation.withTransport({fetcher:(url,options)=>budget.request({url,options}),maxOutputTokens:6144,timeoutMs:60000});
 const reserveBatch=({requests,signal})=>{
  if(signal?.aborted)throw Object.assign(new Error('Cancelled before batch reservation.'),{code:'cancelled'});
  return budget.reserveBatch(requests.map(({system,input,schema})=>({url:'https://api.anthropic.com/v1/messages',options:{method:'POST',redirect:'error',headers:{'content-type':'application/json','anthropic-version':'2023-06-01','x-api-key':'preflight-only-not-a-credential'},body:JSON.stringify({model:readiness.model,system,messages:[{role:'user',content:input}],output_config:{format:{type:'json_schema',schema}},max_tokens:6144,stream:false})}})));
 };
 const dispatched=(run.billing?.reservations||[]).filter(entry=>entry.status!=='planned').length;
 const policyCalls=campaignModelCallAllowance({run,policy});
 const requestedCalls=run.budgets?.maxModelCalls??policyCalls;
 if(!Number.isSafeInteger(requestedCalls)||requestedCalls<1)throw Object.assign(new Error('Invalid persisted campaign call budget.'),{code:'campaign_model_budget',status:409});
 const callLimit=Math.min(policyCalls,requestedCalls);
 const remainingCalls=callLimit-Math.max(run.budgets?.modelCalls||0,dispatched);
 if(remainingCalls<1)throw Object.assign(new Error('Campaign model call limit exhausted.'),{code:'campaign_model_budget',status:409});
 return createCampaignGeneration({generation,authorize,reserveBatch,maxCalls:remainingCalls,timeoutMs:60000});
}

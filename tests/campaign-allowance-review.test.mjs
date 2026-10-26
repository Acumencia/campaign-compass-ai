import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createCampaignService} from '../server/campaign.mjs';
import {createCampaignQABudgetPolicy,createCampaignBudget,extendCampaignQABudget,amendQAReviewAllowance} from '../server/campaign-budget.mjs';

test('campaign save cannot drop or alter an existing QA call allowance audit',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'cc-allowance-review-'));
 const owner='independent-allowance-test-owner';
 const initial=createCampaignQABudgetPolicy({ceilingUsd:5,authorizationId:'synthetic-allowance-test'});
 const extended=createCampaignQABudgetPolicy({ceilingUsd:10,authorizationId:'synthetic-allowance-test'});
 const service=createCampaignService({directory,campaignBudgetPolicy:initial});
 const db=new DatabaseSync(path.join(directory,'checkpoints.sqlite'));
 try{
  const created=await service.create(owner,{audience:'Adults',goal:'Synthetic test',tone:'Warm',cta:'Explore',walkingTrailId:'walk',cyclingTrailId:'cycle'},{mode:'live-grounded'});
  const raw=JSON.parse(db.prepare('SELECT state FROM campaign_runs WHERE id=?').get(created.id).state);
  const budget=createCampaignBudget({run:raw,save:()=>{},policy:initial,fetcher:async()=>new Response(JSON.stringify({model:'claude-opus-5-5',type:'message',role:'assistant',usage:{input_tokens:10,output_tokens:20}}),{headers:{'content-type':'application/json'}})});
  const request={url:'https://api.anthropic.com/v1/messages',options:{method:'POST',redirect:'error',headers:{'content-type':'application/json','anthropic-version':'2023-06-01','x-api-key':'synthetic-not-a-credential'},body:JSON.stringify({model:'claude-opus-5-5',system:'Synthetic',messages:[{role:'user',content:'Synthetic'}],output_config:{format:{type:'json_schema',schema:{type:'object'}}},max_tokens:6144,stream:false})}};
  for(let i=0;i<24;i++)await budget.request(request);
  extendCampaignQABudget({run:raw,save:()=>{},policy:initial,extendedPolicy:extended});
  raw.budgets.modelCalls=24;raw.budgets.maxModelCalls=24;raw.revisionCount=2;
  amendQAReviewAllowance({run:raw,save:()=>{},policy:extended});
  // Install only this synthetic fixture; no real campaign database is accessed.
  db.prepare('UPDATE campaign_runs SET state=? WHERE id=?').run(JSON.stringify(raw),raw.id);
  const original=db.prepare('SELECT state FROM campaign_runs WHERE id=?').get(raw.id).state;
  for(const tamper of [
   state=>{delete state.billing.qaAuthorization.callAllowanceAmendment;},
   state=>{state.billing.qaAuthorization.callAllowanceAmendment.reason='altered-reason';},
   state=>{state.billing.qaAuthorization.callAllowanceAmendment.to=32;},
  ]){
   await assert.rejects(service.advance(owner,raw.id,{expectedVersion:raw.version,generator:(state,save)=>{
    tamper(state);state.billing.revision++;save();throw Error('A tampered audit was saved');
   }}),{code:'campaign_budget_conflict'});
   assert.equal(db.prepare('SELECT state FROM campaign_runs WHERE id=?').get(raw.id).state,original,'Rejected save must leave the entire persisted fixture unchanged');
  }
 }finally{db.close();service.close();await rm(directory,{recursive:true,force:true});}
});

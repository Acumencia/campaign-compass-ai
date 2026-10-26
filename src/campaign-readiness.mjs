// Pure display/gating helpers: configuration is not evidence of an executed query.
export function retrievalReadinessBlock(readiness){
 const retrieval=readiness?.retrieval;
 if(!retrieval)return 'Retrieval readiness is unavailable. No live campaign can start; refresh readiness or choose offline templates.';
 if(retrieval.blocked)return 'Campaign retrieval is blocked: '+(typeof retrieval.blocked==='string'?retrieval.blocked:'the backend reported a blocker')+'. No live campaign query was started.';
 if(!retrieval.configured)return 'Campaign retrieval is not configured. No live campaign can start; offline templates remain available.';
 if(!retrieval.authorized)return 'Campaign retrieval query permission is not authorized. No live campaign query was started. Provider permission does not grant retrieval permission.';
 return '';
}
export function observedRetrieval(snapshot){
 const method=snapshot?.brandEvidence?.method;
 return {method:typeof method==='string'&&method?method:'Not recorded',backend:typeof snapshot?.brandEvidence?.backend==='string'?snapshot.brandEvidence.backend:'Not recorded',scope:method?'Recorded brand retrieval in this saved run':'No brand retrieval method recorded in this saved run'};
}
export function campaignBudgetPolicy(value){
 const cap=value?.ceilingUsd??value?.capUsd,version=value?.policyVersion;
 if(version==='campaign-usd-v1'&&cap===2)return {valid:true,cap,qa:false,label:'Campaign budget'};
 if(version==='campaign-qa-usd-v1'&&[5,10].includes(cap))return {valid:true,cap,qa:true,label:'Isolated QA budget'};
 return {valid:false,cap:null,qa:false,label:'Unrecognized budget policy'};
}
export function campaignRequestTimeout(path='',body){
 if(!body)return 10000;
 if(path.endsWith('/advance'))return 270000;
 if(path.endsWith('/revise'))return 500000;
 if(path.endsWith('/review'))return 130000;
 if(path.endsWith('/decide')&&body.decision==='accept_revision')return 130000;
 return 45000;
}
export function savedEditsNeedReview(run){
 return ['live-grounded','live-editorial'].includes(run?.mode)&&run.status==='needs_revision'&&!run.pendingOperation&&run.currentProposal?.status!=='pending'&&(run.findings||[]).some(f=>f.severity==='error'&&f.message.includes('Model review is out of date'));
}

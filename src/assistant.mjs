import {keyOf} from './metrics.mjs';
export const METRIC_INTENTS=['overview','channels','efficiency','anomaly'];
export const METRIC_RECOMMENDATIONS=['compare_channels','inspect_anomaly','review_measurement'];
export const MAX_METRIC_CLAIMS=8;
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const str={type:'string'};
export const METRIC_SCHEMA=object({contextId:str,snapshotId:str,intent:{type:'string',enum:METRIC_INTENTS},claims:{type:'array',minItems:1,description:`Select 1 to ${MAX_METRIC_CLAIMS} unique metric IDs. Copy exact finite numeric values from facts; omit null-valued metrics. Never round, calculate, add units, or stringify values.`,items:object({metricId:{type:'string',description:'Exact key of an entry in facts.'},value:{type:'number',description:'Exact numeric value of that facts entry, without rounding.'}})},recommendationId:{type:'string',enum:METRIC_RECOMMENDATIONS}});
export const METRIC_RULES=`Return only these required fields: ${METRIC_SCHEMA.required.join(', ')}. Allowed intents: ${METRIC_INTENTS.join(',')}. Allowed recommendationId: ${METRIC_RECOMMENDATIONS.join(',')}. ${METRIC_SCHEMA.properties.claims.description} Each claim has exactly metricId and value. The facts object maps metric IDs to records with id, value, label and unit. Use its key as metricId and its value property as the JSON number. Labels and units are metadata, not response fields. Copy contextId and snapshotId exactly. Return lowercase enum values exactly as listed.`;
export class EvidenceValidationError extends Error {
 constructor(subcode,field,message,claimIndex){super(message);this.subcode=subcode;this.field=field;if(Number.isInteger(claimIndex))this.claimIndex=claimIndex;}
}
const reject=(subcode,field,message,index)=>{throw new EvidenceValidationError(subcode,field,message,index);};
export const isEvidenceRecord=value=>value!==null && typeof value==='object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
export function checkEvidenceFields(value,fields,field='response',index){
 if(!isEvidenceRecord(value))reject('invalid_object',field,field==='response'?'Expected a structured evidence response.':'An unsupported numeric claim was rejected.',index);
 if(fields.some(k=>!Object.hasOwn(value,k)))reject('missing_field',field,'Missing required response fields.',index);
 if(Object.keys(value).some(k=>!fields.includes(k)))reject('extra_field',field,'Unsupported response fields.',index);
}
export function validateResponse(response,snap) {
 checkEvidenceFields(response,METRIC_SCHEMA.required.filter(k=>k!=='snapshotId'));
 if(response.contextId!==snap.id)reject('context_mismatch','contextId','The response belongs to an outdated filter context.');
 if(!METRIC_INTENTS.includes(response.intent))reject('invalid_enum','intent','Unsupported answer or recommendation.');
 if(!METRIC_RECOMMENDATIONS.includes(response.recommendationId))reject('invalid_enum','recommendationId','Unsupported answer or recommendation.');
 if(!Array.isArray(response.claims))reject('invalid_type','claims','Evidence is required.');
 if(response.claims.length<1||response.claims.length>MAX_METRIC_CLAIMS)reject('claim_count','claims','Evidence requires 1 to 8 claims.');
 const seen=new Set();
 for(const [index,claim] of response.claims.entries()){
  checkEvidenceFields(claim,METRIC_SCHEMA.properties.claims.items.required,'claims',index);
  if(typeof claim.metricId!=='string')reject('invalid_type','claims.metricId','An unsupported numeric claim was rejected.',index);
  if(!Object.hasOwn(snap.facts,claim.metricId))reject('unknown_evidence_id','claims.metricId','An unsupported numeric claim was rejected.',index);
  const fact=snap.facts[claim.metricId];
  if(!fact||!Number.isFinite(fact.value))reject('undefined_evidence','claims.value','An unsupported numeric claim was rejected.',index);
  if(typeof claim.value!=='number'||!Number.isFinite(claim.value))reject('invalid_numeric_type','claims.value','An unsupported numeric claim was rejected.',index);
  if(claim.value!==fact.value)reject('metric_mismatch','claims.value','An unsupported numeric claim was rejected.',index);
  if(seen.has(claim.metricId))reject('duplicate_evidence','claims.metricId','Duplicate evidence.',index);
  seen.add(claim.metricId);
 }
 return response;
}
export function demoAnswer(question,snap) {
  if (!snap.total.rows) throw new Error('No rows match these filters. Reset filters before requesting a brief.');
  const query=question.toLowerCase().trim();
  if (query.length>500) throw new Error('Keep the question under 500 characters.');
  let intent;
  if (/(why|anomal|spike|unusual|fatigue)/.test(query)) intent='anomaly';
  else if (/(channel|platform|best|perform)/.test(query)) intent='channels';
  else if (/(cpa|cost|efficien|roi|roas|return)/.test(query)) intent='efficiency';
  else if (/(brief|overview|summar|spend|revenue|conversion|click)/.test(query)) intent='overview';
  else throw new Error('Demo mode understands overview, channel comparison, efficiency and anomalies. Try a suggested question; open-ended reasoning needs a connected provider.');
  let ids=['total.spend','total.conversions','total.roas'];
  if (intent==='channels') ids=snap.platforms.filter(p=>p.roas!==null).sort((a,b)=>b.roas-a.roas).slice(0,4).map(p=>`platform.${keyOf(p.name)}.roas`);
  if (intent==='efficiency') ids=['total.cpa','total.roi','total.ctr'];
  if (intent==='anomaly') ids=snap.anomalies.length?[`${snap.anomalies[0].prefix}.recent.cpa`,`${snap.anomalies[0].prefix}.previous.cpa`,`${snap.anomalies[0].prefix}.change`]:['total.cpa','total.conversions'];
  ids=ids.filter(id=>snap.facts[id]?.value!==null);
  if (!ids.length) throw new Error('This slice has no defined metrics for that question.');
  return validateResponse({contextId:snap.id,intent,claims:ids.map(metricId=>({metricId,value:snap.facts[metricId].value})),recommendationId:intent==='anomaly'?'inspect_anomaly':intent==='channels'?'compare_channels':'review_measurement'},snap);
}
export class DeterministicProvider {
  name='Deterministic demo'; live=false;
  async answer(question,snap){return {mode:'demo',answer:demoAnswer(question,snap)};}
}

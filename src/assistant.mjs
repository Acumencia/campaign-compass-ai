import {keyOf} from './metrics.mjs';
const intents=['overview','channels','efficiency','anomaly'];
const recommendations=['compare_channels','inspect_anomaly','review_measurement'];
const isRecord=value=>value!==null && typeof value==='object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
export function validateResponse(response,snap) {
  if (!isRecord(response)) throw new Error('Expected a structured evidence response.');
  if (response.contextId!==snap.id) throw new Error('The response belongs to an outdated filter context.');
  if (Object.keys(response).length!==4 || Object.keys(response).some(k=>!['contextId','intent','claims','recommendationId'].includes(k))) throw new Error('Unsupported response fields.');
  if (!intents.includes(response.intent) || !recommendations.includes(response.recommendationId)) throw new Error('Unsupported answer or recommendation.');
  if (!Array.isArray(response.claims) || response.claims.length<1 || response.claims.length>8) throw new Error('Evidence is required.');
  for (const claim of response.claims) {
    if (!isRecord(claim) || typeof claim.metricId!=='string' || Object.keys(claim).length!==2 || !Object.hasOwn(snap.facts,claim.metricId)) throw new Error('An unsupported numeric claim was rejected.');
    const fact=snap.facts[claim.metricId];
    if (Object.keys(claim).some(k=>!['metricId','value'].includes(k)) || !fact || fact.value===null || !Number.isFinite(claim.value) || claim.value!==fact.value) throw new Error('An unsupported numeric claim was rejected.');
  }
  if (new Set(response.claims.map(c=>c.metricId)).size!==response.claims.length) throw new Error('Duplicate evidence.');
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

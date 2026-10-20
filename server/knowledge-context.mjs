import {retrieve} from './knowledge.mjs';

// Bounded local coverage expansion: no additional embeddings or remote searches.
export function versionComparisonRequested(question){
  return /\b(archived?|historical|previous|formerly|superseded|expired)\b/i.test(question)||(/\b(current|currently|now|today)\b/i.test(question)&&/\b(or|versus|vs|old)\b/i.test(question));
}
export function expandEvidence(corpus,question,vectorMatches,{topK=5,sourceIds=[]}={}){
  // Preserve the existing empty-vector gate and explicit source scope.
  if(!vectorMatches.length)return {matches:[],lexicalMatches:[],historicalMatches:[]};
  const lexicalMatches=retrieve(corpus,question,topK,{sourceIds}).map(c=>({...c,scoreKind:'lexical cosine',evidenceRole:c.metadata?.status==='active'?'current':'explicit historical source'}));
  const matches=[],seen=new Set();
  const add=c=>{if(c&&!seen.has(c.chunkId)){matches.push(c);seen.add(c.chunkId);}};
  for(let i=0;i<topK;i++){add(vectorMatches[i]&&{...vectorMatches[i],scoreKind:'vector cosine',evidenceRole:vectorMatches[i].metadata?.status==='active'?'current':'explicit historical source'});add(lexicalMatches[i]);}
  let historicalMatches=[];
  if(!sourceIds.length&&versionComparisonRequested(question)){
    const active=new Set(matches.filter(c=>c.metadata?.status==='active').map(c=>c.sourceId));
    const linked=corpus.documents.filter(d=>['superseded','expired'].includes(d.metadata?.status)&&active.has(d.metadata.supersededBy)).map(d=>d.sourceId);
    if(linked.length)historicalMatches=retrieve(corpus,question,2,{sourceIds:linked}).map(c=>({...c,scoreKind:'lexical cosine',evidenceRole:'historical comparison only'}));
    historicalMatches.forEach(add);
  }
  return {matches,lexicalMatches,historicalMatches};
}
export const COMPLETENESS_INSTRUCTIONS=`Cover every requested part, including calculation inputs and shipping; never guess a missing fact. For current-versus-old alternatives, cite the current value and separately explain supported historical/expired alternatives. If history is absent, say so. Historical comparison passages cannot establish current claims; respect status and supersededBy. For device fit, ask physical length, width, thickness with units and carrying/protection needs; screen size or capacity alone cannot prove fit. Check completeness without sacrificing citation support.`;

export function completeFitClarification(question,answer){
  const fit=/\b(fit|fits|fitting|carry|carrying|hold|holds)\b/i.test(question)&&/\b(device|laptop|tablet|computer|electronics)\b/i.test(question);
  if(!fit||answer.status!=='clarification')return {answer,completed:false};
  const complete=/\blength\b/i.test(answer.message)&&/\bwidth\b/i.test(answer.message)&&/\b(thickness|depth)\b/i.test(answer.message)&&/\b(units|cm|centimeters|inches)\b/i.test(answer.message)&&/\b(carrying|protection|other items)\b/i.test(answer.message);
  if(complete)return {answer,completed:false};
  // This adds only a question, never a product fact or an assertion of fit.
  const detail='What are the device physical length, width and thickness (with units), and your carrying/protection needs?';
  const message=(answer.message+' '+detail).length<=500?answer.message+' '+detail:'Which device do you mean? '+detail;
  return {answer:{...answer,message},completed:true};
}

// Deliberately narrow standalone forms, not a keyword classifier or conversation memory.
// Explicit source selection is real request context: leave it to the normal evidence path.
export function standaloneClarification(question,{sourceIds=[]}={}){
  if(sourceIds.length)return null;
  const q=question.toLowerCase().trim().replace(/[?.!]+$/,'').trim().replace(/\s+/g,' ');
  if(/^(?:is|would) (?:it|this|that)(?: be)? safe$/.test(q))return 'Which product do you mean, and how do you intend to use it?';
  if(/^(?:will|would|does) (?:it|this|that) fit$/.test(q))return 'Which product and item do you mean, and what are the item’s physical dimensions (with units) and carrying or protection needs?';
  if(/^(?:which (?:one|is best)|which one is best|what is best)(?: for me)?$/.test(q))return 'Which products are you considering, and what do you need them for?';
  if(/^(?:can i use (?:it|this|that)|is (?:it|this|that) suitable|will (?:it|this|that) work)$/.test(q))return 'Which product do you mean, and what do you want to use it for?';
  if(/^(?:how much does (?:it|this|that) cost|what is (?:its|the) capacity)$/.test(q))return 'Which product do you mean?';
  return null;
}

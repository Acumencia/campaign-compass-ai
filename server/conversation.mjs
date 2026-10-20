import {KnowledgeError,exactFields} from './knowledge.mjs';
import {standaloneClarification} from './knowledge-context.mjs';
export const CONVERSATION_LIMITS=Object.freeze({messages:8,messageCharacters:800});
export function validateConversation(value=[]){
 if(!Array.isArray(value)||value.length>8||value.length%2||Buffer.byteLength(JSON.stringify(value))>5000)throw new KnowledgeError(400,'invalid_conversation','Use up to four completed user/assistant exchanges.');
 return value.map((m,i)=>{exactFields(m,['role','content']);if(m.role!==(i%2?'assistant':'user')||typeof m.content!=='string'||!m.content.trim()||m.content.length>800)throw new KnowledgeError(400,'invalid_conversation','Conversation must contain alternating bounded user/assistant text, without system messages.');return {role:m.role,content:m.content};});
}
// Product vocabulary is scoped to this teaching corpus and present source IDs.
// Assistant text never chooses a referent or supplies evidence.
const products=[['bottle-mini','Switchback Mini bottle',['switchback mini bottle','switchback mini']],['bottle','Switchback bottle',['switchback','bottle']],['pack','Dayline pack',['dayline','pack']],['sling','Waypoint sling',['waypoint','sling']],['tote','Ridgeline tote',['ridgeline','tote']]];
function mentions(corpus,text){let remaining=text.toLowerCase();const found=[];
 for(const [id,name,aliases]of products){if(!corpus.documents.some(d=>d.sourceId===id))continue;let hit=false;for(const alias of aliases){const pattern=new RegExp('\\b'+alias+'\\b','g');if(pattern.test(remaining)){hit=true;remaining=remaining.replace(pattern,' ');}}if(hit)found.push({id,name});}
 // The generic noun "bottle" in "Switchback Mini bottle" is not a second product.

 return found;
}
const followup=q=>q.length<220&&(/\b(it|its|this|that|they|them|their|one)\b/i.test(q)||/^(?:(?:for|to|yes|no)\b|(?:(?:and|what about|how about)\s+)?(?:the\s+)?(?:price|capacity|materials?|care|shipping|returns)[?.!\s]*$)/i.test(q.trim()));
function recentIntendedUse(corpus,history,subject){
 for(let i=history.length-2;i>=0;i-=2){const text=history[i].content,refs=mentions(corpus,text);if(refs.length&&(refs.length!==1||refs[0].id!==subject.id))break;
  const use=text.match(/^(?:for|to)\s+(.{2,100}?)[?.!]*$/i)||text.match(/\bsafe\s+(?:for|to)\s+(.{2,100}?)[?.!]*$/i);
  if(use)return use[1];if(refs.length||!followup(text))break;
 }return null;
}
export function resolveConversation(corpus,request){
 const history=validateConversation(request.conversation),question=request.question;
 if(typeof question!=='string')throw new KnowledgeError(400,'invalid_request','Provide a question.');
 const current=mentions(corpus,question),filtered=(request.sourceIds||[]).map(id=>products.find(p=>p[0]===id)).filter(Boolean).map(([id,name])=>({id,name}));
 let refs=current,origin=current.length?'question':'none';
 if(!refs.length&&(request.sourceIds||[]).length){refs=filtered;origin=refs.length?'source_filter':'none';}
 else if(!refs.length&&followup(question)){
  for(let i=history.length-2;i>=0;i-=2){const prior=mentions(corpus,history[i].content);if(prior.length){refs=prior;origin='conversation';break;}if(!followup(history[i].content))break;}
 }
 let clarification=null,query=question;
 if(followup(question)&&refs.length>1&&!current.length)clarification=`Do you mean ${refs.map(r=>r.name).join(' or ')}, and what would you like to know about it?`;
 else if(refs.length===1){
  const subject=refs[0].name;
  const safetyQuestion=/^(?:is|would)\s+.+?\s+(?:be\s+)?safe[?!.\s]*$/i.test(question.trim()),use=safetyQuestion?recentIntendedUse(corpus,history,refs[0]):null;
  if(safetyQuestion&&!use)clarification=`For the ${subject}, what activity or intended use are you asking about?`;
  if(use)query=`${subject}. ${question} Intended use: ${use}.`;
  if(!use&&origin!=='question'&&followup(question)){
   const previousQuestion=history.at(-2)?.content||'';
   const intent=/^(?:for|to)\b/i.test(question.trim())&&/\bsafe\b/i.test(previousQuestion)?'Safety for intended use. ':'';
   query=`${subject}. ${intent}${question}`;
  }
 }
 if(!clarification&&!refs.length)clarification=standaloneClarification(question,request);
 return {history,query,clarification,referents:refs.map(r=>r.name),resolution:origin,historyMessages:history.length};
}

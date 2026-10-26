import {KnowledgeError} from './knowledge.mjs';
import {withDeadline} from './rag.mjs';
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const str={type:'string'};
export const RAG_SCHEMA=object({corpusVersion:str,status:{type:'string',enum:['answered','clarification','insufficient_evidence']},message:str,claims:{type:'array',items:object({text:str,citations:{type:'array',items:object({chunkId:str,quote:str})}})}});
import {METRIC_SCHEMA} from '../src/assistant.mjs';
export {METRIC_SCHEMA};
const messages={api_key_missing:'The server API key is missing or invalid. Configure it locally and restart.',api_disabled:'OpenAI API requests are disabled in server configuration.',api_configuration:'Check the separate generation and embedding model settings on the server.',api_authentication:'OpenAI rejected API authentication. Review the key locally before restarting.',api_permission:'OpenAI denied this API request. Review project/model permissions and organization policy; requests are paused.',api_limit:'OpenAI reported a usage or rate limit. Review API billing/limits before restarting; requests are paused.',api_failed:'The OpenAI API request failed. No automatic retry was made.',api_invalid_response:'The OpenAI API returned an unsupported or incomplete response.',api_refusal:'The model declined this request. No answer was generated.',api_cancelled:'The API request was cancelled.',api_timeout:'The API request exceeded its deadline.',api_response_size:'The API response exceeded its size limit.',api_input_size:'The embedding input exceeds this adapter’s conservative size limit.'};
const error=(code,status=502)=>new KnowledgeError(status,code,messages[code]);
const validName=value=>typeof value==='string'&&/^gpt-[a-zA-Z0-9._-]{1,100}$/.test(value);
export function createOpenAIKeyService({environment=process.env,fetcher=globalThis.fetch,timeoutMs=30000}={}){
  // The secret is read only when this app-specific mechanism is explicitly enabled.
  const enabled=environment.CAMPAIGN_OPENAI_ENABLED==='1';
  const candidate=enabled?environment.CAMPAIGN_OPENAI_API_KEY:'';
  const apiKey=typeof candidate==='string'&&candidate.length>=20&&candidate.length<=512&&!/\s|[^\x21-\x7e]/.test(candidate)?candidate:null;
  const generationModel=validName(environment.CAMPAIGN_OPENAI_GENERATION_MODEL)&&(!apiKey||!environment.CAMPAIGN_OPENAI_GENERATION_MODEL.includes(apiKey))?environment.CAMPAIGN_OPENAI_GENERATION_MODEL:null;
  const embeddingModel=['text-embedding-3-small','text-embedding-3-large'].includes(environment.CAMPAIGN_OPENAI_EMBEDDING_MODEL)?environment.CAMPAIGN_OPENAI_EMBEDDING_MODEL:null;
  const dimensions=Number(environment.CAMPAIGN_OPENAI_EMBEDDING_DIMENSIONS);
  const dimensionsValid=Number.isInteger(dimensions)&&dimensions>=1&&dimensions<=(embeddingModel==='text-embedding-3-small'?1536:3072);
  const maxOutputTokens=Number(environment.CAMPAIGN_OPENAI_MAX_OUTPUT_TOKENS||2048);
  const tokensValid=Number.isInteger(maxOutputTokens)&&maxOutputTokens>=128&&maxOutputTokens<=8192;
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid API deadline.');
  let blocked=null,active=false,generationVerified=false;
  const generationConfigured=enabled&&!!apiKey&&!!generationModel&&tokensValid;
  const embeddingsConfigured=enabled&&!!apiKey&&!!embeddingModel&&dimensionsValid;
  function status(){return {enabled,keyPresent:!!apiKey,keyStatus:!enabled?'not_read_disabled':apiKey?'present_on_server':'missing_or_invalid',generationConfigured,embeddingsConfigured,generationModel,embeddingModel,embeddingDimensions:dimensionsValid&&embeddingModel?dimensions:null,maxOutputTokens:tokensValid?maxOutputTokens:null,blocked,liveVerified:generationVerified,billing:'Separate OpenAI API billing; not ChatGPT included usage.'};}
  async function send(route,body,signal,maxBytes){
    if(!enabled)throw error('api_disabled',503);if(!apiKey)throw error('api_key_missing',503);if(blocked)throw error(blocked,403);if(signal?.aborted)throw error('api_cancelled',499);
    if(active)throw new KnowledgeError(429,'api_busy','One API request is already running. Wait or cancel before trying again.');
    active=true;const controller=new AbortController();let timedOut=false;const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
    try{
      let response;try{response=await fetcher(`https://api.openai.com/v1/${route}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify(body),signal:controller.signal,redirect:'error'});}catch{if(timedOut)throw error('api_timeout',504);if(signal?.aborted)throw error('api_cancelled',499);throw error('api_failed');}
      if(response.redirected||response.status>=300&&response.status<400)throw error('api_invalid_response');
      if(!response.ok){await response.body?.cancel().catch(()=>{});const code=response.status===401?'api_authentication':response.status===403?'api_permission':response.status===429?'api_limit':'api_failed';if([401,403,429].includes(response.status))blocked=code;throw error(code,response.status===401?401:response.status===403?403:response.status===429?429:502);}
      if(!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw error('api_invalid_response');
      const reader=response.body?.getReader();if(!reader)throw error('api_invalid_response');const decoder=new TextDecoder();let text='',bytes=0;
      try{for(;;){const{done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes){await reader.cancel();throw error('api_response_size');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
      if(controller.signal.aborted)throw error(timedOut?'api_timeout':'api_cancelled',timedOut?504:499);
      // Never release a reflected secret, even in a successful upstream response.
      if(text.includes(apiKey))throw error('api_invalid_response');
      let data;try{data=JSON.parse(text);}catch{throw error('api_invalid_response');}if(!data||typeof data!=='object'||Array.isArray(data)||JSON.stringify(data).includes(apiKey))throw error('api_invalid_response');return data;
    }catch(e){if(e instanceof KnowledgeError)throw e;if(timedOut)throw error('api_timeout',504);if(signal?.aborted)throw error('api_cancelled',499);throw error('api_failed');}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();active=false;}
  }
  async function post(route,body,signal,maxBytes){
    try{return await withDeadline(inner=>send(route,body,inner,maxBytes),{signal,timeoutMs});}
    catch(e){if(e.code==='timeout')throw error('api_timeout',504);if(e.code==='cancelled')throw error('api_cancelled',499);throw e;}
  }
  async function generateJSON(system,input,schema,name,maxCharacters,signal){
    if(!generationConfigured)throw error(!apiKey?'api_key_missing':'api_configuration',503);
    const response=await post('responses',{model:generationModel,instructions:system,input:[{role:'user',content:input}],text:{format:{type:'json_schema',name,strict:true,schema}},max_output_tokens:maxOutputTokens,store:false,stream:false},signal,1000000);
    if(response.status!=='completed'||response.error||!Array.isArray(response.output))throw error('api_invalid_response');
    let output='';for(const item of response.output){if(item.type!=='message')continue;if(item.role!=='assistant'||item.status!=='completed'||!Array.isArray(item.content))throw error('api_invalid_response');for(const part of item.content){if(part.type==='refusal')throw error('api_refusal');if(part.type!=='output_text'||typeof part.text!=='string')throw error('api_invalid_response');output+=part.text;if(output.length>maxCharacters)throw error('api_response_size');}}
    if(!output.trim())throw error('api_invalid_response');try{const answer=JSON.parse(output);if(JSON.stringify(answer).includes(apiKey))throw error('api_invalid_response');generationVerified=true;return answer;}catch{throw error('api_invalid_response');}
  }
  const embedding=embeddingsConfigured?{spec:{provider:'openai-api-key',model:embeddingModel,revision:'embeddings-http-contract-v1',dimensions},async embed(texts,{signal}={}){
    if(!Array.isArray(texts)||!texts.length||texts.length>64||texts.some(t=>typeof t!=='string'||!t.trim()||Buffer.byteLength(t,'utf8')>8000))throw error('api_input_size',400);
    const response=await post('embeddings',{model:embeddingModel,input:texts,dimensions,encoding_format:'float'},signal,16*1024*1024);
    if(response.model!==embeddingModel||!Array.isArray(response.data)||response.data.length!==texts.length)throw error('api_invalid_response');
    const vectors=new Array(texts.length),seen=new Set();for(const row of response.data){if(row.object!=='embedding'||!Number.isInteger(row.index)||row.index<0||row.index>=texts.length||seen.has(row.index)||!Array.isArray(row.embedding)||row.embedding.length!==dimensions||row.embedding.some(n=>typeof n!=='number'||!Number.isFinite(n)))throw error('api_invalid_response');seen.add(row.index);vectors[row.index]=row.embedding;}
    return {model:embeddingModel,revision:'embeddings-http-contract-v1',dimensions,vectors};
  }}:null;
  const generation=generationConfigured?{spec:{provider:'openai-api-key',model:generationModel,revision:'responses-json-schema-v1'},generate:({system,input,maxOutputCharacters},{signal}={})=>generateJSON(system,input,RAG_SCHEMA,'campaign_knowledge',maxOutputCharacters,signal),generateStructured:({system,input,schema,name,maxOutputCharacters=16000},{signal}={})=>generateJSON(system,input,schema,name,maxOutputCharacters,signal)}:null;
  async function invokeMetric(request,{signal}={}){return generateJSON(request.system,JSON.stringify({question:request.question,contextId:request.contextId,snapshotId:request.snapshotId,facts:request.facts}),METRIC_SCHEMA,'campaign_metrics',16000,signal);}
  return {status,embedding,generation,invokeMetric};
}

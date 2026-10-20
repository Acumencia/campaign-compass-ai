import {KnowledgeError} from './knowledge.mjs';
import {withDeadline} from './rag.mjs';
import {RAG_SCHEMA,METRIC_SCHEMA} from './openai-api-key.mjs';
const messages={api_key_missing:'The server API key is missing or invalid. Configure it locally and restart.',api_disabled:'Anthropic API requests are disabled in server configuration.',api_configuration:'Check the separate generation and embedding model settings on the server.',api_authentication:'Anthropic rejected API authentication. Review the key locally before restarting.',api_permission:'Anthropic denied this API request. Review project/model permissions and organization policy; requests are paused.',api_limit:'Anthropic reported a usage or rate limit. Review API billing/limits before restarting; requests are paused.',api_network:'The Anthropic request could not reach the API. Check network connectivity; no automatic retry was made.',api_json_invalid:'Claude returned text that was not valid JSON. No model answer was accepted.',api_empty_response:'Claude returned no final answer text.',api_request_invalid:'Anthropic rejected the request format or model settings (HTTP 400). Check the model ID and structured-output support.',api_model_unavailable:'Anthropic could not find the requested model or resource (HTTP 404). Choose a model available to your API account.',api_overloaded:'Anthropic is temporarily overloaded (HTTP 529). No automatic retry was made.',api_output_limit:'Claude reached the output token limit before completing the answer. Review the output limit before trying again.',api_failed:'The Anthropic API request failed. No automatic retry was made.',api_invalid_response:'The Anthropic API returned an unsupported or incomplete response.',api_refusal:'The model declined this request. No answer was generated.',api_cancelled:'The API request was cancelled.',api_timeout:'The API request exceeded its deadline.',api_response_size:'The API response exceeded its size limit.',api_input_size:'The embedding input exceeds this adapter’s conservative size limit.'};
const error=(code,status=502)=>new KnowledgeError(status,code,messages[code]);
const validName=value=>typeof value==='string'&&/^claude-[a-zA-Z0-9._-]{1,100}$/.test(value);
export function createAnthropicKeyService({environment=process.env,fetcher=globalThis.fetch,timeoutMs=30000}={}){
  // The secret is read only when this app-specific mechanism is explicitly enabled.
  const enabled=environment.CAMPAIGN_ANTHROPIC_ENABLED==='1';
  const candidate=enabled?environment.CAMPAIGN_ANTHROPIC_API_KEY:'';
  const apiKey=typeof candidate==='string'&&candidate.length>=20&&candidate.length<=512&&!/\s|[^\x21-\x7e]/.test(candidate)?candidate:null;
  const generationModel=validName(environment.CAMPAIGN_ANTHROPIC_GENERATION_MODEL)&&(!apiKey||!environment.CAMPAIGN_ANTHROPIC_GENERATION_MODEL.includes(apiKey))?environment.CAMPAIGN_ANTHROPIC_GENERATION_MODEL:null;
  const maxOutputTokens=Number(environment.CAMPAIGN_ANTHROPIC_MAX_OUTPUT_TOKENS||2048);
  const tokensValid=Number.isInteger(maxOutputTokens)&&maxOutputTokens>=128&&maxOutputTokens<=8192;
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid API deadline.');
  let blocked=null,active=false,generationVerified=false,lastIssue=null;
  const generationConfigured=enabled&&!!apiKey&&!!generationModel&&tokensValid;

  function status(){return {enabled,keyPresent:!!apiKey,keyStatus:!enabled?'not_read_disabled':apiKey?'present_on_server':'missing_or_invalid',generationConfigured,embeddingsConfigured:false,generationModel,embeddingModel:null,embeddingDimensions:null,maxOutputTokens:tokensValid?maxOutputTokens:null,blocked,liveVerified:generationVerified,lastIssue,billing:'Separate Anthropic API billing; not a Claude subscription.'};}
  async function send(route,body,signal,maxBytes,diagnostic){
    if(!enabled)throw error('api_disabled',503);if(!apiKey)throw error('api_key_missing',503);if(blocked)throw error(blocked,403);if(signal?.aborted)throw error('api_cancelled',499);
    if(active)throw new KnowledgeError(429,'api_busy','One API request is already running. Wait or cancel before trying again.');
    active=true;const controller=new AbortController();let timedOut=false;const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
    try{
      let response;try{response=await fetcher('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify(body),signal:controller.signal,redirect:'error'});}catch{if(timedOut)throw error('api_timeout',504);if(signal?.aborted)throw error('api_cancelled',499);throw error('api_network');}
      diagnostic.httpStatus=response.status;
      const requestId=response.headers.get('request-id');if(typeof requestId==='string'&&/^req_[A-Za-z0-9]{8,96}$/.test(requestId)&&!requestId.includes(apiKey))diagnostic.requestId=requestId;
      if(response.redirected||response.status>=300&&response.status<400)throw error('api_invalid_response');
      if(!response.ok){await response.body?.cancel().catch(()=>{});const code=response.status===401?'api_authentication':response.status===403?'api_permission':response.status===429?'api_limit':response.status===400?'api_request_invalid':response.status===404?'api_model_unavailable':response.status===529?'api_overloaded':'api_failed';if([401,403,429].includes(response.status))blocked=code;const issue=error(code,[401,403,429].includes(response.status)?response.status:502);issue.diagnostic={...diagnostic};lastIssue={code,message:issue.message,...issue.diagnostic};throw issue;}
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
  async function post(route,body,signal,maxBytes,diagnostic){
    try{return await withDeadline(inner=>send(route,body,inner,maxBytes,diagnostic),{signal,timeoutMs});}
    catch(e){if(e.code==='timeout')throw error('api_timeout',504);if(e.code==='cancelled')throw error('api_cancelled',499);throw e;}
  }
  async function generateJSONInner(system,input,schema,name,maxCharacters,signal,diagnostic){
    if(!generationConfigured)throw error(!apiKey?'api_key_missing':'api_configuration',503);
    const response=await post('messages',{model:generationModel,system,messages:[{role:'user',content:input}],output_config:{format:{type:'json_schema',schema}},max_tokens:maxOutputTokens,stream:false},signal,1000000,diagnostic);
    if(response.stop_reason==='max_tokens')throw error('api_output_limit');
    if(response.stop_reason==='refusal')throw error('api_refusal');
    if(response.type!=='message'||response.role!=='assistant'||response.stop_reason!=='end_turn'||response.error||!Array.isArray(response.content))throw error('api_invalid_response');
    let output='';for(const part of response.content){if(part?.type==='thinking'||part?.type==='redacted_thinking')continue;if(!part||part.type!=='text'||typeof part.text!=='string')throw error('api_invalid_response');output+=part.text;if(output.length>maxCharacters)throw error('api_response_size');}
    if(!output.trim())throw error('api_empty_response');try{const answer=JSON.parse(output);if(JSON.stringify(answer).includes(apiKey))throw error('api_invalid_response');generationVerified=true;lastIssue=null;return answer;}catch{throw error('api_json_invalid');}
  }
  async function generateJSON(...args){const diagnostic={};try{return await generateJSONInner(...args,diagnostic);}catch(e){if(e instanceof KnowledgeError){e.diagnostic=diagnostic;lastIssue={code:e.code,message:e.message,...diagnostic};}throw e;}}
  const embedding=null;
  const generation=generationConfigured?{spec:{provider:'anthropic-api-key',model:generationModel,revision:'messages-json-schema-v1'},generate:({system,input,maxOutputCharacters},{signal}={})=>generateJSON(system,input,RAG_SCHEMA,'campaign_knowledge',maxOutputCharacters,signal)}:null;
  async function invokeMetric(request,{signal}={}){return generateJSON(request.system,JSON.stringify({question:request.question,contextId:request.contextId,snapshotId:request.snapshotId,facts:request.facts}),METRIC_SCHEMA,'campaign_metrics',16000,signal);}
  return {status,embedding,generation,invokeMetric};
}

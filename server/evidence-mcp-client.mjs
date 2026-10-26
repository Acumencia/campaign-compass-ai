import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const VERSION='2025-11-25',serverPath=fileURLToPath(new URL('./evidence-mcp-server.mjs',import.meta.url));
const failure=(code,message)=>Object.assign(new Error(message),{code,status:503});
export function evidenceChildEnvironment(environment=process.env){
 const allowed=new Set(['systemroot','windir','path','pathext','comspec','systemdrive']);
 return Object.fromEntries(Object.entries(environment).filter(([name])=>allowed.has(name.toLowerCase())));
}

/** A real MCP subprocess client with a fixed server and public-corpus capability.
 * No paths, arbitrary tools, environment overrides or provider access from callers.
 */
export function createEvidenceTools({onEvent=()=>{},timeoutMs=5000,scope='public-demo'}={}){
 if(scope!=='public-demo'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw Error('Unsupported evidence capability or timeout.');
 let child,boot,nextId=1,buffer='',closed=false,ready=false;
 const pending=new Map();
 function failPending(error){for(const item of pending.values())item.reject(error);pending.clear();}
 function terminate(error=failure('mcp_closed','The local evidence connection closed.'),expected=child){if(expected!==child)return;ready=false;failPending(error);expected?.stdin.destroy();expected?.kill();}
 function write(message){if(!child||child.killed||closed)throw failure('mcp_closed','The local evidence connection is closed.');child.stdin.write(JSON.stringify(message)+'\n');}
 function request(method,params,{signal}={}){
  if(signal?.aborted)return Promise.reject(failure('mcp_cancelled','Evidence retrieval was cancelled.'));
  const id=nextId++;
  return new Promise((resolve,reject)=>{
   let timer;
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);pending.delete(id);};
   const abort=()=>{try{write({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:id,reason:'Local workflow stopped'}});}catch{}cleanup();reject(failure('mcp_cancelled','Evidence retrieval was cancelled.'));};
   pending.set(id,{resolve:value=>{cleanup();resolve({value,id});},reject:error=>{cleanup();reject(error);}});
   timer=setTimeout(()=>{try{write({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:id,reason:'Deadline reached'}});}catch{}cleanup();reject(failure('mcp_timeout','Local evidence retrieval exceeded its five-second budget.'));},timeoutMs);
   signal?.addEventListener('abort',abort,{once:true});
   try{write({jsonrpc:'2.0',id,method,params});}catch(error){cleanup();reject(error);}
  });
 }
 async function ensure(){
  if(closed)throw failure('mcp_closed','The local evidence connection is closed.');
  if(boot)return boot;
  const processForAttempt=spawn(process.execPath,[serverPath],{env:evidenceChildEnvironment(),windowsHide:true,stdio:['pipe','pipe','pipe']});
  child=processForAttempt;buffer='';
  boot=(async()=>{
   processForAttempt.stdout.setEncoding('utf8');processForAttempt.stderr.resume();
   // Only an exited process releases this connection slot. Its outstanding calls
   // fail once; a later caller may start a fresh handshake, never replay a call.
   const exited=()=>{if(child!==processForAttempt)return;ready=false;failPending(failure('mcp_closed','The local evidence process stopped. Retry the action to reconnect.'));child=null;boot=null;buffer='';};
   processForAttempt.on('error',()=>terminate(failure('mcp_start_failed','The local MCP evidence process could not start.'),processForAttempt));
   processForAttempt.on('exit',exited);processForAttempt.on('close',exited);
   processForAttempt.stdin.on('error',()=>terminate(undefined,processForAttempt));
   processForAttempt.stdout.on('data',chunk=>{if(child!==processForAttempt)return;buffer+=chunk;let newline;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(Buffer.byteLength(line)>768*1024){terminate(failure('mcp_protocol','Evidence response exceeds its size limit.'),processForAttempt);return;}let response;try{response=JSON.parse(line);}catch{terminate(failure('mcp_protocol','The evidence process returned malformed JSON-RPC.'),processForAttempt);return;}if(response?.jsonrpc!=='2.0'||!Object.hasOwn(response,'id')){terminate(failure('mcp_protocol','The evidence process returned an unsupported message.'),processForAttempt);return;}const item=pending.get(response.id);if(!item)continue;if(response.error)item.reject(failure('mcp_request',response.error.code===-32602?'Invalid evidence query or source ID.':'The local MCP request was rejected.'));else if(Object.hasOwn(response,'result'))item.resolve(response.result);else item.reject(failure('mcp_protocol','The evidence response had no result.'));}if(Buffer.byteLength(buffer)>768*1024)terminate(failure('mcp_protocol','Evidence response exceeds its size limit.'),processForAttempt);});
   const initialized=await request('initialize',{protocolVersion:VERSION,capabilities:{},clientInfo:{name:'campaign-compass-workflow',version:'1.0.0'}});
   if(initialized.value.protocolVersion!==VERSION||!initialized.value.capabilities?.tools)throw failure('mcp_protocol','The evidence server could not negotiate the pinned MCP protocol.');
   write({jsonrpc:'2.0',method:'notifications/initialized'});
   const listed=await request('tools/list',{});
   if(!Array.isArray(listed.value.tools)||!['search_evidence','fetch_source'].every(name=>listed.value.tools.some(t=>t.name===name)))throw failure('mcp_protocol','The evidence tool catalogue is incomplete.');
   if(child!==processForAttempt||closed)throw failure('mcp_closed','The local evidence process stopped during initialization.');
   ready=true;onEvent({protocol:'MCP',transport:'stdio',version:VERSION,node:'mcp-handshake',status:'completed',summary:'Initialized local read-only evidence server and discovered two tools.'});
  })().catch(error=>{terminate(error,processForAttempt);throw error;});
  return boot;
 }
 async function call(name,args,{signal}={}){
  if(signal?.aborted)throw failure('mcp_cancelled','Evidence retrieval was cancelled.');
  await ensure();if(signal?.aborted)throw failure('mcp_cancelled','Evidence retrieval was cancelled.');
  const started=performance.now();onEvent({protocol:'MCP',transport:'stdio',version:VERSION,tool:name,status:'running',summary:'Read-only local evidence request.'});
  try{const {value,id}=await request('tools/call',{name,arguments:args},{signal});
   if(value.isError||!value.structuredContent||typeof value.structuredContent!=='object')throw failure('mcp_tool_error','Local evidence is unavailable. Check its corpus integrity and source ID.');
   const transport={protocol:'MCP',version:VERSION,transport:'stdio',tool:name,requestId:id,durationMs:Math.round(performance.now()-started)};
   onEvent({...transport,status:'completed',summary:'Retrieved versioned local evidence.'});
   return {...value.structuredContent,transport};
  }catch(error){onEvent({protocol:'MCP',version:VERSION,transport:'stdio',tool:name,status:signal?.aborted?'cancelled':'error',durationMs:Math.round(performance.now()-started),summary:'Evidence request did not complete.'});throw error;}
 }
 return {
  searchEvidence:(query,filters={},limit=5,options={})=>call('search_evidence',{query,filters,limit},options),
  fetchSource:(sourceId,options={})=>call('fetch_source',{source_id:sourceId},options),
  async listTools(){await ensure();return (await request('tools/list',{})).value.tools;},
  status:()=>({protocol:'MCP',version:VERSION,transport:'stdio',ready,processId:child?.pid??null,scope:'shared-public-corpus',network:false}),
  close(){if(closed)return;closed=true;ready=false;failPending(failure('mcp_closed','The local evidence connection closed.'));child?.stdin.end();const current=child;if(current&&!current.killed){const timer=setTimeout(()=>current.kill(),200);timer.unref();current.once('exit',()=>clearTimeout(timer));}}
 };
}

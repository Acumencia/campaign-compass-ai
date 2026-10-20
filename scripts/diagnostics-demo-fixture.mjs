// OFFLINE TEST/RECORDING ONLY. Never used by production server.
import {createServer} from '../server.mjs';
import {createAPIProviders} from '../server/api-providers.mjs';
import {createChatGPTService} from '../server/chatgpt.mjs';
import {MemoryStore,mockProtocol} from '../tests/chatgpt-fixtures.mjs';
import {loadKnowledge,retrieve} from '../server/knowledge.mjs';
import {createRagService} from '../server/rag.mjs';
export async function startDemoFixture(){
 const corpus=await loadKnowledge(),state={fail:false,inputs:[],calls:0};
 const storage={mode:'integrated',spec:{provider:'TEST ONLY',model:'local-ranking',revision:'v1',dimensions:3},status:()=>({backend:'local',configured:true}),readiness:async()=>({status:'ready'}),search:async(c,q,o)=>({matches:retrieve(c,q,1,{sourceIds:o.sourceIds}),embeddingMs:0,searchMs:0,namespace:'offline-fixture',method:'TEST ONLY local ranking',integratedEmbedding:true})};
 const generation={testOnly:true,spec:{provider:'TEST ONLY',model:'source-copy-fixture',revision:'v1'},async generate(request){state.calls++;const data=JSON.parse(request.input);state.inputs.push(data);const qualified=data.evidence.filter(c=>(c.sourceId==='tote'&&c.heading==='Weather limits')||(c.sourceId==='pack'&&c.heading==='Care and price'));const chosen=qualified.length?qualified:data.evidence.slice(0,1);const answer={corpusVersion:data.corpusVersion,status:'answered',message:'',claims:chosen.map(c=>({text:c.text,citations:[{chunkId:c.chunkId,quote:c.text}]}))};if(state.fail)answer.claims[0].citations[0].quote='REJECTED_FIXTURE_TEXT_DO_NOT_DISPLAY';return answer;}};
 const rag=createRagService({config:{enabled:true},storage,generation,getCorpus:async()=>corpus,allowTestProviders:true,authorizeAccess:async({session})=>!!session});
 const apiKey=createAPIProviders({environment:{},fetcher:async()=>{throw Error('External requests disabled in fixture');}});
 const server=createServer({rag,loadCorpus:async()=>corpus,apiKey,chatgpt:createChatGPTService({store:new MemoryStore(),protocol:mockProtocol(),supported:false})});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,state,corpus,base:`http://127.0.0.1:${server.address().port}`,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
if(process.argv.includes('--serve')){const fixture=await startDemoFixture();fixture.state.fail=true;console.log(JSON.stringify({base:fixture.base,mode:'OFFLINE rejection fixture; no external providers'}));}

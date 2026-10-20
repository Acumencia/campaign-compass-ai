import {createPineconeStore} from './pinecone.mjs';
import {createOpenAIKeyService} from './openai-api-key.mjs';
import {createAnthropicKeyService} from './anthropic-api-key.mjs';
import {KnowledgeError} from './knowledge.mjs';
export function createAPIProviders({environment=process.env,fetcher=globalThis.fetch,timeoutMs=30000,storageConfig={backend:'local'},pineconeKey='',storageOverride=null}={}){
 const storage=storageOverride||(storageConfig.backend==='pinecone'?createPineconeStore({config:storageConfig,key:pineconeKey,fetcher,timeoutMs}):null);
 const services={openai:createOpenAIKeyService({environment,fetcher,timeoutMs}),anthropic:createAnthropicKeyService({environment,fetcher,timeoutMs})};
 const defaultProvider=['openai','anthropic'].includes(environment.CAMPAIGN_GENERATION_PROVIDER)?environment.CAMPAIGN_GENERATION_PROVIDER:'';
 const embeddingProvider=environment.CAMPAIGN_EMBEDDING_PROVIDER==='openai'?'openai':'';
 const labels={openai:'OpenAI API',anthropic:'Anthropic Claude API'};
 function forSession(session){
  const provider=session?.apiGenerationProvider??defaultProvider,service=services[provider];
  const embedding=embeddingProvider?services.openai.embedding:null;
  const status=()=>{const g=service?.status(),e=embeddingProvider?services.openai.status():null;
   return {...(g||{keyStatus:'not_selected',keyPresent:false,generationConfigured:false,generationModel:null,blocked:null,liveVerified:false}),storage:storage?.status()||{backend:'local'},retrievalConfigured:storage?storage.status().configured&&(storage.mode==='integrated'||!!embedding):!!embedding,enabled:!!(g?.enabled||e?.enabled||storage?.status().configured),provider,providerLabel:labels[provider]||'No API provider selected',embeddingProvider,embeddingBlocked:e?.blocked||null,embeddingsConfigured:!!embedding,embeddingModel:e?.embeddingModel||null,embeddingDimensions:e?.embeddingDimensions||null,providers:Object.entries(services).map(([id,s])=>({id,label:labels[id],...s.status()}))};};
  return {status,embedding,storage,generation:service?.generation||null,invokeMetric:(...args)=>{if(!service)throw new KnowledgeError(503,'provider_not_selected','Select an API generation provider first.');return service.invokeMetric(...args);}};
 }
 function select(session,provider){if(!session||!['','openai','anthropic'].includes(provider))throw new KnowledgeError(400,'invalid_provider','Choose OpenAI API, Anthropic Claude API, or no API provider.');session.apiGenerationProvider=provider;session.apiKeyConsent=false;}
 const initial=forSession();
 return {...initial,forSession,select};
}

import {KnowledgeError} from './knowledge.mjs';
import {createAPIProviders} from './api-providers.mjs';
// No automatic discovery of credentials, no API call on startup/status.
export function ragOptions(apiKey=createAPIProviders()){
  const state=apiKey.status();
  return {config:{enabled:state.enabled,maxEmbeddingCharacters:8000},embedding:apiKey.embedding,storage:apiKey.storage,generation:apiKey.generation,
    authorizeAccess:async({session})=>{const fail=message=>{throw new KnowledgeError(403,'provider_access_required',message);};if(session?.apiKeyConsent!==true)fail('Allow billed generation requests in API settings first.');if(state.storage?.backend==='pinecone'&&session?.pineconeConsent!==true)fail('Allow Pinecone uploads and search in Knowledge first.');if(state.storage?.config?.mode!=='integrated'&&session?.embeddingConsent!==true)fail('Allow embedding charges in Knowledge first.');if(apiKey.status().blocked)fail('Generation provider is paused. Review its error in API settings.');if(state.storage?.config?.mode!=='integrated'&&apiKey.status().embeddingBlocked)fail('Embedding provider is paused. Review its API settings.');return true;}};
}

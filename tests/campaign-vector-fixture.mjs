// Test-only retrieval fixture. No embeddings, vector service or model is called.
export function campaignVectorFixture(loadCatalog) {
  const chunk={chunkId:'brand-voice-chunk',sourceId:'brand-voice',contentHash:'voice-chunk-hash',text:'Synthetic brand guidance: warm, practical, evidence-led writing.',metadata:{synthetic:true},heading:'Voice',startLine:1,endLine:1};
  const result=()=>({layer:'brand',corpusVersion:'mock-brand-corpus-v1',method:'vector-cosine-v1',backend:'local',retrievalMode:'vector-only',matches:[{...structuredClone(chunk),sourceId:'brand:brand-voice'}]});
  return {
    chunk,
    retrieveBrand:async()=>result(),
    evidenceTools:{
      searchEvidence:async(_query,filters)=>filters.layer==='trail'?{layer:'trail',corpusVersion:'mock-trails',matches:(await loadCatalog()).trails}:{...result(),method:'lexical-test-only',retrievalMode:'lexical-offline'},
      fetchSource:async id=>id.startsWith('brand:')?{layer:'brand',corpusVersion:'mock-brand-corpus-v1',document:{sourceId:'brand:brand-voice',title:'Synthetic brand voice',text:chunk.text,contentHash:'mock-document-hash'},chunks:[structuredClone(chunk)]}:{layer:'trail',corpusVersion:'mock-trails',document:(await loadCatalog()).trails.find(t=>t.id===id)},
    },
  };
}

export function withCampaignVectorFixture(service,fixture){const advance=service.advance;service.advance=(owner,id,input={})=>advance(owner,id,{...input,retrieveBrand:fixture.retrieveBrand});return service;}

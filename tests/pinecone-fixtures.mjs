// TEST ONLY: no network; synthetic key and in-memory Pinecone responses.
import assert from 'node:assert/strict';
export const KEY='synthetic-pinecone-test-key-only';
export const config=(mode='integrated')=>({backend:'pinecone',mode,indexName:'demo',host:'demo.svc.test.pinecone.io',namespacePrefix:'campaign',model:mode==='integrated'?'test-embed':'text-embedding-3-small',dimensions:3,metric:'cosine',field:mode==='integrated'?'chunk_text':'embedding'});
export const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
export function mockPinecone(c=config(),family=c.mode==='integrated'?'records':'vectors'){
 const calls=[],namespaces={unrelated:[{id:'untouched'}]};let mutate=x=>x,intercept=null;
 const describe={name:c.indexName,host:c.host,status:{ready:true},...(family==='documents'?{schema:{fields:{[c.field]:{type:'dense_vector',dimension:c.dimensions,metric:c.metric}}}}:{dimension:c.dimensions,metric:c.metric,...(family==='records'?{embed:{model:c.model,field_map:{text:c.field}}}:{})})};
 const fetcher=async(url,o)=>{assert.equal(o.redirect,'error');assert.equal(o.headers['Api-Key'],KEY);assert.equal(o.headers['X-Pinecone-Api-Version'],'2026-07');const u=new URL(url);assert.ok(['api.pinecone.io',c.host].includes(u.host));const body=o.body?(o.headers['Content-Type']==='application/x-ndjson'?o.body.split('\n').map(JSON.parse):JSON.parse(o.body)):null;calls.push({url,method:o.method,body});if(intercept){const result=await intercept(url,o,body);if(result)return result;}
  if(u.host==='api.pinecone.io'){assert.equal(o.method,'GET');assert.equal(u.pathname,'/indexes/'+c.indexName);return json(describe);}
  if(u.pathname==='/describe_index_stats')return json({namespaces:Object.fromEntries(Object.entries(namespaces).map(([key,rows])=>[key,{vectorCount:rows.length}]))});
  const ns=body?.namespace||u.pathname.match(/\/namespaces\/([^/]+)/)?.[1];assert.ok(ns&&ns!=='unrelated');
  if(u.pathname.endsWith('/upsert')){const rows=family==='records'?body:family==='vectors'?body.vectors:body.documents;namespaces[ns]=[...(namespaces[ns]||[]),...rows];return family==='records'?new Response(null,{status:201}):json({upserted_count:rows.length});}
  assert.ok(u.pathname.endsWith('/search')||u.pathname==='/query');const filter=body.query?.filter||body.filter,top=body.query?.top_k||body.top_k||body.topK;const rows=(namespaces[ns]||[]).filter(row=>{const m=row.metadata||row;return m.cc_corpus===filter.cc_corpus.$eq&&(filter.cc_status?m.cc_status===filter.cc_status.$eq:filter.cc_source.$in.includes(m.cc_source));}).slice(0,top);
  return json(mutate({namespace:ns,...(family==='records'?{result:{hits:rows.map(row=>({_id:row._id,_score:0.9,fields:{...row,chunk_text:'REMOTE TEXT MUST NOT BE TRUSTED'}}))}}:{matches:rows.map(row=>family==='vectors'?{id:row.id,score:0.9,metadata:row.metadata}:{...row,_score:0.9})})}));
 };return {fetcher,calls,namespaces,describe,setMutate:fn=>mutate=fn,setIntercept:fn=>intercept=fn};
}
export function mockEmbedding(c){const calls=[];const spec={provider:'openai',model:c.model,revision:'fixture-v1',dimensions:c.dimensions};return {spec,calls,testOnly:true,async embed(texts,options){calls.push({texts,purpose:options.purpose});return {...spec,vectors:texts.map(()=>[1,0,0])};}};}

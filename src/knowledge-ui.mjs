export function wireKnowledge(document, fetcher=globalThis.fetch) {
  const $=s=>document.querySelector(s), dialog=$('#knowledge-dialog');
  let corpus, controller, ticket=0,busy=false,report=null,storageSaveError='',lastCheck=null,keySaveResult=null;
  let turns=[],activeTurn=null;
  const askWorkspace=$('#ask-workspace');let askOpened=false;
  if(askWorkspace){
    $('#ask-form-slot').append($('#knowledge-form'));
    const mode=$('#knowledge-mode');$('#ask-options-slot').append(document.querySelector('label[for="knowledge-mode"]'),mode,$('#knowledge-rag-options'));
    $('#ask-results-slot').append($('#knowledge-results'));$('#ask-source-slot').append($('#knowledge-source'));
    $('#knowledge-question').setAttribute('aria-describedby','ask-ready-detail');
    const observer=new document.defaultView.MutationObserver(()=>{
      $('#ask-status').textContent=$('#knowledge-status').textContent;
      $('#ask-empty').hidden=!!$('#knowledge-results').childElementCount;
      $('#ask-source-hint').hidden=!!$('#knowledge-source').childElementCount;
    });observer.observe($('#knowledge-status'),{childList:true,characterData:true,subtree:true});observer.observe($('#knowledge-results'),{childList:true});observer.observe($('#knowledge-source'),{childList:true});
  }
  function conversationPayload(){let history=turns.filter(t=>t.eligible).slice(-4).flatMap(t=>[{role:'user',content:t.question},{role:'assistant',content:t.summary.slice(0,800)}]);while(new TextEncoder().encode(JSON.stringify(history)).length>5000)history=history.slice(2);return history;}
  function renderTranscript(){
    const list=$('#ask-transcript');if(!list)return;list.replaceChildren();
    $('#ask-chat-summary').textContent=turns.length?`${turns.length} turns shown · ${conversationPayload().length/2} completed exchanges used as context`:'New chat. No previous turns.';
    for(const turn of turns){const row=element('li','');row.className='ask-turn';row.append(element('strong','You'),element('p',turn.question),element('strong',turn.status==='pending'?'Assistant · waiting':turn.status==='failed'?'Request failed':turn.status==='cancelled'?'Request cancelled':'Assistant'),element('p',turn.summary));
      if(turn.result){const b=element('button','View answer and sources');b.type='button';b.className='button';b.addEventListener('click',()=>{cancel();$('#knowledge-results').replaceChildren();$('#knowledge-source').replaceChildren();renderTurnResult(turn);$('#knowledge-results').tabIndex=-1;$('#knowledge-results').focus();});row.append(b);}
      if(!turn.eligible&&turn.status!=='pending')row.append(element('small','Not sent as conversation context.'));
      list.append(row);
    }
  }
  function resetChat(){cancel();turns=[];activeTurn=null;$('#knowledge-question').value='';$('#knowledge-results').replaceChildren();$('#knowledge-source').replaceChildren();renderTranscript();$('#knowledge-status').textContent='New chat. Previous turns cleared; provider permissions are unchanged.';$('#knowledge-question').focus();}
  $('#ask-new-chat')?.addEventListener('click',resetChat);
  function resultSummary(result){const answer=(result.mode==='comparison'?result.grounded:result).answer;return answer?.status==='answered'?answer.claims.map(c=>c.text).join(' '):answer?.message||result.notice||'Source search completed without a generated answer.';}
  function renderTurnResult(turn){const result=turn.result;if(turn.mode==='compare')showComparison(result);else if(turn.mode==='rag')showRag(result);else{const text=`Lexical retrieval only: ${result.retrieval.elapsedMs.toFixed(2)} ms. This excludes ingestion, network and generation. Scores are similarities, not confidence.`;$('#knowledge-results').append(element('p',text));if(!result.retrieval.matches.length)$('#knowledge-results').append(element('p','No lexical matches. Try specific product or policy words. No answer was generated.'));showMatches(result.retrieval.matches);}}
  function openAsk({load=true,focus=true}={}){
    if(!askWorkspace)return;
    if(busy){cancel();$('#knowledge-status').textContent='Cancelled on navigation. Already started provider work may still be billed.';}
    askWorkspace.hidden=false;$('#dashboard-workspace').hidden=true;
    if(dialog.open)dialog.close();
    document.querySelectorAll('#navigation .nav-item').forEach(b=>{b.classList.toggle('active',b.id==='ask-workspace-button');b.removeAttribute('aria-current');});$('#ask-workspace-button').setAttribute('aria-current','page');$('#breadcrumb').textContent='Ask';
    if(!askOpened){askOpened=true;$('#knowledge-mode').value='rag';modeChanged();}
    if(load)void refresh({preserve:true});
    if(focus)$('#knowledge-question').focus();
  }
  $('#ask-workspace-button')?.addEventListener('click',()=>openAsk());
  document.addEventListener('compass:dashboard',()=>{if(!askWorkspace||askWorkspace.hidden)return;if(busy){cancel();$('#knowledge-status').textContent='Cancelled on navigation. Already started provider work may still be billed.';}askWorkspace.hidden=true;$('#dashboard-workspace').hidden=false;$('#ask-workspace-button').classList.remove('active');$('#ask-workspace-button').removeAttribute('aria-current');});
  for(const id of ['#ask-sources','#ask-index-settings'])$(id)?.addEventListener('click',()=>{if(busy)cancel();$('#knowledge-button').click();if(id==='#ask-index-settings')$('#knowledge-live-setup').open=true;});
  $('#ask-settings')?.addEventListener('click',()=>{if(busy)cancel();$('#connection-button').click();});
  $('#connection-dialog')?.addEventListener('close',()=>{if(askWorkspace&&!askWorkspace.hidden)void refresh({preserve:true});});
  $('#ask-refresh')?.addEventListener('click',()=>void refresh({preserve:true}));
  $('#ask-cancel')?.addEventListener('click',()=>{cancel();$('#knowledge-status').textContent='Cancelled. Already started provider work may still be billed.';});
  document.querySelectorAll('[data-knowledge-example]').forEach(b=>b.addEventListener('click',()=>{$('#knowledge-question').value=b.dataset.knowledgeExample;$('#knowledge-question').dispatchEvent(new document.defaultView.Event('input'));$('#knowledge-question').focus();}));
  function renderAskReadiness(){
    if(!askWorkspace)return;const state=corpus?.rag,mode=$('#knowledge-mode').value;
    let title='Local knowledge unavailable',detail='Refresh status or open Sources and indexing. Use the local Node app to load the corpus.';
    if(corpus&&mode==='lexical'){title='Offline source search';detail='Search local passages without provider calls. This mode does not generate an answer.';}
    else if(state){const pc=state.storage?.backend==='pinecone',integrated=pc&&state.storage.config?.mode==='integrated';
      const configured=state.generation==='configured'&&state.embeddings==='configured',ready=state.index?.status==='ready';
      const permission=state.generationConsent&&(pc?state.pineconeConsent:true)&&(integrated||state.embeddingConsent);
      title=!configured?'Set up a provider to ask':!ready?'Retrieval setup needs attention':!permission?'Review request permissions':'Ready for cited answers';
      detail=!configured?'Choose a generation provider in API settings and configure retrieval in Sources and indexing. Offline source search is available.':!ready?'Open Retrieval setup to check the index for this corpus. No upload or connection check happens automatically.':!permission?'Open API settings and Retrieval setup to review session billing permissions. Nothing is enabled automatically.':`${state.generator?.model||'Selected model'} · ${corpus.documents.length} sources. Asking sends your question and relevant excerpts to configured providers.`;
    }
    $('#ask-ready-title').textContent=title;$('#ask-ready-detail').textContent=detail;
  }
  const operationButtons=['#knowledge-submit','#knowledge-build','#knowledge-evaluate','#knowledge-embedding-save','#knowledge-embedding-consent','#knowledge-refresh','#knowledge-storage-save','#knowledge-pinecone-key-save','#knowledge-pinecone-check','#knowledge-pinecone-consent','#knowledge-pinecone-setup','#api-pinecone-setup'];
  function setBusy(value){busy=value;for(const id of operationButtons)if($(id))$(id).disabled=value||(!corpus&&id==='#knowledge-submit');if($('#knowledge-cancel'))$('#knowledge-cancel').disabled=!value;renderStorageControls();if($('#ask-cancel'))$('#ask-cancel').disabled=!value;if($('#ask-refresh'))$('#ask-refresh').disabled=value;$('#knowledge-results').setAttribute('aria-busy',String(value));}
  const element=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
  function cancel(){if(activeTurn){activeTurn.status='cancelled';activeTurn.summary='Cancelled. No response from this request is included in future context.';activeTurn.eligible=false;activeTurn=null;renderTranscript();}if(keySaveResult?.state==='pending'){keySaveResult={state:'unknown',text:'Key save interrupted; completion is unconfirmed. Refresh corpus to check saved-key presence, which cannot identify whether a replacement succeeded.'};renderKeyStatus();}if(lastCheck?.state==='pending'){lastCheck={...lastCheck,state:'cancelled',text:'Connection check cancelled. No new successful result was confirmed.'};renderCheckResult();}clearPineconeKey();ticket++;controller?.abort();setBusy(false);}

  async function readJSONResponse(response,maxBytes=2000000){
    if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Knowledge requires the local Node server. Static preview has no Knowledge service.');
    const reader=response.body?.getReader();if(!reader)throw new Error('Empty local service response.');let text='',size=0;const decoder=new TextDecoder();
    try{while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new Error('Knowledge response exceeds its size limit.');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
    let data;try{data=JSON.parse(text);}catch{throw new Error('Invalid JSON from local Knowledge service.');}
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Invalid Knowledge response.');
    if(!response.ok){const error=new Error(data.error?.message||'Knowledge request failed.');error.code=typeof data.error?.code==='string'&&/^[a-z_]{1,80}$/.test(data.error.code)?data.error.code:'local_http_'+response.status;if(error.code==='invalid_answer'&&data.error?.diagnostics)error.diagnostics=data.error.diagnostics;throw error;}return data;
  }
  function showFailureDiagnostics(d){
    const box=element('details','');box.className='ask-diagnostics ask-failure-diagnostics';box.open=true;box.append(element('summary','Answer rejected: validation diagnostics'));
    box.append(element('p',`No rejected answer is displayed or included in conversation. Run ${d.runId}; ${d.category} / ${d.rule}; claim index ${d.claimIndex??'none'}, citation index ${d.citationIndex??'none'} (zero-based).`));
    box.append(element('p',`Resolved query: ${d.resolvedQuery}. Prior messages: ${d.conversationMessages}. Source filter: ${(d.sourceIds||[]).join(', ')||'all current sources'}. Scores are similarities, not confidence.`));
    for(const c of (d.matches||[])){const row=element('p',`${c.supplied?'SUPPLIED':'RETRIEVED ONLY'}: ${c.sourceId} / ${c.heading}; ${c.scoreKind} ${c.score}; ${c.chunkId} `);row.append(sourceButton(c.sourceId,'Inspect source'));box.append(row);}$('#knowledge-results').append(box);
  }
  async function request(action,body,signal){
    let csrf;
    if(['rag','compare','index','evaluate','pinecone-check'].includes(action)){
      const session=await readJSONResponse(await fetcher('/api/session',{signal,redirect:'error'}),128000);
      csrf=session.csrf;if(typeof csrf!=='string'||!csrf||csrf.length>200)throw new Error('Invalid local session response.');
    }
    return readJSONResponse(await fetcher(`/api/knowledge/${action}`,{method:'POST',headers:{'Content-Type':'application/json',...(csrf?{'X-CC-CSRF':csrf}:{})},body:JSON.stringify(body),signal,redirect:'error'}));
  }
  async function run(work,onError){cancel();controller=new AbortController();const current=ticket;setBusy(true);$('#knowledge-status').textContent='Working… Cancelling stops remaining work; already started requests may still be billed.';
    try{await work(controller.signal,()=>current===ticket);}
    catch(error){if(current===ticket&&error.name!=='AbortError'){$('#knowledge-status').textContent=error.message;onError?.(error);}}finally{if(current===ticket)setBusy(false);}
  }
  function sourceButton(sourceId,label){const button=element('button',label);button.className='button';button.type='button';button.addEventListener('click',()=>inspect(sourceId));return button;}
  async function inspect(sourceId){if(dialog.open&&askWorkspace)openAsk({load:false,focus:false});return run(async(signal,current)=>{
    const data=await request('source',{sourceId,corpusVersion:corpus.corpusVersion},signal);if(!current())return;
    if(data.corpusVersion!==corpus.corpusVersion||data.document.sourceId!==sourceId)throw new Error('Stale source response. Refresh Knowledge.');
    $('#knowledge-source').replaceChildren(element('h3',data.document.title),element('p',`${data.document.filename} · ${data.document.contentHash}`));
    const pre=element('pre',data.document.text.split('\n').map((l,i)=>`${i+1}  ${l}`).join('\n'));pre.className='knowledge-source-text';$('#knowledge-source').append(pre);$('#knowledge-source').tabIndex=-1;$('#knowledge-source').focus();
    $('#knowledge-status').textContent='Source opened. All content is synthetic demo material.';
  });}
  async function refresh({preserve=false}={}){const priorVersion=corpus?.corpusVersion,priorFilter=$('#knowledge-source-filter').value;if(!preserve){corpus=null;$('#knowledge-results').replaceChildren();$('#knowledge-source').replaceChildren();}$('#knowledge-documents').replaceChildren();$('#knowledge-submit').disabled=true;
    return run(async(signal,current)=>{const data=await request('manifest',{},signal);if(!current())return;
      if(data.schemaVersion!==1||!Array.isArray(data.documents)||typeof data.corpusVersion!=='string')throw new Error('Invalid corpus manifest.');
      if(priorVersion&&priorVersion!==data.corpusVersion){turns=[];activeTurn=null;renderTranscript();$('#knowledge-results').replaceChildren();$('#knowledge-source').replaceChildren();}corpus=data;storageSaveError='';$('#knowledge-storage-feedback').textContent='';$('#knowledge-submit').disabled=false;syncStorageForm();renderReadiness();
      $('#knowledge-status').textContent=`${data.documents.length} synthetic documents · ${data.chunkCount} chunks · lexical search · embeddings: ${data.rag?.embeddings||'not_configured'} · generation: ${data.rag?.generation||'not_configured'}`;
      $('#knowledge-version').textContent=`${data.corpusVersion} · ingested ${data.ingestedAt||'not recorded'}`;
      $('#knowledge-source-filter').replaceChildren(element('option','All sources'));$('#knowledge-source-filter').firstChild.value='';
      for(const doc of data.documents){$('#knowledge-documents').append(sourceButton(doc.sourceId,`${doc.title} (${doc.chunkCount} chunks; ${doc.metadata?.status||'active'})`));const option=element('option',doc.title);option.textContent+=` [${doc.metadata?.status||'active'}]`;option.value=doc.sourceId;$('#knowledge-source-filter').append(option);}if(preserve&&data.documents.some(d=>d.sourceId===priorFilter))$('#knowledge-source-filter').value=priorFilter;renderAskReadiness();
    });
  }
  $('#knowledge-button').addEventListener('click',()=>{if(busy)cancel();dialog.showModal();void refresh({preserve:true});});
  $('#knowledge-close').addEventListener('click',()=>{cancel();dialog.close();});dialog.addEventListener('close',()=>{if(!askWorkspace||askWorkspace.hidden)cancel();else renderAskReadiness();});dialog.addEventListener('cancel',cancel);
  $('#knowledge-refresh').addEventListener('click',()=>void refresh());
  $('#knowledge-question').addEventListener('input',()=>{if(!corpus)return;cancel();$('#knowledge-results').replaceChildren();$('#knowledge-source').replaceChildren();$('#knowledge-status').textContent='Question changed. Search to retrieve current sources.';});

  function modeChanged(){cancel();$('#knowledge-results').replaceChildren();$('#knowledge-source').replaceChildren();renderAskReadiness();$('#knowledge-rag-options').hidden=$('#knowledge-mode').value==='lexical';$('#knowledge-submit').textContent=$('#knowledge-mode').value==='compare'?'Run comparison (may bill)':$('#knowledge-mode').value==='rag'?'Ask':'Find sources';$('#knowledge-status').textContent='Mode or retrieval settings changed. Submit a new question.';}
  for(const id of ['#knowledge-mode','#knowledge-source-filter','#knowledge-top-k'])$(id).addEventListener('change',modeChanged);
  function showMatches(matches){
    for(const chunk of matches){const card=element('article','');card.className='quiet-card';card.append(element('h3',chunk.heading),element('p',chunk.text),element('p',`Lines ${chunk.startLine}–${chunk.endLine} · score ${chunk.score.toFixed(4)} (${chunk.scoreKind||'lexical cosine'}); ${chunk.evidenceRole||'retrieved source'}`),element('code',chunk.chunkId),element('p',`Source ${chunk.sourceId}; version ${chunk.metadata?.version||'unspecified'}; effective ${chunk.metadata?.effective||'unspecified'}; ${chunk.metadata?.status||'active'}; synthetic`),sourceButton(chunk.sourceId,'Inspect source'));$('#knowledge-results').append(card);}
  }
  function showRag(result){
    if(result.mode!=='rag'||!['not_configured','answered','clarification','insufficient_evidence'].includes(result.status))throw new Error('Invalid RAG result.');
    const matches=result.retrieval?.matches||[],ids=new Map(matches.map(c=>[c.chunkId,c]));
    if(matches.some(c=>!corpus.documents.some(d=>d.sourceId===c.sourceId)||!Number.isFinite(c.score)))throw new Error('Invalid retrieved source.');
    const answer=result.answer;
    if(result.status==='not_configured'&&(answer!==null||result.retrieval!==null))throw new Error('Invalid not-configured response.');
    if(answer){
      if(answer.status!==result.status||answer.corpusVersion!==corpus.corpusVersion||!Array.isArray(answer.claims))throw new Error('Invalid answer identity.');
      if(answer.status==='answered'){
        if(!answer.claims.length||answer.message!=='')throw new Error('Invalid cited answer.');
        for(const claim of answer.claims){if(typeof claim.text!=='string'||!Array.isArray(claim.citations)||!claim.citations.length)throw new Error('Missing citations.');
          for(const c of claim.citations){const chunk=ids.get(c.chunkId);if(!chunk||typeof c.quote!=='string'||!c.quote.trim()||!chunk.text.replace(/\s+/g,' ').includes(c.quote.replace(/\s+/g,' ').trim())||!result.diagnostics.contextChunkIds.includes(c.chunkId))throw new Error('Invalid citation.');}
        }
      }else if(answer.claims.length)throw new Error('Unexpected claims in a non-answer.');
    }else if(result.status==='answered'||result.status==='clarification')throw new Error('Missing generated response.');
    $('#knowledge-results').append(element('h3',result.status==='answered'?'Cited answer':result.status==='clarification'?'Clarification needed':result.status==='not_configured'?'RAG is not configured':result.basis==='context_gate'?'Source passages exceed request size':'Insufficient evidence'));
    if(answer?.status==='answered')for(const claim of answer.claims){const card=element('section','');card.className='quiet-card';card.append(element('p',claim.text));for(const citation of claim.citations){const chunk=ids.get(citation.chunkId);card.append(element('blockquote',citation.quote),element('code',citation.chunkId),sourceButton(chunk.sourceId,`Source · lines ${chunk.startLine}–${chunk.endLine}`));}$('#knowledge-results').append(card);}
    else if(answer?.message)$('#knowledge-results').append(element('p',answer.message));
    else if(result.notice)$('#knowledge-results').append(element('p',result.notice));
    if(result.basis==='local_clarification')$('#knowledge-results').append(element('p','Local clarification only. No retrieval or generation call was made. Reply with the missing details; completed turns in this chat can help resolve your next question.'));
    const detailStart=$('#knowledge-results').childNodes.length;
    if(result.diagnostics){const d=result.diagnostics;if(d.conversationMessages)$('#knowledge-results').append(element('p',`Conversation: ${d.conversationMessages} role-labelled messages. Retrieval query: ${d.resolvedQuery}. Reference resolution: ${d.resolution}. Prior assistant claims are not evidence.`));if(d.gateReason)$('#knowledge-results').append(element('p',`Processing outcome: ${d.gateReason}`));$('#knowledge-results').append(element('p',`${d.execution} · query embedding ${d.embeddingMs.toFixed(2)} ms · vector search ${d.searchMs.toFixed(2)} ms · generation ${d.generationMs===null?'not called':d.generationMs.toFixed(2)+' ms'} · pipeline ${d.totalMs.toFixed(2)} ms`),element('p',`Context: ${d.contextChunkIds.length} passages, ${d.contextCharacters} characters; ${d.omittedChunks} omitted. Similarity cutoff ${d.threshold} is uncalibrated. Scores are not confidence.`));}
    if(result.diagnostics?.backend==='pinecone')$('#knowledge-results').append(element('p',`Pinecone namespace: ${result.diagnostics.indexNamespace}. ${result.diagnostics.integratedEmbedding?'Pinecone search time includes integrated query embedding.':'Query embedding is measured separately.'}`));
    $('#knowledge-results').append(element('h3','Retrieved passages and supplied context'));
    if(result.retrieval?.vectorMatches)$('#knowledge-results').append(element('p','Coverage: semantic results plus local keyword matches; scores from different methods are not directly comparable. Historical comparison passages cannot support current claims.'));
    if(result.diagnostics?.clarificationCompletedLocally)$('#knowledge-results').append(element('p','The app added a device-dimensions clarification; no fit claim was inferred.'));
    for(const chunk of matches){$('#knowledge-results').append(element('p',`${result.diagnostics?.contextChunkIds.includes(chunk.chunkId)?'SUPPLIED TO MODEL':'RETRIEVED, NOT SUPPLIED'}: ${chunk.chunkId}`));showMatches([chunk]);}
    $('#knowledge-results').append(element('p',`Run ${result.runId||'fixture'}; ${result.startedAt||'not recorded'}; generation: ${result.providers?.generator?.provider||'not configured'} / ${result.providers?.generator?.model||'not configured'}; embedding: ${result.providers?.embedding?.model||'not configured'}; corpus ${result.corpusVersion}. Citation text matching does not prove semantic support.`));
    const details=element('details','');details.className='ask-diagnostics';details.append(element('summary','Retrieved passages and diagnostics'));for(const node of [...$('#knowledge-results').childNodes].slice(detailStart))details.append(node);$('#knowledge-results').append(details);
  }
  $('#knowledge-form').addEventListener('submit',event=>{event.preventDefault();if(!corpus||busy)return;
    const question=$('#knowledge-question').value,mode=$('#knowledge-mode').value,history=conversationPayload();
    if(!question.trim())return;
    $('#knowledge-results').replaceChildren();$('#knowledge-source').replaceChildren();let turn;
    void run(async(signal,current)=>{
      turn={question,mode,status:'pending',summary:'Waiting for this request. No completed answer yet.',eligible:false,result:null};activeTurn=turn;turns.push(turn);if(turns.length>20)turns.shift();renderTranscript();
      const ragMode=mode!=='lexical',filter=$('#knowledge-source-filter').value;
      const body={question,corpusVersion:corpus.corpusVersion,...(ragMode?{topK:Number($('#knowledge-top-k').value),sourceIds:filter?[filter]:[],conversation:history}:{})};
      const result=await request(mode==='compare'?'compare':ragMode?'rag':'ask',body,signal);if(!current())return;
      if(result.corpusVersion!==corpus.corpusVersion)throw new Error('Stale Knowledge response. Refresh sources.');
      if(!ragMode&&(result.mode!=='lexical'||result.answer!==null||!Array.isArray(result.retrieval?.matches)))throw new Error('Invalid Knowledge result.');
      renderTurnResult({...turn,result});
      turn.result=result;turn.summary=resultSummary(result);turn.status='complete';turn.eligible=ragMode&&['answered','clarification','insufficient_evidence'].includes((result.mode==='comparison'?result.grounded:result).status);activeTurn=null;renderTranscript();
      $('#knowledge-status').textContent=(result.providers?.testOnly||result.diagnostics?.execution==='TEST ONLY fixtures'?'TEST ONLY fixture response. ':'')+result.notice;
    },error=>{if(turn){turn.status='failed';turn.summary=error.message;turn.eligible=false;turn.result=null;}activeTurn=null;renderTranscript();if(error.diagnostics)showFailureDiagnostics(error.diagnostics);});
  });
  function pineconeCounts(index){
    if(index?.backend!=='pinecone'||!index.namespace)return '';
    const c=index.countCheck,valid=n=>Number.isSafeInteger(n)&&n>=0,expected=valid(index.expectedChunks)?index.expectedChunks:corpus?.chunkCount;
    const observed=valid(c?.observedCount)?c.observedCount:'unknown',total=valid(c?.totalIndexCount)?c.totalIndexCount:'unknown';
    const detail=!c?'No namespace count check recorded.':c.status==='missing_namespace'?'Selected namespace was absent from the stats response; this is not a confirmed zero.':c.status==='unknown_count'?'Selected namespace count was missing or invalid.':c.status==='mismatch'?'Count does not match the corpus. Indexing may still be catching up; check again later. Do not upload again solely for this mismatch.':'Selected namespace count matches the corpus.';
    return ` Selected namespace: ${index.namespace}. Indexed records: ${observed} / expected ${expected??'unknown'}. Total index records (all namespaces): ${total}; this total does not verify the selected namespace. Count checked at: ${c?.checkedAt||'not recorded'}. Readiness: ${index.status}. ${detail}`;
  }
  function renderReadiness(){
    renderAskReadiness();const state=corpus?.rag;if(!state)return;
    $('#knowledge-readiness').textContent=`Generation: ${state.generation}, ${state.generator?.model||'choose in API settings'}, permission ${state.generationConsent?'on':'off'}. Embeddings: ${state.embeddings}, ${state.embedding?.model||'choose below'}, permission ${state.embeddingConsent?'on':'off'}. Index: ${state.index?.status||'unknown'} — ${state.index?.message||'Refresh status'}. Ordinary current questions exclude archives. Version comparisons may include linked historical passages, labeled for comparison only; explicit source filters remain authoritative.`;
    $('#knowledge-readiness').textContent+=pineconeCounts(state.index);
    renderStorage(state);
    $('#knowledge-embedding-consent').textContent=state.embeddingConsent?'Pause embedding charges':'Allow embedding charges this session';
  }
  function showComparison(result){
    if(result.mode!=='comparison'||result.corpusVersion!==corpus.corpusVersion)throw new Error('Invalid comparison identity.');
    $('#knowledge-results').append(element('h3','Same-question comparison'),element('p',result.question),element('p',`Run ${result.runId}; ${result.startedAt}; ${result.providers.generator.model}; output cap ${result.maxOutputTokens??'server configured'} tokens; ${result.totalMs.toFixed(1)} ms. ${result.notice}`));
    $('#knowledge-results').append(element('h3','1. Deterministic lexical retrieval — no generated answer'));showMatches(result.baseline.retrieval.matches);
    $('#knowledge-results').append(element('h3','2. LLM without retrieval — unverified'),element('p',`No source passages supplied for this turn; conversation may include earlier answers. ${result.llmOnly.generationMs.toFixed(1)} ms; ${result.llmOnly.answer.status}`));
    if(result.llmOnly.answer.message)$('#knowledge-results').append(element('p',result.llmOnly.answer.message));for(const claim of result.llmOnly.answer.claims)$('#knowledge-results').append(element('p',claim.text));
    $('#knowledge-results').append(element('h3','3. Retrieval-grounded generation'));showRag(result.grounded);
  }
  async function updateReadiness(signal,current){const data=await request('manifest',{},signal);if(current()){corpus=data;renderReadiness();}}
  async function settings(route,body){if(busy)return;const storageSave=route==='/api/provider/storage',pineconeSave=route==='/api/provider/key'&&body.provider==='pinecone';let accepted=false;if(storageSave){storageSaveError='';$('#knowledge-storage-feedback').textContent='Saving backend settings locally...';}await run(async(signal,current)=>{if(pineconeSave){keySaveResult={state:'pending',text:'Saving Pinecone key locally... The entry field is cleared immediately; wait for confirmation here.'};renderKeyStatus();}const session=await readJSONResponse(await fetcher('/api/session',{signal,redirect:'error'}),128000);const result=await readJSONResponse(await fetcher(route,{method:'POST',headers:{'Content-Type':'application/json','X-CC-CSRF':session.csrf},body:JSON.stringify(body),signal,redirect:'error'}));if(!current())return;accepted=true;if(pineconeSave){keySaveResult={state:'saved',text:'Pinecone key saved successfully to local key.json. The blank password field is intentional; the saved value is never returned to the browser. Authentication has not been checked.'};if(corpus?.rag)corpus.rag.pineconeKeyStatus=result.keySettings?.pinecone||'configured';renderKeyStatus();}
    if(storageSave&&corpus&&result.apiKey?.storage){corpus.rag={...corpus.rag,storage:result.apiKey.storage,pineconeKeyStatus:result.keySettings?.pinecone,pineconeConsent:result.apiKey.pineconeConsent,embeddingConsent:result.apiKey.embeddingConsent,generationConsent:result.apiKey.consent};renderReadiness();}
    await updateReadiness(signal,current);if(current()){$('#knowledge-build-ack').checked=false;$('#knowledge-eval-ack').checked=false;$('#knowledge-status').textContent='Settings saved. Review current permissions and index readiness.';if(storageSave)$('#knowledge-storage-feedback').textContent=`Saved successfully. Active backend: ${corpus.rag?.storage?.backend==='pinecone'?'Pinecone':'Local'}. See the connection-check status directly below.`;}
  },error=>{if(pineconeSave){keySaveResult={state:accepted?'saved':'unconfirmed',text:accepted?'Pinecone key save succeeded, but readiness refresh failed. The entry field remains blank intentionally.':'Pinecone key save not confirmed: '+error.message+' A previously saved key may still be present; that does not confirm this replacement.'};renderKeyStatus();}if(storageSave){storageSaveError=accepted?'Settings were accepted, but readiness refresh failed. Refresh corpus to confirm the active settings.':'Save failed: '+error.message;$('#knowledge-storage-feedback').textContent=storageSaveError;}});}
  function renderKeyStatus(){const el=$('#knowledge-pinecone-key-status');if(!el)return;const present=corpus?.rag?.pineconeKeyStatus==='configured';el.textContent=present?'Saved Pinecone key: present in local key.json (server-reported status). Its value is never displayed. Presence alone does not confirm the latest replacement or successful authentication.':'Saved Pinecone key: not confirmed by current server status.';const result=$('#knowledge-pinecone-key-result');result.textContent=keySaveResult?.text||'No key save result in this page session. Blank input is expected even when a key is saved.';result.dataset.state=keySaveResult?.state||'none';}
  function clearPineconeKey(){if($('#knowledge-pinecone-key'))$('#knowledge-pinecone-key').value='';if($('#knowledge-pinecone-replace'))$('#knowledge-pinecone-replace').checked=false;}
  function draftStorageForm(){const pc=$('#knowledge-backend').value==='pinecone';$('#knowledge-pinecone-fields').hidden=!pc;renderStorageControls();}
  function syncStorageForm(){const c=corpus?.rag?.storage?.config;$('#knowledge-backend').value=c?'pinecone':'local';if(c)for(const [id,key]of [['mode','mode'],['name','indexName'],['host','host'],['prefix','namespacePrefix'],['model','model'],['dimensions','dimensions'],['field','field']])$('#knowledge-pinecone-'+id).value=c[key];draftStorageForm();}
  function renderStorage(state){const pc=state.storage?.backend==='pinecone',integrated=pc&&state.storage.config.mode==='integrated';$('#knowledge-pinecone-actions').hidden=false;renderStorageControls();$('#knowledge-external-embeddings').hidden=integrated;$('#knowledge-build').textContent=pc?'Upload corpus to Pinecone':'Build live index';$('#knowledge-pinecone-consent').textContent=state.pineconeConsent?'Pause Pinecone uploads and search':'Allow Pinecone uploads and search this session';const c=state.storage?.config;$('#knowledge-pinecone-destination').textContent=pc?`Saved destination: ${c.indexName} at ${c.host}; ${c.mode}, ${c.model}, ${c.dimensions} dimensions, cosine; namespace prefix ${c.namespacePrefix}; namespace ${state.index?.namespace||'allocated only on upload'}. Key: ${state.pineconeKeyStatus||'not_configured'}. Connection checked: ${state.storage.checked?'yes':'no'}.`:'Local vector file; no remote storage.';$('#knowledge-readiness').textContent+=pc?` Storage: Pinecone (${c.mode}); permission ${state.pineconeConsent?'on':'off'}. ${integrated?'Embedding is included in Pinecone search time; OpenAI embedding permission is not required.':''}`:' Storage: local.';}
  $('#knowledge-backend')?.addEventListener('change',()=>{cancel();storageSaveError='';$('#knowledge-storage-feedback').textContent='Backend choice changed; save to apply it.';draftStorageForm();$('#knowledge-status').textContent='Backend choice is unsaved. Save settings before running an operation.';});
  $('#knowledge-pinecone-key-details')?.addEventListener('toggle',()=>{if(!$('#knowledge-pinecone-key-details').open)clearPineconeKey();});
  function storageDraft(){return {backend:$('#knowledge-backend').value,mode:$('#knowledge-pinecone-mode').value,indexName:$('#knowledge-pinecone-name').value.trim(),host:$('#knowledge-pinecone-host').value.trim(),namespacePrefix:$('#knowledge-pinecone-prefix').value.trim(),model:$('#knowledge-pinecone-model').value.trim(),dimensions:Number($('#knowledge-pinecone-dimensions').value),metric:'cosine',field:$('#knowledge-pinecone-field').value.trim()};}
  function storageDirty(){const draft=storageDraft(),saved=corpus?.rag?.storage;if(draft.backend!==(saved?.backend||'local'))return true;if(draft.backend==='local')return false;return Object.entries(draft).some(([key,value])=>saved?.config?.[key]!==value);}
  function connectionBlock(){if(!corpus)return 'Load Knowledge from the local server first.';if(busy)return 'Wait for the current operation to finish, or cancel it.';if(storageSaveError)return storageSaveError;if(corpus.rag?.storage?.backend!=='pinecone')return 'Pinecone is not active. Click Save backend settings for this run after entering the Pinecone index settings.';if(storageDirty())return 'The form has unsaved changes. Click Save backend settings for this run before checking.';if(!corpus.rag.storage.configured)return 'Save your Pinecone key locally first.';return '';}
  function renderStorageControls(){if(!$('#knowledge-storage-state'))return;const saved=corpus?.rag?.storage?.backend||'local',draft=$('#knowledge-backend').value,dirty=storageDirty(),reason=connectionBlock();$('#knowledge-storage-state').textContent=`Active backend: ${saved==='pinecone'?'Pinecone':'Local'}. Form: ${draft==='pinecone'?'Pinecone':'Local'}${dirty?' (not saved). Save backend settings to apply these values.':'. Settings match the active backend.'}`;$('#knowledge-pinecone-check').disabled=!!reason;$('#knowledge-pinecone-check-reason').textContent=reason||'Ready to check the saved Pinecone index. This button reads index configuration; it does not upload sources.';$('#knowledge-pinecone-consent').disabled=!!reason;$('#knowledge-build').disabled=busy||dirty;renderCheckResult();renderKeyStatus();}
  for(const id of ['mode','name','host','prefix','model','dimensions','field'])$('#knowledge-pinecone-'+id)?.addEventListener('input',event=>{event.target.removeAttribute('aria-invalid');storageSaveError='';$('#knowledge-storage-feedback').textContent='Values edited; save to apply them.';renderStorageControls();});
  function validateStorageDraft(body){
    if(body.backend==='local')return null;
    const rules=[['name',/^[a-z0-9](?:[a-z0-9-]{0,43}[a-z0-9])?$/.test(body.indexName),'Enter the existing index name: 1-45 lowercase letters, digits or internal hyphens.'],['host',/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.svc\.(?:[a-z0-9-]+\.)*pinecone\.io$/.test(body.host)&&!body.host.includes('.private.'),'Index host must be a public hostname ending in .pinecone.io, with .svc. in it. Paste only the hostname; remove https:// and any trailing slash.'],['prefix',/^[a-z][a-z0-9-]{0,19}$/.test(body.namespacePrefix),'Namespace prefix must start with a lowercase letter and contain 1-20 lowercase letters, digits or hyphens.'],['model',/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(body.model),'Enter the exact embedding model ID, using letters, digits, periods, underscores or hyphens.'],['dimensions',Number.isInteger(body.dimensions)&&body.dimensions>=1&&body.dimensions<=4096,'Enter the index dimensions as a whole number from 1 to 4096.'],['field',/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(body.field)&&!body.field.startsWith('cc_'),'Enter the text/vector field name, starting with a letter; use letters, digits or underscores and no cc_ prefix.']];
    return rules.find(([,valid])=>!valid)||null;
  }
  $('#knowledge-storage-save')?.addEventListener('click',()=>{if(busy)return;const body=storageDraft(),issue=validateStorageDraft(body);if(issue){storageSaveError='Not saved: '+issue[2];$('#knowledge-storage-feedback').textContent=storageSaveError;$('#knowledge-status').textContent=storageSaveError;const input=$('#knowledge-pinecone-'+issue[0]);input.setAttribute('aria-invalid','true');input.focus();renderStorageControls();return;}void settings('/api/provider/storage',body);});
  $('#knowledge-pinecone-key-save')?.addEventListener('click',()=>{if(busy)return;const key=$('#knowledge-pinecone-key').value,replace=$('#knowledge-pinecone-replace').checked;clearPineconeKey();void settings('/api/provider/key',{provider:'pinecone',key,replace});});
  $('#knowledge-pinecone-consent')?.addEventListener('click',()=>void settings('/api/provider/pinecone-consent',{enabled:!corpus?.rag?.pineconeConsent}));
  function checkConfig(){return JSON.stringify(corpus?.rag?.storage?.config||null);}
  function renderCheckResult(){const el=$('#knowledge-pinecone-check-result');if(!el)return;const state=corpus?.rag;
    if(lastCheck){let text=lastCheck.text;if(corpus&&(lastCheck.config!==checkConfig()||lastCheck.namespace&&lastCheck.namespace!==state?.index?.namespace))text+=' These results belong to earlier settings or namespace; check the current saved configuration and upload.';else if(corpus&&lastCheck.state==='success'&&!state?.storage?.checked)text+=' Current server status is not marked checked; check again after reviewing saved settings.';el.textContent=text;el.dataset.state=lastCheck.state;}
    else if(state?.storage?.checked){el.textContent='The server reports a completed compatibility check. Corpus readiness: '+(state.index?.status||'unknown')+'. Checking does not upload documents.'+pineconeCounts(state.index);el.dataset.state='previous';}
    else{el.textContent='No successful connection check is recorded for the current settings. Click Check Pinecone connection when enabled.';el.dataset.state='none';}
  }
  $('#knowledge-pinecone-check')?.addEventListener('click',event=>{event.preventDefault();if(connectionBlock())return;const config=checkConfig();void run(async(signal,current)=>{
    lastCheck={state:'pending',config,text:'Checking Pinecone authentication and index compatibility... No documents are being uploaded.'};renderCheckResult();
    const result=await request('pinecone-check',{corpusVersion:corpus.corpusVersion},signal);if(!current())return;
    if(result.checked!==true)throw new Error('The server did not confirm a compatible connection.');
    const ready=result.status==='ready';lastCheck={state:'success',config,namespace:result.namespace,text:`Connection check succeeded: Pinecone accepted the request and the index configuration is compatible. ${ready?'Corpus upload and indexed count are verified.':result.status==='missing'?'No corpus has been uploaded for these settings. Connection success does not mean RAG is ready.':`Corpus readiness: ${result.status}. ${result.message||''}`} No documents were uploaded by this check.${pineconeCounts(result)}`};
    if(corpus?.rag?.storage){corpus.rag.storage.checked=true;corpus.rag.index=result;}renderCheckResult();$('#knowledge-status').textContent=lastCheck.text;
    try{await updateReadiness(signal,current);}catch(error){if(!current())return;lastCheck.text+=' Local readiness refresh failed; the completed check result is retained. Refresh corpus to retry status.';renderCheckResult();}
  },error=>{const auth=error.code==='pinecone_auth'||error.code==='pinecone_http'&&/HTTP 401\b/.test(error.message);const detail=auth?'Pinecone rejected authentication (HTTP 401). Verify the complete Pinecone key saved in this app and its project. Generation-provider keys do not authenticate Pinecone. No automatic retry was made.':error.message;lastCheck={state:'error',config,text:`Connection check failed (${error.code||'local_request_failed'}): ${detail} No successful check was confirmed by this attempt.`};renderCheckResult();});});
  async function openPineconeSetup(){
    if(busy)return;
    if(!dialog.open){$('#connection-dialog')?.close();dialog.showModal();await refresh();}
    if(!corpus)return;
    $('#knowledge-live-setup').open=true;
    $('#knowledge-backend').value='pinecone';draftStorageForm();
    $('#knowledge-pinecone-key-details').open=true;
    $('#knowledge-status').textContent='Pinecone key entry is open. Save your key locally, then save index/backend settings. This shortcut makes no remote call and does not switch the saved backend.';
    $('#knowledge-pinecone-key').scrollIntoView?.({block:'center'});$('#knowledge-pinecone-key').focus();
  }
  for(const id of ['#api-pinecone-setup','#knowledge-pinecone-setup'])$(id)?.addEventListener('click',()=>void openPineconeSetup());
  $('#knowledge-api-settings')?.addEventListener('click',()=>{dialog.close();$('#connection-button').click();});
  $('#knowledge-embedding-save')?.addEventListener('click',()=>void settings('/api/provider/embedding',{model:$('#knowledge-embedding-model').value,dimensions:Number($('#knowledge-embedding-dimensions').value)}));
  $('#knowledge-embedding-consent')?.addEventListener('click',()=>void settings('/api/provider/embedding-consent',{enabled:!corpus?.rag?.embeddingConsent}));
  $('#knowledge-cancel')?.addEventListener('click',()=>{cancel();$('#knowledge-status').textContent='Cancelled. Already started provider work may still be billed.';});
  for(const [id,action,ack]of [['#knowledge-build','index','#knowledge-build-ack'],['#knowledge-evaluate','evaluate','#knowledge-eval-ack']])$(id)?.addEventListener('click',()=>{
    if(busy||!corpus)return;if(!$(ack).checked){$('#knowledge-status').textContent='Acknowledge the charges for this operation first.';return;}$(ack).checked=false;
    void run(async(signal,current)=>{const result=await request(action,{corpusVersion:corpus.corpusVersion},signal);if(!current())return;if(action==='evaluate'){report=result;$('#knowledge-download').disabled=false;$('#knowledge-operation-results').replaceChildren(element('h3','Evaluation report'),element('pre',JSON.stringify(result.summary,null,2)),element('p','Download individual scores, failures and manual-review fields. Valid quotes do not establish factual correctness.'));$('#knowledge-status').textContent=result.execution;}else if(result.backend==='pinecone'){await updateReadiness(signal,current);if(current())$('#knowledge-status').textContent=`Uploaded ${result.chunks} chunks to ${result.indexName}, namespace ${result.namespace}. ${result.notice}`;}else{$('#knowledge-status').textContent=`Index built: ${result.chunks} chunks, ${result.providerBatches} embedding batches. Refresh corpus to verify readiness.`;}});
  });
  $('#knowledge-download')?.addEventListener('click',()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='rag-evaluation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  return {refresh,cancel};
}
if(typeof document!=='undefined' && document.querySelector('#knowledge-button'))wireKnowledge(document);

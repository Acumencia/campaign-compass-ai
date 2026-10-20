// Documentation-verified generation suggestions, 2026-10-18; never account availability.
export const MODEL_SUGGESTIONS={openai:['gpt-6-astra','gpt-6-sol','gpt-6-luna'],anthropic:['claude-sonnet-5-5','claude-haiku-5-5','claude-opus-5-5']};
export function generationSuggestions(provider,catalog=MODEL_SUGGESTIONS){const list=catalog?.[provider];return Array.isArray(list)?list.filter(id=>typeof id==='string'&&(provider==='openai'?/^gpt-[a-zA-Z0-9._-]+$/:provider==='anthropic'?/^claude-[a-zA-Z0-9._-]+$/:/^$/).test(id)).slice(0,20):[];}
const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function wireConnectionUI(client,cancel,{catalog=MODEL_SUGGESTIONS}={}){
 const $=selector=>document.querySelector(selector);
 let busy=false,pendingProvider=null,draftProvider=null,modelDirty=false,message='',keyView='';
 const validKey=value=>value.length>=20&&value.length<=512&&!/\s|[^\x21-\x7e]/.test(value);
 function readiness(){
  const a=client.state.apiKey,k=client.state.keySettings,p=a?.provider;
  if(!client.available)return ['LOCAL_SERVER_REQUIRED','Start npm start, open this local app, then refresh status.'];
  if(!k)return ['SERVER_UPDATE_REQUIRED','Restart the server and hard-refresh to load API settings.'];
  if(!k.available)return ['KEY_STORAGE_UNAVAILABLE','Key storage is unavailable. Check local file access or format while the server is stopped; existing keys are preserved.'];
  if(!p)return ['PROVIDER_REQUIRED','Choose Anthropic or OpenAI above.'];
  if(!(k[p]==='configured'||a.keyPresent))return ['KEY_REQUIRED','Save a key for '+a.providerLabel+'.'];
  const adapter=a.providers?.find(x=>x.id===p);
  if(!adapter?.enabled||!a.generationModel)return ['MODEL_REQUIRED','Enter a permitted model ID and save the model for this run.'];
  if(a.maxOutputTokens===null)return ['OUTPUT_LIMIT_INVALID','Choose an output limit from 128 to 8192 and save the model.'];
  if(a.blocked)return ['PROVIDER_PAUSED','The provider paused requests. Review its permissions or billing; no automatic retry will occur.'];
  if(!a.generationConfigured)return ['GENERATION_NOT_READY','Review this provider’s key and model settings. Embeddings are not required for campaign briefs.'];
  if(!a.consent)return ['CONSENT_REQUIRED','Setup is ready. Allow billed requests only when you are ready to use the API.'];
  return ['READY','Permission is on. Asking for a campaign brief or question can incur API charges.'];
 }
 function render(){
  const a=client.state.apiKey||{},p=a.provider||'',k=client.state.keySettings||{},selected=pendingProvider??p,saved=k[p]==='configured';
  $('#api-generation-provider').value=selected;$('#api-generation-provider').disabled=busy||!client.available;
  const choices=generationSuggestions(p,catalog),picker=$('#api-model-choice');
  if(draftProvider!==p||!modelDirty){
    picker.innerHTML='<option value="">Choose a model</option>'+choices.map(id=>`<option value="${escapeHTML(id)}">${escapeHTML(id)}</option>`).join('')+'<option value="custom">Custom model ID</option>';
    $('#api-model-id').value=a.generationModel||'';picker.value=a.generationModel?(choices.includes(a.generationModel)?a.generationModel:'custom'):'';$('#api-output-limit').value=a.maxOutputTokens||2048;draftProvider=p;
  }
  picker.disabled=busy||!p;$('#api-model-custom').hidden=picker.value!=='custom';
  $('#api-model-note').textContent=choices.length?'Documentation suggestions; your account access has not been checked. Choose Custom model ID if needed.':'Choose a provider, or use Custom model ID when suggestions are unavailable. No account lookup is performed.';

  $('#api-model-id').placeholder=p==='anthropic'?'Your permitted claude- model ID':p==='openai'?'Your permitted gpt- model ID':'Choose a provider first';
  const keyViewNow=p+':'+(saved||!!a.keyPresent);if(keyViewNow!==keyView){$('#api-key-details').open=!!p&&!saved&&!a.keyPresent;keyView=keyViewNow;}
  $('#key-saved-status').textContent=saved?'Saved':a.keyPresent?'Configured on server':'Not saved';
  $('#key-replace-label').hidden=!saved;$('#key-value').disabled=busy||!p||!k.available;
  $('#key-replace').disabled=busy;$('#api-model-id').disabled=busy||!p;$('#api-output-limit').disabled=busy||!p;
  const key=$('#key-value').value;
  $('#key-save').disabled=busy||!client.available||!k.available||!p||!validKey(key)||(saved&&!$('#key-replace').checked);
  $('#key-save-help').textContent=!p?'Choose the provider first.':!key?(saved?'Your saved key is retained. Enter a new key only to replace it.':'Enter the selected provider’s key.'):!validKey(key)?'Use 20-512 printable characters without spaces.':saved&&!$('#key-replace').checked?'Confirm replacement of this provider’s saved key.':'Ready to save locally. No API request will be made.';
  $('#api-model-status').textContent=a.generationConfigured?'Configured':'Not configured';
  $('#api-model-apply').disabled=busy||!client.available||!k.available||!p;
  const [code,next]=readiness();$('#api-next-action').textContent=busy?'Updating local settings...':next;$('#api-status-code').textContent=busy?'UPDATING':code;
  $('#api-key-enable').disabled=busy||!client.available||(!a.consent&&code!=='CONSENT_REQUIRED');$('#api-key-enable').textContent=a.consent?'Pause API requests':'Allow billed requests this session';
  $('#api-try-brief').disabled=busy||code!=='READY';$('#key-check-service').disabled=busy;
  $('#api-verification').textContent=a.lastIssue?`${a.lastIssue.message} Diagnostic: ${a.lastIssue.code}${Number.isInteger(a.lastIssue.httpStatus)?`; HTTP ${a.lastIssue.httpStatus}`:''}${a.lastIssue.requestId?`; request ${a.lastIssue.requestId}`:''}.`:a.liveVerified?'This provider returned a successful generation response.':'Live API access has not been verified. Setup actions do not test or bill the API.';
  $('#api-settings-message').textContent=message;
  for(const banner of document.querySelectorAll('[data-connection-banner]'))banner.innerHTML=`<strong>${escapeHTML(a.consent&&a.generationConfigured?a.providerLabel+' · API permission on':'API requests off')}</strong><span>${escapeHTML(next)}</span>`;
 }
 async function refresh(){if(busy)return;await client.refresh();render();}
 const errors={invalid_settings:'Nonsecret local settings could not be saved. Review key.json.settings.json locally; existing settings were not overwritten.',invalid_model:'Use a permitted model ID for this provider and an output cap from 128 to 8192.',invalid_key:'The key format is invalid. Enter it again without whitespace.',replace_required:'Confirm replacement of the saved key, then enter it again.',invalid_store:'Local key storage is invalid or unsafe. It was not overwritten.',store_busy:'A save is already in progress. Try again shortly.',invalid_session:'The local session expired. Refresh status and retry.',settings_unavailable:'Restart the local server and hard-refresh for updated API settings.',api_not_ready:'Generation is not ready. Refresh status to see the specific next step.'};
 async function mutate(route,body,success){
  if(busy)return;busy=true;message='';cancel();render();
  try{client.state=await client.api(route,{body});client.available=true;success?.();}
  catch(e){message=errors[e.code]||'Local settings could not be updated. Refresh status; if the server is older, restart it and hard-refresh. No credentials are displayed.';}
  finally{if(Object.hasOwn(body,'key'))body.key='';busy=false;pendingProvider=null;render();}
 }
 $('#api-generation-provider').addEventListener('change',()=>{pendingProvider=$('#api-generation-provider').value;$('#key-value').value='';$('#key-replace').checked=false;modelDirty=false;void mutate('/api/provider/select',{provider:pendingProvider});});
 $('#key-value').addEventListener('input',render);$('#key-replace').addEventListener('change',render);
 $('#api-key-form').addEventListener('submit',event=>{event.preventDefault();if($('#key-save').disabled)return;const body={provider:client.state.apiKey.provider,key:$('#key-value').value,replace:$('#key-replace').checked};$('#key-value').value='';$('#key-replace').checked=false;void mutate('/api/provider/key',body,()=>{message='Key saved. Continue with the model below.';});});
 $('#api-model-choice').addEventListener('change',()=>{modelDirty=true;$('#api-model-id').value=$('#api-model-choice').value==='custom'?'':$('#api-model-choice').value;render();});
 for(const id of ['#api-model-id','#api-output-limit'])$(id).addEventListener('input',()=>{modelDirty=true;});
 $('#api-model-form').addEventListener('submit',event=>{event.preventDefault();if($('#api-model-apply').disabled)return;void mutate('/api/provider/configure',{provider:client.state.apiKey.provider,enabled:true,model:$('#api-model-id').value.trim(),maxOutputTokens:Number($('#api-output-limit').value)},()=>{modelDirty=false;message='Model saved locally across restarts. API permission is still off.';});});
 $('#api-key-enable').addEventListener('click',()=>void mutate('/api/provider/consent',{enabled:!client.state.apiKey?.consent}));
 $('#api-try-brief').addEventListener('click',()=>{$('#connection-dialog').close();$('#brief-button').click();});
 $('#key-check-service').addEventListener('click',()=>{message='';void refresh();});
 $('#connection-button').addEventListener('click',()=>{$('#connection-dialog').showModal();void refresh();});
 $('#close-connection').addEventListener('click',()=>$('#connection-dialog').close());
 $('#connection-dialog').addEventListener('close',()=>{$('#key-value').value='';$('#key-replace').checked=false;render();});
 const ready=refresh();return {render,refresh,ready};
}

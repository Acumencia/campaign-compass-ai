const esc = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function wireConnectionUI(client, cancel) {
  const $ = selector => document.querySelector(selector);
  function render() {
    const state = client.state;
    const ready = state.connected && state.sharing && state.model && !state.blocked;
    document.querySelectorAll('[data-connection-banner]').forEach(banner => {
      banner.innerHTML = `<span class="dot ${ready ? '' : 'amber'}"></span><strong>${ready ? 'Using ChatGPT plan' : state.connected ? 'ChatGPT connected' : 'Deterministic demo'}</strong><span>${ready ? esc(state.models.find(model => model.slug === state.model)?.displayName || state.model) : state.connected ? 'Choose a permitted model to use your plan' : 'No live model connected'}</span>`;
    });
    $('#connection-status').textContent = state.notice || (state.connected ? `${state.label} · ${state.email || 'Verified account'}${state.sharing ? ' · Plan permission enabled' : ' · Plan permission disabled'}` : 'Not connected. Demo mode is available without signing in.');
    $('#connection-account').textContent = state.connected ? `${state.label} · ${state.email || 'Verified account'}` : '';
    $('#connection-csrf').value = state.csrf || '';
    const picker = $('#connection-profile'), selected = picker.value || state.profileId || '';
    picker.innerHTML = '<option value="">Add a new ChatGPT connection</option>' + state.profiles.map(profile => `<option value="${esc(profile.id)}">${esc(profile.label)}${profile.email ? ' · ' + esc(profile.email) : ''}</option>`).join('');
    picker.value = state.profiles.some(profile => profile.id === selected) ? selected : '';
    $('#continue-chatgpt').disabled = !client.available || !state.supported;
    $('#connection-support').hidden = state.supported;
    $('#connection-model').innerHTML = '<option value="">Choose an available model</option>' + (state.models || []).map(model => `<option value="${esc(model.slug)}">${esc(model.displayName)}</option>`).join('');
    $('#connection-model').value = state.model || '';
    $('#connection-model').disabled = !state.sharing || !!state.blocked;
    $('#refresh-models').disabled = !state.sharing || !!state.blocked;
    $('#disconnect-chatgpt').disabled = !state.connected;
    $('#use-saved-connection').disabled = !state.profiles.some(profile => profile.id === picker.value && profile.availableInSession);
    $('#plan-welcome').hidden = !state.welcome;
    $('#retry-usage').hidden = state.blocked !== 'subscription_sharing_usage_limit_exceeded';
    $('#connection-limit').textContent = state.blocked === 'subscription_sharing_usage_limit_exceeded' ? 'Usage limit reached. Manage usage is the next step; no reset time is assumed.' : state.blocked === 'subscription_sharing_user_not_eligible' ? 'This account, workspace or policy is not eligible. Requests are paused; signing in repeatedly will not bypass the restriction.' : '';
    $('#connection-usage').textContent = state.usage ? `Last completed request: ${state.usage.input} input + ${state.usage.output} output = ${state.usage.total} tokens. See ChatGPT for plan and app limits.` : 'Plan balance and reset time are not available here. Review them in ChatGPT Settings.';
  }
  async function refresh() { await client.refresh(); render(); }
  async function action(route, body = {}) {
    cancel();
    try { client.state = await client.api(route, {body}); render(); }
    catch (error) { await refresh(); $('#connection-status').textContent = error.message; }
  }
  $('#connection-button').addEventListener('click', async () => { $('#connection-dialog').showModal(); await refresh(); });
  $('#close-connection').addEventListener('click', () => $('#connection-dialog').close());
  $('#connection-form').addEventListener('submit', () => { cancel(); }); // Native redirect; OAuth credentials never enter JS.
  $('#connection-profile').addEventListener('change', () => {
    $('#use-saved-connection').disabled = !client.state.profiles.some(profile => profile.id === $('#connection-profile').value && profile.availableInSession);
  });
  $('#use-saved-connection').addEventListener('click', () => action('/api/chatgpt/select', {profileId: $('#connection-profile').value}));
  $('#connection-model').addEventListener('change', () => { if ($('#connection-model').value) action('/api/chatgpt/model', {slug: $('#connection-model').value}); });
  $('#refresh-models').addEventListener('click', async () => {
    try { await client.api('/api/chatgpt/models'); await refresh(); }
    catch (error) { await refresh(); $('#connection-status').textContent = error.message; }
  });
  $('#disconnect-chatgpt').addEventListener('click', () => action('/api/chatgpt/disconnect'));
  $('#cancel-connection').addEventListener('click', () => action('/api/chatgpt/cancel'));
  $('#welcome-got-it').addEventListener('click', () => action('/api/chatgpt/acknowledge'));
  $('#retry-usage').addEventListener('click', () => action('/api/chatgpt/retry-usage'));
  const ready = refresh().then(() => { if (client.state.welcome || client.state.notice?.includes('Sign-in')) $('#connection-dialog').showModal(); });
  return {render, refresh, ready};
}

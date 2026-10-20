import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generationSuggestions} from '../src/connection-ui.mjs';
test('generation suggestions are provider-specific and have a custom-only fallback',()=>{
 assert.equal(generationSuggestions('openai').length,3);assert.equal(generationSuggestions('anthropic').length,3);
 assert.deepEqual(generationSuggestions('openai',{openai:['claude-sonnet-5-5','text-embedding-3-small','gpt-6-sol']}),['gpt-6-sol']);assert.deepEqual(generationSuggestions('anthropic',null),[]);assert.deepEqual(generationSuggestions('unknown'),[]);
});
test('API-only UI has one provider selector and no delegated-login controls',async()=>{const html=await readFile(new URL('../index.html',import.meta.url),'utf8');assert.doesNotMatch(html,/id="(?:key-provider|continue-chatgpt|connection-profile|connection-form|api-adapter-enabled)"|Continue with ChatGPT|connected ChatGPT model/);assert.match(html,/id="api-model-choice"/);assert.match(html,/id="api-status-code"/);});

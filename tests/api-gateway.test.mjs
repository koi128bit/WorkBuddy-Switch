import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';

const module = await import('../desktop/api-gateway.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('api-gateway.mjs')) return {};
  throw error;
});
const {ApiGateway, apiDefaults, validateApiConfig} = module;
const document = (id, global = false) => ({id, token:'private-token-'+id, tokenExpiresAt:null, root:{auth:{domain:global?'www.workbuddy.ai':'www.workbuddy.cn'},account:{}}});
function stream(content = 'private-reply', extra = {}) {
  return new Response([
    {id:'real-request-1',debug:'upstream-private-debug',choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}],...extra},
    {id:'real-request-1',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:7,completion_tokens:3,total_tokens:10}},
  ].map(value=>'data: '+JSON.stringify(value)+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n',{headers:{'content-type':'text/event-stream'}});
}
async function fixture(t, request) {
  assert.equal(typeof ApiGateway,'function','本地 API 网关尚未实现');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wbs-api-'));
  const key=randomBytes(32);
  const vault={available:()=>true,encrypt(raw){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(raw),cipher.final(),cipher.getAuthTag()]);},decrypt(bytes){const d=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));d.setAuthTag(bytes.subarray(-16));return Buffer.concat([d.update(bytes.subarray(12,-16)),d.final()]).toString();}};
  const calls=[];
  const stores=new Map(['workbuddy','workbuddy-global'].map(provider=>[provider,{
    records:(provider==='workbuddy'?['a','b']:['g']).map(id=>({profile:{id,nickname:id,quota:null,protectedToken:false},apiEncrypted:'fixture-encrypted'})),
    apiDocument(id){assert.ok(this.records.some(r=>r.profile.id===id));return document(id,provider==='workbuddy-global');},
    async exclusive(action){return action();},
    async authorized(id,action){try{return await action(this.apiDocument(id));}catch(error){if(error.kind!=='auth')throw error;return action({...this.apiDocument(id),token:'renewed-token'});}},
  }]));
  const gateway=new ApiGateway({directory,vault,stores,listenPort:0,request:async(url,options)=>{
    calls.push({url,options});
    if(request)return request(url,options);
    if(url.endsWith('/v3/config'))return Response.json({code:0,data:{models:[{id:'fast-model',name:'快速模式',maxInputTokens:128000,maxOutputTokens:8192,supportsToolCall:true},{id:'disabled',disabled:true}]}});
    return stream();
  }});
  t.after(async()=>{await gateway.stop();await fs.rm(directory,{recursive:true,force:true});});
  await gateway.init();
  await gateway.saveConfig({...apiDefaults,accounts:[{provider:'workbuddy',id:'a'},{provider:'workbuddy',id:'b'},{provider:'workbuddy-global',id:'g'}]});
  const status=await gateway.start();
  const headers={Authorization:'Bearer '+gateway.getKey(),'Content-Type':'application/json'};
  const send=(body={},other={})=>fetch(gateway.snapshot().baseUrl+'/chat/completions',{method:'POST',headers,body:JSON.stringify({model:'fast-model',messages:[{role:'user',content:'private-client-prompt'}],...body}),...other});
  return {gateway,directory,vault,stores,calls,headers,status,send};
}
test('API configuration rejects remote binds, unknown options, invalid accounts and unbounded limits',()=>{
  assert.equal(typeof validateApiConfig,'function','API 配置校验尚未实现');
  assert.throws(()=>validateApiConfig({...apiDefaults,host:'0.0.0.0'}));
  for(const patch of [{port:0},{port:70000},{maxConcurrency:100},{maxOutputTokens:0},{requestsPerMinute:0},{strategy:'unknown'},{accounts:[{provider:'trae-cn',id:'a'}]},{accounts:[{provider:'workbuddy',id:'a'},{provider:'workbuddy',id:'a'}]}]) assert.throws(()=>validateApiConfig({...apiDefaults,...patch}));
  assert.equal(validateApiConfig(apiDefaults).autoStart,false);
});
test('gateway binds only loopback, requires a key and rejects browser origins and rebinding hosts',async t=>{
  const f=await fixture(t);
  assert.match(f.status.baseUrl,/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  assert.equal((await fetch(f.status.baseUrl+'/models')).status,401);
  assert.equal((await fetch(f.status.baseUrl+'/models',{headers:{...f.headers,Origin:'https://evil.example'}})).status,403);
  const rebinding=await new Promise((resolve,reject)=>{const req=http.get(f.status.baseUrl+'/models',{headers:{...f.headers,Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
  assert.equal(rebinding,403);
  assert.equal(f.calls.length,0);
  assert.ok(!JSON.stringify(f.gateway.snapshot()).includes(f.gateway.getKey()));
});
test('models are discovered from the selected official region and never include disabled entries',async t=>{
  const f=await fixture(t);
  const result=await (await fetch(f.status.baseUrl+'/models',{headers:f.headers})).json();
  assert.equal(result.object,'list');
  assert.deepEqual(result.data.map(row=>row.id),['fast-model','global:fast-model']);
  assert.equal(result.data[0].context_window,128000);
  assert.ok(f.calls.some(call=>call.url==='https://copilot.tencent.com/v3/config'));
  assert.ok(f.calls.some(call=>call.url==='https://www.workbuddy.ai/v3/config'));
  await fetch(f.status.baseUrl+'/models',{headers:f.headers});
  assert.equal(f.calls.length,2,'model discovery is cached');
});
test('non-streaming chat aggregates real output and usage without exposing upstream private fields',async t=>{
  const f=await fixture(t);
  const response=await f.send({max_completion_tokens:64});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.object,'chat.completion');assert.equal(result.choices[0].message.content,'private-reply');
  assert.deepEqual(result.usage,{prompt_tokens:7,completion_tokens:3,total_tokens:10});
  assert.ok(!JSON.stringify(result).includes('upstream-private-debug'));
  const body=JSON.parse(f.calls[0].options.body);
  assert.equal(body.stream,true);assert.equal(body.max_tokens,64);assert.equal(body.max_completion_tokens,undefined);
  assert.equal(body.messages[0].content,'private-client-prompt');
  assert.equal(f.calls[0].options.redirect,'error');
  assert.equal(f.gateway.snapshot().totals.succeeded,1);
});
test('streaming replies preserve actual tool calls and reasoning while rebuilding OpenAI frames',async t=>{
  const f=await fixture(t,async()=>new Response([
    'data: '+JSON.stringify({id:'tool-real',choices:[{index:0,delta:{role:'assistant',reasoning_content:'brief',tool_calls:[{index:0,id:'call_real',type:'function',function:{name:'lookup',arguments:'{"x":'}}]},finish_reason:null}]})+'\n\n',
    'data: '+JSON.stringify({id:'tool-real',choices:[{index:0,delta:{tool_calls:[{index:0,function:{arguments:'1}'}}]},finish_reason:'tool_calls'}]})+'\n\n','data: [DONE]\n\n',
  ].join(''),{headers:{'content-type':'text/event-stream'}}));
  const response=await f.send({stream:true,tools:[{type:'function',function:{name:'lookup',parameters:{type:'object'}}}]});
  const body=await response.text();
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);
  assert.match(body,/call_real/);assert.match(body,/reasoning_content/);assert.match(body,/\[DONE\]/);
  assert.equal(JSON.parse(f.calls[0].options.body).tools[0].function.name,'lookup');
});
test('account rotation, explicit global model names and session affinity never cross regions',async t=>{
  const f=await fixture(t);
  await f.send({conversation_id:'session-one'});await f.send({conversation_id:'session-one'});
  assert.equal(f.calls[0].options.headers['X-User-Id'],f.calls[1].options.headers['X-User-Id']);
  await f.send({messages:[{role:'user',content:'different-session'}]});
  assert.notEqual(f.calls[0].options.headers['X-User-Id'],f.calls[2].options.headers['X-User-Id']);
  await f.send({model:'global:fast-model'});
  assert.equal(f.calls[3].url,'https://www.workbuddy.ai/v2/chat/completions');
  assert.equal(f.calls[3].options.headers['X-User-Id'],'g');
  assert.equal(JSON.parse(f.calls[3].options.body).model,'fast-model');
  assert.equal(f.gateway.snapshot().recent[0].model,'global:fast-model');
});
test('invalid bodies, excessive outputs and unsupported request fields never reach upstream',async t=>{
  const f=await fixture(t);
  for(const body of [{messages:[]},{messages:[{role:'root',content:'bad'}]},{max_tokens:999999},{n:2},{api_key:'wrong-secret'},{messages:[{role:'user',content:[{type:'image_url',image_url:{url:'file:///etc/passwd'}}]}]}]) assert.equal((await f.send(body)).status,400);
  assert.equal((await f.send({}, {body:'not-json'})).status,400);
  assert.equal((await f.send({}, {body:'x'.repeat(8*1024*1024+1)})).status,413);
  assert.equal(f.calls.length,0);
});
test('refused channels and partial streams are failures and never trigger another paid call',async t=>{
  const f=await fixture(t,async()=>new Response('data: '+JSON.stringify({id:'partial',choices:[{delta:{content:'partial'}}]})+'\n\n',{headers:{'content-type':'text/event-stream'}}));
  const response=await f.send();assert.equal(response.status,502);assert.equal(f.calls.length,1);
  assert.equal(f.gateway.snapshot().totals.succeeded,0);
  f.gateway.request=async()=>Response.json({code:11128,message:'request illegal private-token-a'},{status:403});
  const refused=await f.send({conversation_id:'second'});assert.equal(refused.status,403);
  const text=await refused.text();assert.match(text,/upstream_access_denied/);assert.ok(!text.includes('private-token'));
});
test('rate limits cool only the selected account and model, and a later request can use another eligible account',async t=>{
  let count=0;
  const f=await fixture(t,async()=>++count===1?Response.json({code:6004},{status:429,headers:{'Retry-After':'120'}}):stream('ok'));
  const limited=await f.send();assert.equal(limited.status,429);assert.equal(count,1);
  assert.equal((await f.send({conversation_id:'another'})).status,200);
  assert.equal(count,2);assert.notEqual(f.calls[0].options.headers['X-User-Id'],f.calls[1].options.headers['X-User-Id']);
  assert.ok(f.gateway.snapshot().accounts.find(row=>row.id===f.calls[0].options.headers['X-User-Id']).cooldownUntil>Date.now());
});
test('metadata persists encrypted keys and real token totals without storing prompts or model replies',async t=>{
  const f=await fixture(t);const secret=f.gateway.getKey();
  await f.send();await f.gateway.stop();
  const config=await fs.readFile(path.join(f.directory,'api-gateway.json'),'utf8');
  const usage=await fs.readFile(path.join(f.directory,'api-usage.json'),'utf8');
  for(const raw of [config,usage]) for(const sensitive of [secret,'private-client-prompt','private-reply','private-token-a']) assert.ok(!raw.includes(sensitive));
  const restored=new ApiGateway({directory:f.directory,vault:f.vault,stores:f.stores,listenPort:0});
  await restored.init();t.after(()=>restored.stop());
  assert.equal(restored.getKey(),secret);assert.equal(restored.snapshot().running,false);assert.equal(restored.snapshot().totals.outputTokens,3);
});
test('key rotation invalidates old clients without exposing either key in status or usage',async t=>{
  const f=await fixture(t);const previous=f.gateway.getKey();await f.gateway.rotateKey();
  assert.notEqual(f.gateway.getKey(),previous);
  assert.equal((await fetch(f.status.baseUrl+'/models',{headers:f.headers})).status,401);
  assert.ok(!JSON.stringify(f.gateway.snapshot()).includes(f.gateway.getKey()));
});
test('concurrency control and stopping abort in-flight upstream work and release every lease',async t=>{
  let entered;const ready=new Promise(resolve=>entered=resolve);let aborted=false;
  const f=await fixture(t,async(_url,options)=>{entered();return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));},{once:true}));});
  await f.gateway.stop();await f.gateway.saveConfig({...f.gateway.snapshot().config,maxConcurrency:1});await f.gateway.start();
  const pending=f.send().catch(()=>null);await ready;
  assert.equal((await f.send({conversation_id:'parallel'})).status,429);
  await f.gateway.stop();await pending;assert.equal(aborted,true);assert.equal(f.gateway.snapshot().activeRequests,0);assert.equal(f.gateway.snapshot().running,false);
});
test('no selected credentials means no listener can be started and startup errors remain visible',async t=>{
  const f=await fixture(t);await f.gateway.stop();await f.gateway.saveConfig({...f.gateway.snapshot().config,accounts:[]});
  await assert.rejects(f.gateway.start(),/账号/);assert.equal(f.gateway.snapshot().running,false);
});

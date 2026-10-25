import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAuth} from '../desktop/auth.mjs';
let api = {}; try { api = await import('../desktop/activity.mjs'); } catch {}
const document = parseAuth(JSON.stringify({account:{uid:'fixture-user',nickname:'Fixture'},auth:{accessToken:'fixture-secret',domain:'www.workbuddy.cn'}}));
const task=(code,current=0,target=1)=>({code,title:code,status:'accepted',current,target,claimed:false,locked:false,claimable:false,hasReward:true});
const json=data=>new Response(JSON.stringify({code:0,data}),{headers:{'content-type':'application/json'}});
const stream=()=>new Response('data: {"id":"server-request-1","choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"id":"server-request-1","choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});

test('activity catalog covers current desktop, template, library, team, and targeted expert tasks with explicit manual reasons',()=>{
  assert.equal(typeof api.activitySpec,'function');
  for (const code of ['RichMeow_Chat','expert_5','Expert_team_use_3','Expert_lighthouse','WorkBuddy_Valorant','expert_use_maidehao','expert_use_douyinyin','expert_use_shangjia_xuanchuan','expert_use_bowangwang','skill_1','template_5','playbook_prompt','Library_read','Hp_Appearance','create_canvas','automation_1','Buddy_App','Buddy_App_QQ']) assert.ok(api.activitySpec(task(code)),code);
  assert.equal(api.activitySpec(task('unknown-from-server')),null);
  for (const code of ['wb_wechat_oa_subscribe_task','Expert_Philanthropy','first_buddy']) assert.match(api.pendingReason(task(code)),/本人|授权|协议|捐款|关注/);
  assert.equal(api.activitySpec({...task('expert_5'),locked:true}),null);
  assert.equal(api.activitySpec({...task('Library_read'),claimed:true}),null);
});

test('activity records are bounded, sent only to official endpoints, and never locally mark tasks complete',async()=>{
  assert.equal(typeof api.executeActivity,'function');const calls=[];
  const result=await api.executeActivity(document,{kind:'template',code:'template_5',index:0},async(url,options)=>{calls.push({url,options});return json({});});
  assert.equal(result.dialogue,null);assert.ok(calls.length>0);
  assert.ok(calls.every(call=>call.url==='https://copilot.tencent.com/v2/report'));
  const events=calls.flatMap(call=>JSON.parse(call.options.body));assert.ok(events.some(event=>event.eventCode==='template_used'));
  assert.ok(!events.some(event=>event.eventCode==='chat_message_response'));
  assert.ok(!JSON.stringify(result).includes('fixture-secret'));
  assert.ok(!('claimed' in result));assert.ok(calls.every(call=>call.options.redirect==='error'));
  await assert.rejects(()=>api.executeActivity(document,{kind:'donation',code:'Expert_Philanthropy'},()=>{throw Error('must not send');}),/任务|支持|范围/);
});

test('targeted experts are selected from real market results by exact name and preserve only public metadata',async()=>{
  assert.equal(typeof api.loadActivityResources,'function');
  const resources=await api.loadActivityResources(document,api.activitySpec(task('expert_use_douyinyin')),async(url,options)=>{
    assert.equal(url,'https://copilot.tencent.com/portal/operation-platform/market/expert/list');assert.equal(JSON.parse(options.body).keyword,'抖音策略师');
    return json({experts:[{expert_id:'wrong',display_name_zh:'其他专家'},{expert_id:'verified-expert',display_name_zh:'抖音策略师',expert_type:'agent',profession_zh:'运营',version:'1.0.0',private_secret:'do not expose'}]});
  });
  assert.equal(resources.length,1);assert.equal(resources[0].id,'verified-expert');assert.equal(resources[0].name,'抖音策略师');assert.ok(!JSON.stringify(resources).includes('private_secret'));
});

test('expert activities use a bounded real conversation and join only the actual server request receipt',async()=>{
  assert.equal(typeof api.executeActivity,'function');const calls=[];
  const result=await api.executeActivity(document,{kind:'expert',code:'expert_5',model:'fast-model',prompt:'你好',resource:{id:'verified-expert',name:'数据分析师',type:'agent',version:'1.0.0'}},async(url,options)=>{calls.push({url,options});return url.endsWith('/chat/completions')?stream():json({});});
  const chat=calls.find(call=>call.url.endsWith('/chat/completions'));assert.ok(chat);assert.equal(chat.options.headers['X-Expert-Id'],'verified-expert');assert.equal(JSON.parse(chat.options.body).max_tokens,64);
  const events=calls.filter(call=>call.url.endsWith('/report')).flatMap(call=>JSON.parse(call.options.body));const use=events.find(event=>event.eventCode==='expert_actual_use');assert.ok(use);assert.equal(use.id,'verified-expert');assert.equal(use.requestId,'server-request-1');assert.equal(result.dialogue.requestId,'server-request-1');
  assert.ok(!JSON.stringify(result).includes('fixture-secret'));
});

test('failed paid activities never fabricate a successful use event or retry a paid request',async()=>{
  assert.equal(typeof api.executeActivity,'function');let paid=0,reports=0;
  await assert.rejects(()=>api.executeActivity(document,{kind:'expert',code:'expert_5',model:'fast-model',prompt:'你好',resource:{id:'verified-expert',name:'专家',type:'agent'}},async(url)=>{if(url.endsWith('/chat/completions')){paid++;return new Response(null,{status:429});}reports++;return json({});}),/服务|额度|停止/);
  assert.equal(paid,1);assert.equal(reports,0);
});

test('activity errors sanitize credentials and refuse foreign accounts and mismatched action types',async()=>{
  assert.equal(typeof api.executeActivity,'function');
  await assert.rejects(()=>api.executeActivity(document,{kind:'library',code:'Library_read'},async()=>new Response(JSON.stringify({code:500,message:'fixture-secret'}),{headers:{'content-type':'application/json'}})),error=>!error.message.includes('fixture-secret'));
  for (const action of [{kind:'library',code:'expert_5'},{kind:'expert',code:'expert_5',resource:{id:'../../bad',name:'X'}}]) await assert.rejects(()=>api.executeActivity(document,action,()=>{throw Error('must not send');}),/任务|范围|专家|资源/);
  const other=parseAuth(JSON.stringify({account:{uid:'other'},auth:{accessToken:'other',domain:'www.workbuddy.ai'}}));
  await assert.rejects(()=>api.executeActivity(other,{kind:'library',code:'Library_read'},()=>{throw Error('must not send');}),/国内/);
});

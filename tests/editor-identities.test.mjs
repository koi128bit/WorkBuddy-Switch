import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EditorStore} from '../desktop/editor-store.mjs';
import {defaults} from '../desktop/settings.mjs';
import {parseTraeIdentity} from '../desktop/credential-codecs.mjs';
const authKey='iCubeAuthInfo://icube.cloudide';
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wb-identities-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const settings={...defaults,traeDataPath:path.join(directory,'Trae CN'),traeGlobalDataPath:path.join(directory,'Trae')};
  let writes=0;const vault={available:()=>true,encrypt:value=>Buffer.from(value).map(b=>b^85),decrypt:value=>Buffer.from(value).map(b=>b^85).toString()};
  const controller={status:async()=>({installed:true,running:false,executable:'fixture'}),stop:async()=>{writes++;},assertStopped:async()=>{},launch:async()=>{}};
  const identities={identify:async(provider,document)=>parseTraeIdentity(document.entries[authKey])};
  const store=new EditorStore({directory,vault,settings:()=>settings,controllers:{'trae-cn':controller,'trae-global':controller},context:{home:directory,env:{},platform:'linux'},identities});await store.init();
  const set=async(uid,token)=>{const file=path.join(settings.traeDataPath,'User/globalStorage/storage.json');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify({[authKey]:{userId:uid,token,refreshToken:'fixture-refresh',account:{name:'林'}}}));};
  return {store,directory,set,writes:()=>writes};
}
test('native account capture deduplicates by real UID after access token rotation',async t=>{
  const f=await fixture(t);await f.set('42','token-a');const first=await f.store.capture('trae-cn','当前账号');await f.set('42','token-b');const second=await f.store.capture('trae-cn','再次读取');
  assert.equal(first.uid,'42');assert.equal(second.id,first.id);assert.equal(f.store.records.length,1);assert.equal(second.originalNickname,'林');assert.equal(second.nativeAvailable,true);assert.equal(JSON.stringify(second).includes('token-b'),false);
});
test('web accounts remain encrypted, region isolated, and cannot fake desktop login',async t=>{
  const f=await fixture(t);assert.equal(typeof f.store.saveCredential,'function');
  const credential={uid:'9',nickname:'明',token:'sensitive-access',refreshToken:'sensitive-refresh',expiresAt:Date.now()+60000,user:{name:'明'}};
  const profile=await f.store.saveCredential('trae-cn',credential);assert.equal(profile.nativeAvailable,false);
  const other=await f.store.saveCredential('trae-global',credential);assert.notEqual(other.id,profile.id);
  assert.equal((await fs.readFile(f.store.file,'utf8')).includes('sensitive-'),false);
  await assert.rejects(f.store.switchAccount('trae-cn',profile.id),/客户端.*登录|完整.*登录/);assert.equal(f.writes(),0);
});
test('web authorization links only to a complete native snapshot with the same UID',async t=>{
  const f=await fixture(t);assert.equal(typeof f.store.saveCredential,'function');
  const web=await f.store.saveCredential('trae-cn',{uid:'42',nickname:'林',token:'web-token',refreshToken:'web-refresh',expiresAt:null});
  await f.set('other','native-other');const other=await f.store.capture('trae-cn','另一个');assert.notEqual(other.id,web.id);
  await f.set('42','native-42');const linked=await f.store.capture('trae-cn','当前');assert.equal(linked.id,web.id);assert.equal(linked.nativeAvailable,true);
  assert.equal(f.store.credential('trae-cn',web.id).token,'web-token','captured stale client token does not replace web authorization');
  const reloaded=new EditorStore({...f.store,identities:f.store.identities});await reloaded.init();assert.equal(reloaded.records.length,2);
});
test('opaque compatibility capture remains usable when a vendor changes the codec',async t=>{
  const f=await fixture(t);f.store.identities.identify=async()=>{throw new Error('当前客户端版本无法识别');};await f.set('42','token');const profile=await f.store.capture('trae-cn','兼容');assert.equal(profile.nativeAvailable,true);assert.equal(profile.uid,null);assert.match(profile.identityError,/无法识别/);
});

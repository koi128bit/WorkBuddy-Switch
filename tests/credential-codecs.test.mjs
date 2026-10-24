import test from "node:test";
import assert from "node:assert/strict";
const module = async () => {const result = await import("../desktop/credential-codecs.mjs").catch(()=>({}));assert.equal(typeof result.extractTraePeppers,"function","client credential codecs must be implemented");return result;};
test("Trae constants are resolved from static byte arrays without running client code",async()=>{
  const m=await module(); const a=Array.from({length:64},(_,i)=>i),b=a.map(x=>x+64),c=a.map(x=>x+128),d=a.map(x=>x+192);
  const code=`function key(n,t=Mode.AES){let o=new Uint8Array(n);if(t===Mode.AES_PRIVATE)for(let i=0;i<n;i++)o[i]=secretA[i]^secretB[i];else if(t===Mode.AES)for(let i=0;i<n;i++)o[i]=publicA[i]^publicB[i];return o}const secretA=new Uint8Array([${c}]),secretB=new Uint8Array([${d}]),publicA=Uint8Array.from([${a}]),publicB=Uint8Array.from([${b}]);`;
  const peppers=m.extractTraePeppers(code); assert.deepEqual(peppers.aes,Buffer.alloc(64,64)); assert.deepEqual(peppers.private,Buffer.alloc(64,64));
  assert.throws(()=>m.extractTraePeppers(code.replace('publicA=Uint8Array.from([','publicA=Uint8Array.from([runCode(),')),/无法识别|常量/);
});
test("Trae envelope verifies integrity before returning JSON",async()=>{
  const m=await module(),pepper=Buffer.alloc(64,7),payload={userId:"fixture-a",token:"fixture-access",refreshToken:"fixture-refresh",expiredAt:"2027-01-01T00:00:00Z",account:{name:"A",other:"preserve"}};
  const raw=m.encryptTrae(payload,pepper);assert.deepEqual(m.decryptTrae(raw,pepper),payload);
  const damaged=Buffer.from(raw,"base64");damaged[damaged.length-18]^=1;assert.throws(()=>m.decryptTrae(damaged.toString("base64"),pepper));
  assert.throws(()=>m.decryptTrae(raw,Buffer.alloc(64,8)));
});
test("Qoder native encryption has explicit Mac, Windows and Linux formats",async()=>{
  const m=await module();const raw=JSON.stringify({schemaVersion:1,user:{id:"uid",name:"A"},token:"fake-access",refreshToken:"drt-fake"});
  for(const options of [{platform:"darwin",password:"fixture-password"},{platform:"linux",password:"fixture-password",version:"v11"},{platform:"win32",key:Buffer.alloc(32,4)}]){
    const ciphertext=m.encryptChromium(raw,options);assert.equal(m.decryptChromium(ciphertext,options),raw);
    assert.equal(ciphertext.toString("ascii",0,3),options.version || "v10");
    assert.throws(()=>m.decryptChromium(ciphertext,{...options,password:"bad",key:Buffer.alloc(32,5)}));
  }
});
test("normalized native identities reject missing or conflicting user IDs",async()=>{
  const m=await module();const user=m.parseQoderIdentity({user:{id:17,name:"开发"},token:"fake",refreshToken:"drt-fake"});
  assert.equal(user.uid,"17");assert.equal(user.nickname,"开发");assert.throws(()=>m.parseQoderIdentity({token:"fake",user:{email:"not-an-id"}}));
  const token=`a.${Buffer.from(JSON.stringify({data:{id:"other"}})).toString("base64url")}.b`;
  assert.throws(()=>m.parseTraeIdentity({userId:"uid",token,refreshToken:"r"}),/身份/);
});

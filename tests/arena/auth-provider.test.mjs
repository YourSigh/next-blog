import test from 'node:test';import assert from 'node:assert/strict';import{createHash}from'node:crypto';
import{WechatQrLogin,wechatQrUrl}from'../../src/lib/arena/camp/wechat-qr.mjs';
import{QQQrLogin,parseCallback,parseQQCallback,parseQQRedirect,qrToken}from'../../src/lib/arena/camp/qq-qr.mjs';
const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const json=x=>new Response(JSON.stringify(x));
const wait=()=>new Promise(resolve=>setTimeout(resolve,35));
test('WeChat signs the official SDK QR request and confirms only the matching flow',async()=>{
 const u=new URL(wechatQrUrl('ticket',{nonce:'nonce',timestamp:'123'}));assert.equal(u.origin,'https://open.weixin.qq.com');assert.equal(u.searchParams.get('signature'),createHash('sha1').update('appid=wxf4b1e8a3e9aaf978&noncestr=nonce&sdk_ticket=ticket&timestamp=123').digest('hex'));
 let received=0;let transient;
 const provider=new WechatQrLogin({pollDelayMs:1,onAuthorization:async data=>{received++;assert.equal(data.code,'official-code-value');transient=data;},network:async value=>{const p=new URL(value).pathname;if(p==='/a/getwxsdkticket')return json({returnCode:0,data:{sdkTicket:'ticket'}});if(p==='/connect/sdk/qrconnect')return json({errcode:0,uuid:'testuuid123',appname:'王者营地',qrcode:{qrcodebase64:png.toString('base64')}});return json({wx_errcode:405,wx_code:'official-code-value'});}});
 try{const qr=await provider.start();assert.match(qr.qrImage,/^data:image\/png/);await wait();assert.equal(received,1);assert.equal(provider.poll().status,'authenticated');assert.equal(transient.code,'');assert.ok(!JSON.stringify(provider.poll()).includes('official-code-value'));}finally{await provider.stop();}
});
test('WeChat cancelled and invalid target QR responses do not authorize anyone',async()=>{
 let authorized=0;const p=new WechatQrLogin({pollDelayMs:1,onAuthorization:async()=>{authorized++;},network:async url=>new URL(url).pathname==='/a/getwxsdkticket'?json({returnCode:0,data:{sdkTicket:'ticket'}}):json({errcode:0,uuid:'testuuid123',appname:'Other App',qrcode:{qrcodebase64:png.toString('base64')}})});await assert.rejects(p.start());assert.equal(authorized,0);await p.stop();
});
test('QQ HTTP flow keeps cookies private and only accepts the expected official callback',async()=>{
 let state,received=0,transient;const requests=[];
 const p=new QQQrLogin({pollDelayMs:1,onAuthorization:async value=>{received++;transient=value;assert.equal(value.accessToken,'a'.repeat(32));},network:async(url,init)=>{
  requests.push({url,init});const u=new URL(url);
  if(u.pathname==='/oauth2.0/m_authorize'){state=u.searchParams.get('state');return new Response('var src = "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=716027609&daid=381&pt_3rd_aid=1105200115&s_url=https%3A%2F%2Fconnect.qq.com&style=35&state='+state+'";');}
  if(u.pathname==='/cgi-bin/xlogin')return new Response('official',{headers:{'set-cookie':'pt_login_sig=private; Domain=.ptlogin2.qq.com; Path=/'}});
  if(u.pathname==='/ptqrshow')return new Response(png,{headers:{'set-cookie':'qrsig=private-qrsig; Domain=.ptlogin2.qq.com; Path=/'}});
  assert.equal(u.pathname,'/ptqrlogin');assert.ok(init.headers.Cookie.includes('qrsig=private-qrsig'));assert.equal(u.searchParams.get('ptqrtoken'),String(qrToken('private-qrsig')));
  return new Response("ptuiCB('0','0','auth://tauth.qq.com/#access_token="+'a'.repeat(32)+'&openid='+'b'.repeat(32)+'&state='+state+"','0','ok','');");
 }});
 try{await p.start();await wait();assert.equal(received,1);assert.equal(p.poll().status,'authenticated');assert.equal(transient.accessToken,'');assert.equal(p.jar.length,0);assert.ok(requests.every(r=>new URL(r.url).hostname.endsWith('.qq.com')));}finally{await p.stop();}
 assert.equal(parseCallback('auth://evil.example/#access_token=private','s'),null);assert.equal(parseQQCallback("evil('0','0','https://evil.test','0','ok');"),null);assert.equal(parseCallback('auth://tauth.qq.com/#access_token='+'a'.repeat(32)+'&openid='+'b'.repeat(32)+'&state=wrong','expected'),null);
});
test('QQ confirmation follows the official check_sig redirect before exchanging the account',async()=>{
 const callback='auth://tauth.qq.com/#access_token='+'a'.repeat(32)+'&openid='+'b'.repeat(32)+'&state=expected';let received=0;const hosts=[];
 const p=new QQQrLogin({onAuthorization:async()=>{received++;},network:async value=>{const u=new URL(value);hosts.push(u.hostname);assert.equal(u.pathname,'/check_sig');return new Response(null,{status:302,headers:{location:callback}});}});
 p.controller=new AbortController();p.state='expected';p.status='scanned';
 try{await p._finish('https://ssl.ptlogin2.qq.com/check_sig?service=ptqrlogin',p.generation);assert.equal(received,1);assert.equal(p.poll().status,'authenticated');assert.deepEqual(hosts,['ssl.ptlogin2.qq.com']);}finally{await p.stop();}
});
test('QQ confirmation rejects redirects outside the official host list',async()=>{
 let received=0,requests=0;const p=new QQQrLogin({onAuthorization:async()=>{received++;},network:async()=>{requests++;return new Response(null,{status:302,headers:{location:'https://ssl.ptlogin2.qq.com.evil.test/check_sig'}});}});p.controller=new AbortController();p.state='expected';p.status='scanned';
 try{await assert.rejects(p._finish('https://ssl.ptlogin2.qq.com/check_sig',p.generation));assert.equal(requests,1);assert.equal(received,0);}finally{await p.stop();}
});
test('QQ reports a Camp exchange failure without echoing transport secrets',async()=>{
 const p=new QQQrLogin({onAuthorization:async()=>{throw new Error('token=private-transport-value');},network:async()=>new Response("ptuiCB('0','0','auth://tauth.qq.com/#access_token="+'a'.repeat(32)+'&openid='+'b'.repeat(32)+"','0','ok','');")});p.controller=new AbortController();p.params=new URLSearchParams({appid:'716027609',s_url:'https://connect.qq.com',daid:'381'});p.jar=[{name:'qrsig',value:'private',domain:'ptlogin2.qq.com',path:'/'}];p.state='expected';p.status='waiting';
 try{await p._poll(p.generation);assert.equal(p.poll().status,'error');assert.match(p.poll().message,/QQ 已确认，但营地登录验证失败/);assert.ok(!JSON.stringify(p.poll()).includes('private-transport-value'));assert.equal(p.jar.length,0);}finally{await p.stop();}
});
// Response structure observed from the real QQ mobile flow. All values below
// are fictional; the real callback and credentials are never saved as fixtures.
const mobileProxy=()=> 'https://imgcache.qq.com/open/connect/widget/mobile/login/proxy.htm#&t=123#&openid='+'b'.repeat(32)+'&appid=1105200115&access_token='+'a'.repeat(32)+'&browser=0&redirect_uri_key='+encodeURIComponent('opaque+redirect/key==');
const mobileCallback=(state='expected')=>'auth://tauth.qq.com/#access_token='+'a'.repeat(32)+'&openid='+'b'.repeat(32)+(state===null?'':'&state='+state);
test('QQ mobile proxy resolves its opaque redirect key and validates the final state',async()=>{
 let authorized=0;const requests=[];let transient;
 const p=new QQQrLogin({onAuthorization:async qq=>{authorized++;transient=qq;assert.equal(qq.accessToken,'a'.repeat(32));},network:async(value,init)=>{const u=new URL(value);requests.push(u);assert.equal(u.origin,'https://openmobile.qq.com');assert.equal(u.pathname,'/oauth2.0/m_get_redirect_url');assert.equal(u.searchParams.get('keystr'),'opaque+redirect/key==');assert.deepEqual([...u.searchParams.keys()],['keystr']);assert.equal(u.hash,'');assert.equal(init.redirect,'manual');return new Response('_Callback('+JSON.stringify({ret:0,url:mobileCallback()})+');');}});
 p.controller=new AbortController();p.state='expected';p.status='scanned';
 try{await p._finish(mobileProxy(),p.generation);assert.equal(authorized,1);assert.equal(requests.length,1);assert.equal(p.poll().status,'authenticated');assert.equal(transient.accessToken,'');assert.ok(!JSON.stringify(p.poll()).includes('opaque'));}finally{await p.stop();}
});
test('QQ mobile proxy rejects a wrong app, unrelated host, missing state, and expired redirect',async()=>{
 for(const scenario of ['wrong-app','duplicate-app','wrong-host','wrong-state','missing-state','expired','wrong-callback']){
  let calls=0,authorized=0;const p=new QQQrLogin({onAuthorization:async()=>{authorized++;},network:async()=>{calls++;const url=scenario==='wrong-callback'?'https://evil.example/#access_token=private':mobileCallback(scenario==='missing-state'?null:scenario==='wrong-state'?'wrong':'expected');return new Response('_Callback('+JSON.stringify({ret:scenario==='expired'?1003:0,url})+');');}});p.controller=new AbortController();p.state='expected';p.status='scanned';
  let entry=mobileProxy();if(scenario==='wrong-app')entry=entry.replace('appid=1105200115','appid=other');if(scenario==='duplicate-app')entry+='&appid=1105200115';if(scenario==='wrong-host')entry=entry.replace('imgcache.qq.com','imgcache.qq.com.evil.example');
  try{await assert.rejects(p._finish(entry,p.generation),scenario);assert.equal(authorized,0,scenario);assert.equal(calls,['wrong-app','duplicate-app','wrong-host'].includes(scenario)?0:1,scenario);}finally{await p.stop();}
 }
});
test('QQ redirect JSONP parser accepts only data in the expected callback',()=>{
 const good=JSON.stringify({ret:0,url:mobileCallback()});assert.equal(parseQQRedirect('_Callback('+good+');'),mobileCallback());
 for(const value of ['evil('+good+');','_Callback('+good+');globalThis.injected=true;','_Callback({ret:0,url:"auth://tauth.qq.com/"});','_Callback('+JSON.stringify({ret:null,url:mobileCallback()})+');','_Callback('+JSON.stringify({ret:1003,url:mobileCallback()})+');'])assert.equal(parseQQRedirect(value),null);
});

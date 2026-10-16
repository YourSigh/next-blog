import test from 'node:test';import assert from 'node:assert/strict';import{createHash}from'node:crypto';
import{WechatQrLogin,wechatQrUrl}from'../../src/lib/arena/camp/wechat-qr.mjs';
import{QQQrLogin,parseCallback,parseQQCallback,qrToken}from'../../src/lib/arena/camp/qq-qr.mjs';
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

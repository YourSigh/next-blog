// Camp APK WXQRLoginViewModel + PassportManager legacy WX code exchange.
// Contract/evidence and limits: docs/arena-wechat.md. No network work on import.
import crypto from 'node:crypto';
import { CAMP_PUBLIC_KEY_PEM, CampTransportError } from './camp-transport.mjs';

export const WECHAT_APP_ID='wxf4b1e8a3e9aaf978';
const LOGIN_URL='https://ssl.kohsocialapp.qq.com:10001/user/login';
const scalar=v=>typeof v==='string'||typeof v==='number'?String(v):'';
const fail=(code,message)=>{throw new CampTransportError(code,message);};
const CLIENT={cChannelId:'10003391',cClientVersionCode:'2057969907',cClientVersionName:'10.114.0722',cCurrentGameId:'20001',cGameId:'20001',cGzip:'1',cIsArm64:'true',cSupportArm64:'true',cSystem:'android',gameId:'20001'};

export async function exchangeWeChatLogin({network,wechat,signal}={}) {
  if(typeof network!=='function') fail('transport_required','微信登录传输尚未配置。');
  const code=scalar(wechat?.code);
  if(!/^[A-Za-z0-9_-]{8,1024}$/.test(code)) fail('auth','微信回调缺少有效的授权 code。');
  const installation=crypto.randomUUID().replace(/-/g,'');
  const timestamp=Date.now();
  const raw=Buffer.from(JSON.stringify({timestamp,nonce:`:${crypto.randomUUID().replace(/-/g,'')}:${timestamp}`,cDeviceId:installation,deviceid:installation}));
  const chunks=[];
  for(let p=0;p<raw.length;p+=117) chunks.push(crypto.publicEncrypt({key:CAMP_PUBLIC_KEY_PEM,padding:crypto.constants.RSA_PKCS1_PADDING},raw.subarray(p,p+117)));
  const specialEncodeParam=Buffer.concat(chunks).toString('base64');
  const fields={...CLIENT,cRand:String(timestamp)};
  const form=new URLSearchParams({loginType:'wx',code,delOldUser:'0',key1:installation,lastLoginTime:'0',lastGetRemarkTime:'0',...fields,specialEncodeParam});
  const xLogUid=/^[A-Fa-f0-9-]{32,40}$/.test(wechat?.xLogUid||'')?wechat.xLogUid:crypto.randomUUID().toUpperCase();
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),15000); timer.unref?.();
  try {
    const response=await network(LOGIN_URL,{method:'POST',redirect:'manual',cache:'no-store',signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal,headers:{'Content-Encrypt':'','Accept-Encrypt':'',NOENCRYPT:'1','X-Client-Proto':'https','User-Agent':'okhttp/4.9.1','Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','x-log-uid':xLogUid,...fields,specialEncodeParam},body:form.toString()});
    if(!response?.ok || response.status>=300 && response.status<400 || response.url && response.url!==LOGIN_URL) fail('auth','微信营地登录交换未通过。');
    const headerCode=response.headers?.get('returncode');
    if(response.headers?.get('encryptparamerr') || headerCode && !['0','200'].includes(headerCode)) fail('auth','微信营地登录校验未通过。');
    const body=await response.text();
    if(Buffer.byteLength(body)>1048576) fail('upstream','微信登录响应超出读取上限。');
    let result;try{result=JSON.parse(body);}catch{fail('upstream','微信登录响应无法解析。');}
    if(Number(result?.returnCode)===-30107) fail('rate_limit','微信登录请求频繁，请稍后手动重试。');
    const data=result?.data;
    if(Number(result?.returnCode)!==0 || !/^\d{5,15}$/.test(scalar(data?.userId)) || !scalar(data?.token) || !scalar(data?.encodeRes)) fail('auth','营地未返回完整微信会话，请重新授权。');
    return {userId:scalar(data.userId),token:scalar(data.token),encodeRes:scalar(data.encodeRes),openId:scalar(data.openId||data.appOpenid),expires:scalar(data.expires),xLogUid,loginPlatform:'wechat',contractStatus:'experimental-unverified-live'};
  } catch(error) {
    if(error instanceof CampTransportError) throw error;
    fail('transport',controller.signal.aborted?'微信登录请求超时。':'微信登录网络请求未成功。');
  } finally {clearTimeout(timer);form.delete('code');raw.fill(0);}
}

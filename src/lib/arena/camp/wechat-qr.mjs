import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {WECHAT_APP_ID} from './wechat-login.mjs';

const TICKET='https://ssl.kohsocialapp.qq.com:10001/a/getwxsdkticket';
const QR='https://open.weixin.qq.com/connect/sdk/qrconnect';
const POLL='https://long.open.weixin.qq.com/connect/l/qrconnect';
const error=(message,code='qr_unavailable')=>Object.assign(new Error(message),{publicMessage:message,code});
export function wechatQrUrl(ticket,{nonce=randomBytes(12).toString('hex'),timestamp=String(Math.floor(Date.now()/1000))}={}) {
  const signature=createHash('sha1').update(`appid=${WECHAT_APP_ID}&noncestr=${nonce}&sdk_ticket=${ticket}&timestamp=${timestamp}`).digest('hex');
  const url=new URL(QR);url.search=new URLSearchParams({appid:WECHAT_APP_ID,noncestr:nonce,timestamp,scope:'snsapi_userinfo',signature}).toString();return url.href;
}
function image(value) {
  if(typeof value!=='string'||value.length>1500000||!/^[A-Za-z0-9+/=\r\n]+$/.test(value)) throw error('微信未返回可显示的二维码。');
  const bytes=Buffer.from(value,'base64');let mime;
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime='image/png';
  else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255) mime='image/jpeg';
  else throw error('微信二维码图片格式暂不支持。');
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

export class WechatQrLogin {
  constructor({proxy,onAuthorization,executablePath,network,ttlMs=180000,pollDelayMs=1000}={}) {
    this.proxy=proxy;this.onAuthorization=onAuthorization;this.network=network;this.ttlMs=ttlMs;this.pollDelayMs=pollDelayMs;
    this.status='idle';this.message='尚未发起微信授权';this.generation=0;
    // executablePath is accepted for provider parity; the SDK flow needs no browser.
  }
  _release(){clearTimeout(this.expiryTimer);clearTimeout(this.pollTimer);this.controller?.abort();this.controller=null;this.uuid=null;this.qrImage=null;this.xLogUid=null;this.last=null;}
  async stop(){++this.generation;if(['starting','waiting','scanned'].includes(this.status)){this.status='cancelled';this.message='微信授权已取消';}this._release();}
  async _json(url,options={},timeoutMs=20000) {
    const u=new URL(url);
    if(![TICKET,QR,POLL].some(allowed=>u.origin+u.pathname===allowed)||u.username||u.password||u.hash) throw error('微信授权地址校验失败。');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);timer.unref?.();
    try {
      let network=this.network;
      if(!network&&this.proxy){const {fetch,ProxyAgent}=await import('undici');this.dispatcher ||= new ProxyAgent(this.proxy);network=(url,init)=>fetch(url,{...init,dispatcher:this.dispatcher});}
      network ||= globalThis.fetch;
      const signal=this.controller?.signal;const response=await network(url,{...options,redirect:'manual',cache:'no-store',signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal});
      if(!response?.ok||response.status>=300&&response.status<400||response.url&&response.url!==url)throw error('微信官方授权服务暂不可用。');
      const body=await response.text();if(Buffer.byteLength(body)>2097152)throw error('微信授权响应超出读取上限。');
      return JSON.parse(body);
    } catch {throw error('微信官方授权服务暂不可用，请检查网络后重试。');}finally{clearTimeout(timer);}
  }
  async start(){
    const generation=++this.generation;this._release();this.controller=new AbortController();const signal=this.controller.signal;
    this.status='starting';this.message='正在获取微信官方二维码';this.id=randomBytes(12).toString('hex');this.xLogUid=randomUUID().toUpperCase();
    const current=()=>generation===this.generation&&!signal.aborted;
    try{
      if(typeof this.onAuthorization!=='function')throw error('微信授权服务尚未配置。');
      const ticketResult=await this._json(TICKET,{method:'POST',headers:{'Content-Encrypt':'','Accept-Encrypt':'',NOENCRYPT:'1','X-Client-Proto':'https','User-Agent':'okhttp/4.9.1','x-log-uid':this.xLogUid}});
      if(!current())throw error('微信授权请求已取消。','cancelled');
      const ticket=ticketResult?.data?.sdkTicket;
      if(Number(ticketResult?.returnCode)!==0||typeof ticket!=='string'||!ticket||ticket.length>4096)throw error('营地未提供微信扫码票据，微信入口暂不可用。');
      const qr=await this._json(wechatQrUrl(ticket));
      if(!current())throw error('微信授权请求已取消。','cancelled');
      if(Number(qr?.errcode)!==0||!/^[A-Za-z0-9_-]{8,256}$/.test(qr?.uuid||'')||qr.appname&&!/王者(营地|荣耀助手)/.test(qr.appname))throw error('微信未返回王者营地的有效二维码。');
      this.uuid=qr.uuid;this.qrImage=image(qr?.qrcode?.qrcodebase64);this.expiresAt=Date.now()+this.ttlMs;
      this.status='waiting';this.message='请用手机微信扫码，在微信官方页面核对王者营地并确认授权。';
      this.expiryTimer=setTimeout(()=>{if(current()&&['waiting','scanned'].includes(this.status)){this.status='expired';this.message='微信二维码已过期，请重新获取';++this.generation;this._release();}},this.ttlMs);this.expiryTimer.unref?.();
      this._schedule(generation,0);
      return{id:this.id,qrImage:this.qrImage,expiresAt:this.expiresAt,message:this.message};
    }catch{
      if(generation===this.generation){this.status='error';this.message='微信扫码暂不可用；请稍后重试，或使用 QQ 授权。';this._release();}
      throw error(generation===this.generation?this.message:'微信授权请求已取消。',generation===this.generation?'qr_unavailable':'cancelled');
    }
  }
  _schedule(generation,delay=this.pollDelayMs){this.pollTimer=setTimeout(()=>{void this._poll(generation);},delay);this.pollTimer.unref?.();}
  async _poll(generation){
    if(generation!==this.generation||!['waiting','scanned'].includes(this.status))return;
    const signal=this.controller.signal;const uuid=this.uuid;
    const url=new URL(POLL);url.search=new URLSearchParams({f:'json',uuid,...(this.last?{last:String(this.last)}:{})}).toString();
    try{
      const result=await this._json(url.href,{},60000);
      if(generation!==this.generation||signal.aborted)return;
      const status=Number(result?.wx_errcode);this.last=status;
      if(status===405){
        const code=result?.wx_code;if(typeof code!=='string'||!/^[A-Za-z0-9_-]{8,1024}$/.test(code))throw error('微信确认结果缺少有效 code。');
        clearTimeout(this.expiryTimer);this.qrImage=null;this.uuid=null;this.status='scanned';this.message='微信已确认授权，正在验证营地登录';
        const authorization={code,xLogUid:this.xLogUid};
        try{await this.onAuthorization(authorization,{signal});if(generation===this.generation&&!signal.aborted){this.status='authenticated';this.message='微信营地会话已验证';}}
        finally{authorization.code='';authorization.xLogUid='';}
        if(generation===this.generation)this._release();return;
      }
      if(status===402||status===403){this.status=status===402?'expired':'cancelled';this.message=status===402?'微信二维码已过期，请重新获取':'微信授权已取消';this._release();return;}
      if(status===404){this.status='scanned';this.message='微信已扫码，请在手机上核对并确认授权。';}
      else if(status!==408)throw error('微信授权状态异常。');
      this._schedule(generation);
    }catch{if(generation===this.generation&&!signal.aborted){this.status='error';this.message='微信授权未完成，请重新获取二维码。';this._release();}}
  }
  poll(){return{status:this.status==='idle'?'expired':this.status,message:this.message};}
}

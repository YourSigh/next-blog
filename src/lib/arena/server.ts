import { randomBytes, createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { fetch as remoteFetch, ProxyAgent } from 'undici';
import { QQQrLogin } from './camp/qq-qr.mjs';
import { exchangeQQLogin } from './camp/camp-login.mjs';
import { createCampTransport } from './camp/camp-transport.mjs';
import { fetchDashboard } from './camp/camp-data.mjs';
import { fetchExtended } from './camp/camp-extended.mjs';
import catalog from './hero-catalog.json';
import { createPlayerStore, playerFromCamp } from './store.ts';
import { ratePlayer } from './rating.ts';
import type { Provider } from './types.ts';

type Login = {start:()=>Promise<{id:string;qrImage:string;expiresAt:number;message:string}>;poll:()=>{status:string;message:string};stop:()=>Promise<void>};
type CampAuth = {userId:string;token:string;encodeRes:string;[key:string]:unknown};
type Session = { key:string; lastUsed:number; login?:Login; flowId?:string; starting?:Promise<unknown>; lastStart:number; provider?:Provider; auth?:CampAuth; playerId?:string; sync?:Promise<void>; syncStatus:{status:string;message:string}; lastSync:number; epoch:number };
type Runtime = {sessions:Map<string,Session>;rates:Map<string,{count:number;time:number}>;store:ReturnType<typeof createPlayerStore>;dispatcher?:ProxyAgent;proxy:string;cleanupAt:number;balanceTimes:Map<string,number>};
const COOKIE='arena_browser';
const runtimeGlobal=globalThis as typeof globalThis & { __arenaRuntime?:Runtime };
export function arenaRuntime():Runtime {
  if(!runtimeGlobal.__arenaRuntime){const proxy=process.env.ARENA_PROXY||process.env.HTTPS_PROXY||'';runtimeGlobal.__arenaRuntime={sessions:new Map(),rates:new Map(),store:createPlayerStore(),dispatcher:proxy?new ProxyAgent(proxy):undefined,proxy,cleanupAt:0,balanceTimes:new Map()};}
  return runtimeGlobal.__arenaRuntime;
}
export class ArenaError extends Error {constructor(public status:number,message:string){super(message);}}
export function reply(data:unknown,status=200){return NextResponse.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}
export function routeError(error:unknown){return reply({message:error instanceof ArenaError?error.message:'请求未完成，请稍后重试。'},error instanceof ArenaError?error.status:500);}
export function assertSameOrigin(request:NextRequest){
  const origin=request.headers.get('origin');
  try{const parsed=new URL(origin||'');const configured=process.env.ARENA_PUBLIC_ORIGIN;if(configured?parsed.origin!==new URL(configured).origin:parsed.host!==request.headers.get('host')||!['https:','http:'].includes(parsed.protocol))throw Error();}catch{throw new ArenaError(403,'请从本站页面发起操作。');}
  if(request.headers.get('sec-fetch-site')==='cross-site')throw new ArenaError(403,'请求来源不匹配。');
}
export async function bodyOf(request:NextRequest){
  const length=Number(request.headers.get('content-length')||0);if(length>16384)throw new ArenaError(413,'请求体过大。');
  const raw=await request.text();if(Buffer.byteLength(raw)>16384)throw new ArenaError(413,'请求体过大。');
  try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value as Record<string,unknown>;}catch{throw new ArenaError(400,'请求内容无效。');}
}
function sessionKey(raw:string){return createHash('sha256').update(raw).digest('hex');}
export function getSession(request:NextRequest){const token=request.cookies.get(COOKIE)?.value;if(!token||!/^[a-f0-9]{64}$/.test(token))return null;const session=arenaRuntime().sessions.get(sessionKey(token));if(session&&Date.now()-session.lastUsed<2*60*60_000){session.lastUsed=Date.now();return session;}return null;}
export async function cleanupSessions(){const runtime=arenaRuntime();if(Date.now()-runtime.cleanupAt<30_000)return;runtime.cleanupAt=Date.now();for(const [key,s]of runtime.sessions)if(Date.now()-s.lastUsed>2*60*60_000){runtime.sessions.delete(key);s.epoch++;s.auth=undefined;void s.login?.stop();}for(const [key,r]of runtime.rates)if(Date.now()-r.time>15*60_000)runtime.rates.delete(key);}
export function ensureSession(request:NextRequest){const found=getSession(request);if(found)return {session:found,token:null};const runtime=arenaRuntime();if(runtime.sessions.size>=200)throw new ArenaError(429,'当前会话较多，请稍后再试。');const token=randomBytes(32).toString('hex'),key=sessionKey(token);const session:Session={key,lastUsed:Date.now(),lastStart:0,lastSync:0,epoch:0,syncStatus:{status:'idle',message:'尚未同步'}};runtime.sessions.set(key,session);return {session,token};}
export function attachSession(response:NextResponse,token:string|null,request:NextRequest){if(token)response.cookies.set(COOKIE,token,{httpOnly:true,sameSite:'lax',secure:request.headers.get('origin')?.startsWith('https://')===true||request.headers.get('x-forwarded-proto')==='https',maxAge:7200,path:'/api/arena'});return response;}
export function requireSession(request:NextRequest){const s=getSession(request);if(!s?.auth)throw new ArenaError(401,'请先扫码登录自己的营地账号。');return s;}
export function limitLogin(request:NextRequest){const runtime=arenaRuntime();const address=(request.headers.get('x-real-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]||'local').slice(0,100);const key=createHash('sha256').update(address).digest('hex'),now=Date.now();const previous=runtime.rates.get(key);const next=previous&&now-previous.time<15*60_000?{count:previous.count+1,time:previous.time}:{count:1,time:now};runtime.rates.set(key,next);if(next.count>15)throw new ArenaError(429,'生成二维码过于频繁，请稍后再试。');if([...runtime.sessions.values()].filter(s=>s.starting||['waiting','starting','scanned'].includes(s.login?.poll().status||'')).length>=8)throw new ArenaError(429,'当前扫码任务较多，请稍后再试。');}
export const network=(url:string,options:Record<string,unknown>={})=>{const signal=options.signal as AbortSignal|undefined;return remoteFetch(url,{...options,dispatcher:arenaRuntime().dispatcher,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(65_000)]):AbortSignal.timeout(65_000)} as Parameters<typeof remoteFetch>[1]);};

// WeChat's provider is imported after its explicitly implemented capability check.
export async function providerCapabilities(){
  try{const wx=await import('./camp/wechat-qr.mjs');return {qq:{enabled:true},wechat:{enabled:typeof wx.WechatQrLogin==='function'}};}catch{return {qq:{enabled:true},wechat:{enabled:false,message:'微信官方扫码流程正在核验，当前请使用 QQ。'}};}
}
export function startSync(session:Session){
  if(session.sync)return {status:'running',message:'正在同步该账号。'};
  if(!session.auth)throw new ArenaError(401,'请先扫码登录。');
  if(Date.now()-session.lastSync<60_000&&session.syncStatus.status==='ready')return session.syncStatus;
  const epoch=session.epoch,auth=session.auth,provider=session.provider||'qq';session.lastSync=Date.now();session.syncStatus={status:'running',message:'读取本人战绩、英雄和赛季记录…'};
  session.sync=(async()=>{
    const dashboard=await fetchDashboard({auth,request:createCampTransport({network,auth,extended:false,observe:undefined})});
    const extended=await fetchExtended({auth,request:createCampTransport({network,auth,extended:true,observe:undefined}),catalog,signal:undefined,onProgress:(value:{progress?:{message?:string}})=>{if(epoch===session.epoch)session.syncStatus={status:'running',message:value.progress?.message||'正在读取记录…'};}});
    if(epoch!==session.epoch)return;
    if(extended.errorCode==='auth'||extended.errorCode==='hidden')throw new ArenaError(401,'营地授权失效或战绩访问受限，请重新扫码。');
    const player=playerFromCamp({userId:auth.userId,roleId:String(dashboard.profile.roleId||''),provider,dashboard,extended});
    if(extended.status!=='ready'){
      const previous=await arenaRuntime().store.read(player.id);
      if(previous&&!player.heroes.length){player.heroes=previous.heroes;player.coverage.catalogMatched=previous.coverage.catalogMatched;player.coverage.limitations.push('本次英雄同步未完成，英雄档案保留上次成功保存的记录。');}
      if(previous&&!player.seasons.length){player.seasons=previous.seasons;player.coverage.limitations.push('本次赛季同步未完成，赛季档案保留上次成功保存的记录。');}
    }
    if(epoch!==session.epoch)return;
    const stored=await arenaRuntime().store.save(player);if(epoch!==session.epoch)return;
    session.playerId=stored.id;session.syncStatus={status:'ready',message:`已保存 ${stored.heroes.length} 个英雄、${stored.seasons.length} 个赛季和 ${stored.matches.length} 场最近对局。`};
  })().catch(error=>{if(epoch===session.epoch)session.syncStatus={status:'error',message:error instanceof ArenaError?error.message:'同步未完成，已保存的档案仍然可用。请稍后手动重试。'};}).finally(()=>{session.sync=undefined;});
  return session.syncStatus;
}
export async function startLogin(session:Session,provider:Provider){
  if(session.sync)throw new ArenaError(409,'当前账号仍在同步，请完成后再切换。');
  if(session.starting)throw new ArenaError(409,'正在生成二维码，请稍候。');
  if(Date.now()-session.lastStart<12_000)throw new ArenaError(429,'请稍候再获取二维码。');
  session.lastStart=Date.now();await session.login?.stop();session.epoch++;const epoch=session.epoch;session.provider=provider;session.auth=undefined;session.playerId=undefined;
  const onAuthorization=async(value:unknown)=>{
    let auth:CampAuth;
    if(provider==='qq')auth=await exchangeQQLogin({network,qq:value});
    else{const wx=await import('./camp/wechat-login.mjs');const result=await wx.exchangeWeChatLogin({network,wechat:value});if(!result)throw new ArenaError(502,'微信登录未返回会话。');auth=result;}
    if(epoch!==session.epoch)return;
    session.auth=auth;session.playerId=undefined;session.lastSync=0;startSync(session);
  };
  const executablePath=process.env.ARENA_CHROMIUM_PATH||undefined;
  if(provider==='qq')session.login=new QQQrLogin({proxy:arenaRuntime().proxy,onAuthorization,executablePath,network});
  else{const wx=await import('./camp/wechat-qr.mjs');session.login=new wx.WechatQrLogin({proxy:arenaRuntime().proxy,onAuthorization,executablePath,network});}
  session.starting=session.login.start();
  try{const result=await session.starting as Awaited<ReturnType<Login['start']>>;session.flowId=result.id;return result;}catch{throw new ArenaError(502,provider==='qq'?'QQ 官方二维码暂未生成，请稍后重试。':'微信官方二维码暂未生成，请稍后重试。');}finally{session.starting=undefined;}
}
export async function arenaState(request:NextRequest){await cleanupSessions();const session=getSession(request),players=await arenaRuntime().store.list();return {authenticated:!!session?.auth,configured:true,currentPlayerId:session?.playerId||null,players,ratings:players.map(ratePlayer),providers:await providerCapabilities(),message:'已授权保存的游戏资料公开供访客查看与分队；登录凭据仅留在临时服务会话。'};}

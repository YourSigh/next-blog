import { NextRequest } from 'next/server';
import { arenaRuntime, arenaState, ArenaError, assertSameOrigin, attachIdentity, attachSession, bodyOf, cleanupSessions, ensureSession, getSession, limitLogin, reply, requireSession, routeError, startLogin, startSync } from '@/lib/arena/server';
import { createDemoPlayers } from '@/lib/arena/demo';
import { ratePlayer } from '@/lib/arena/rating';
import { balancePlayers, MatchmakingError } from '@/lib/arena/matchmaking';
import type { BalanceOptions } from '@/lib/arena/types';
import { checkEventConnection, confirmEventCandidate, eventView, registerForToday, requestedDate, startEventVerification } from '@/lib/arena/event-server';
import { EventError } from '@/lib/arena/events';
import { IDENTITY_COOKIE } from '@/lib/arena/identity';
import type { EventMode } from '@/lib/arena/events-types';
const reportError=(error:unknown)=>routeError(error instanceof EventError?new ArenaError(error.status,error.message):error);
export const runtime='nodejs';
export const dynamic='force-dynamic';
const pathOf=(request:NextRequest)=>request.nextUrl.pathname.replace(/^\/api\/arena\/?/,'');
export async function GET(request:NextRequest){try{
  const path=pathOf(request);
  if(!path)return attachIdentity(reply(await arenaState(request)),request);
  if(path==='events'||path==='events/export'){
    const view=await eventView(request,requestedDate(request.nextUrl.searchParams.get('date')));
    const response=reply(path==='events/export'?{event:view.event,standings:view.standings}:view);
    if(path==='events/export')response.headers.set('Content-Disposition',`attachment; filename="arena-${view.event.date}.json"`);
    return attachIdentity(response,request);
  }
  if(path==='demo'){const players=createDemoPlayers();return reply({players,ratings:players.map(ratePlayer),sample:true});}
  if(path==='auth'){const session=getSession(request);if(!session?.login)return reply({status:'expired',message:'请重新获取二维码。'});const id=request.nextUrl.searchParams.get('id');if(id&&id!==session.flowId)throw new ArenaError(404,'扫码会话已更新。');return reply(session.login.poll());}
  if(path==='sync'){const session=getSession(request);return reply(session?.syncStatus||{status:'idle',message:'请先登录。'});}
  if(path==='history'){const id=request.nextUrl.searchParams.get('playerId')||'';if(!/^[a-f0-9]{24}$/.test(id))throw new ArenaError(400,'选手标识无效。');return reply({snapshots:await arenaRuntime().store.history(id)});}
  throw new ArenaError(404,'接口不存在。');
}catch(error){return reportError(error);}}
export async function POST(request:NextRequest){try{
  assertSameOrigin(request);await cleanupSessions();const path=pathOf(request),body=await bodyOf(request);
  if(path==='events/probe')return reply(await checkEventConnection(request));
  if(path==='events/register'){
    if(!['play','watch','leave'].includes(String(body.mode)))throw new ArenaError(400,'请选择参赛、观战或退出报名。');
    return attachIdentity(reply(await registerForToday(request,body.mode as EventMode|'leave')),request);
  }
  if(path==='events/finish'||path==='events/confirm'){
    if(typeof body.roundId!=='string'||!/^[a-f0-9-]{36}$/.test(body.roundId))throw new ArenaError(400,'比赛场次无效。');
    const date=requestedDate(body.date);
    if(path==='events/confirm'){
      if(typeof body.sourceKey!=='string'||!/^[a-f0-9]{64}$/.test(body.sourceKey))throw new ArenaError(400,'请选择已经核验的候选对局。');
      return reply(await confirmEventCandidate(request,date,body.roundId,body.sourceKey));
    }
    return reply(await startEventVerification(request,date,body.roundId));
  }
  if(path==='auth'){
    if(body.consent!==true)throw new ArenaError(400,'请先同意公开授权数据用于查看与分队。');
    if(body.provider!=='qq'&&body.provider!=='wechat')throw new ArenaError(400,'登录方式无效。');
    const {session,token}=ensureSession(request);limitLogin(request);const result=await startLogin(session,body.provider);return attachSession(reply(result),token,request);
  }
  if(path==='sync')return reply(startSync(requireSession(request)));
  if(path==='preferences'){const session=requireSession(request);if(!session.playerId||body.playerId!==session.playerId)throw new ArenaError(403,'只有本人重新登录后才能保存该档案偏好。');return reply(await arenaRuntime().store.preferences(session.playerId,body.preferences));}
  if(path==='logout'){const s=getSession(request);if(s){s.epoch++;s.auth=undefined;s.playerId=undefined;await s.login?.stop();s.login=undefined;s.syncStatus={status:'idle',message:'临时登录已释放'};}const response=reply({ok:true});response.cookies.set(IDENTITY_COOKIE,'',{maxAge:0,path:'/api/arena',httpOnly:true,sameSite:'lax'});return response;}
  if(path==='balance'){
    const now=Date.now(),address=(request.headers.get('x-real-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]||'local').slice(0,100),times=arenaRuntime().balanceTimes;
    if(now-(times.get(address)||0)<750)throw new ArenaError(429,'请稍候再重新分队。');times.set(address,now);if(times.size>2000)times.clear();
    const options={selectedIds:body.selectedIds,locks:body.locks||[],seed:body.seed,variety:body.variety} as BalanceOptions;
    try{return reply(balancePlayers(body.demo===true?createDemoPlayers():await arenaRuntime().store.list(),options));}catch(error){if(error instanceof MatchmakingError)throw new ArenaError(400,error.message);throw error;}
  }
  throw new ArenaError(404,'接口不存在。');
}catch(error){return reportError(error);}}
export async function DELETE(request:NextRequest){try{
  assertSameOrigin(request);if(pathOf(request)!=='players')throw new ArenaError(404,'接口不存在。');const session=requireSession(request),id=request.nextUrl.searchParams.get('playerId');if(!id||id!==session.playerId)throw new ArenaError(403,'仅本人登录后可移除自己的公开档案。');
  session.epoch++;if(session.sync)await session.sync;await arenaRuntime().store.remove(id);session.playerId=undefined;return reply({ok:true});
}catch(error){return routeError(error);}}

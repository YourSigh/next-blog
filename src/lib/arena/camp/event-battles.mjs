// The pinned camp-api.ts / camp-client.ts contract is documented in arena-events.md.
// Own latest-page candidates only. No auth, raw responses, or raw role IDs are persisted.
import {createHash} from 'node:crypto';
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const unwrap=v=>obj(v).data&&typeof v.data==='object'?obj(v.data):obj(v);
const rows=v=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)):[];
const text=v=>['string','number'].includes(typeof v)?String(v).replace(/[\u0000-\u001f]/g,'').slice(0,300):'';
const count=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=1e12?Number(v):null;
const digest=v=>createHash('sha256').update(v).digest('hex');
export const roleKey=roleId=>digest(`arena-koh-role-v1:${roleId}`);
function time(v){const n=count(v);if(!n)return null;const ms=n<1e11?n*1000:n;return Number.isFinite(new Date(ms).valueOf())?new Date(ms).toISOString():null;}
const outcome=v=>[1,'1','win','胜利'].includes(v)?'win':[2,'2','loss','lose','失败'].includes(v)?'loss':null;
export function matchDetailToRound({detail,row,targetRoleId,round,reporterId,now=new Date()}){
  const data=unwrap(detail),blue=rows(data.blueRoles),red=rows(data.redRoles);
  if(blue.length!==5||red.length!==5)return {status:'incomplete',message:'营地没有返回完整的十人面板，暂不记胜负。'};
  const all=[...blue,...red],keys=all.map(r=>text(obj(r.basicInfo).roleId)).map(id=>id?roleKey(id):'');
  const expected=new Map(round.players.map(p=>[p.roleKey,p.id]));
  if(expected.size!==10||[...expected.keys()].some(k=>!k))return {status:'incomplete',message:'参赛档案缺少角色标识，请相关选手重新扫码同步后再核验。'};
  if(keys.some(k=>!k)||new Set(keys).size!==10||keys.some(k=>!expected.has(k)))return {status:'mismatch',message:'这场对局的十人名单与本场分队不一致。'};
  const blueIds=keys.slice(0,5).map(k=>expected.get(k));
  const equals=(a,b)=>a.length===b.length&&a.every(id=>b.includes(id));
  const A=round.allocation.teams.A.map(s=>s.playerId),B=round.allocation.teams.B.map(s=>s.playerId);
  const blueSide=equals(blueIds,A)?'A':equals(blueIds,B)?'B':null;
  if(!blueSide)return {status:'mismatch',message:'十人已匹配，但双方阵营与本场分队不一致。'};
  const ownIndex=all.findIndex(r=>text(obj(r.basicInfo).roleId)===String(targetRoleId));
  if(ownIndex<0||expected.get(keys[ownIndex])!==reporterId)return {status:'mismatch',message:'本人角色没有对应到本场参赛身份。'};
  const own=all[ownIndex],records=obj(own.battleRecords),basic=obj(own.basicInfo);
  const ownHero=text(records.heroId??obj(records.usedHero).heroId??basic.heroId??obj(basic.usedHero).heroId);
  if(row.heroId&&ownHero&&String(row.heroId)!==ownHero)return {status:'mismatch',message:'本人英雄与战绩页不一致，暂不记录。'};
  const won=outcome(row.gameresult??row.gameResult??row.result),playedAt=time(row.dtEventTime??row.dteventtime??row.battle_time);
  if(!won||!playedAt||Date.parse(playedAt)<Date.parse(round.createdAt)-1000||Date.parse(playedAt)>now.valueOf()+60_000||round.baselineMatchIds.includes(text(row.gameSeq)))return {status:'incomplete',message:'对局时间、胜负或新对局依据不足。'};
  const side=i=>i<5?blueSide:blueSide==='A'?'B':'A',ownSide=side(ownIndex);
  const winner=won==='win'?ownSide:ownSide==='A'?'B':'A';
  const players=all.map((r,i)=>{
    const b=obj(r.basicInfo),s=obj(r.battleStats),rec=obj(r.battleRecords),used=obj(rec.usedHero||b.usedHero),playerId=expected.get(keys[i]),team=side(i);
    const seat=round.allocation.teams[team].find(s=>s.playerId===playerId),join=count(s.joinGamePercent);
    return {playerId,team,lane:seat.lane,heroId:text(rec.heroId??used.heroId??b.heroId)||null,heroName:text(used.heroName??rec.heroName)||'',kills:count(s.killCnt??s.killcnt??rec.killCnt??rec.killcnt),deaths:count(s.deadCnt??s.deadcnt??rec.deadCnt??rec.deadcnt),assists:count(s.assistCnt??s.assistcnt??rec.assistCnt??rec.assistcnt),score:count(s.gradeGame??s.score??rec.gradeGame),gold:count(s.money),damage:count(s.totalHeroHurtCnt??s.totalHurtCnt),damageTaken:count(s.totalBeheroHurtCnt??s.totalBehurtCnt),participation:join===null?null:Math.min(100,join<=1?join*100:join)};
  });
  const sourceKey=digest(JSON.stringify([text(row.gameSeq),text(row.gameSvrId||row.gameSvr),text(row.relaySvrId||row.relaySvr),Number(row.battleType)]));
  const teamKills=t=>{const ps=players.filter(p=>p.team===t);return ps.every(p=>p.kills!==null)?ps.reduce((n,p)=>n+p.kills,0):null;};
  const a=teamKills('A'),b=teamKills('B');
  return {status:'verified',result:{sourceKey,gameId:text(row.gameSeq),playedAt,durationSeconds:count(row.usedTime??row.durationSec),winner,verifiedAt:now.toISOString(),reporterId,players,analysis:[`十名角色标识与双方阵营完全匹配；${winner} 队获胜。`,...(a!==null&&b!==null?[`团队击杀：A ${a} / B ${b}。`]:[]),'仅记录接口实际返回的个人数据；分路沿用赛前安排，不用 KDA 跨位置评价选手。']}};
}
export async function fetchEventBattles({auth,request,provider,reporterId,round,now=new Date()}){
  const post=(path,body)=>request('https://kohcamp.qq.com'+path,{method:'POST',body:JSON.stringify(body),auth});
  const profile=unwrap(await post('/game/koh/profile',{targetUserId:String(auth.userId),targetRoleId:'0',resVersion:'3',recommendPrivacy:'0',apiVersion:'2'}));
  const roles=rows(profile.roleList),role=roles.find(r=>String(r.roleId)===String(auth.gameRoleId||profile.targetRoleId))||roles[0],targetRoleId=text(role?.roleId);
  if(!targetRoleId||digest(`arena-v1:${provider}:${auth.userId}:${targetRoleId}`).slice(0,24)!==reporterId)return {status:'needs_login',message:'当前营地角色与报名账号不一致，请重新扫码连接本场账号。',candidates:[]};
  const page=unwrap(await post('/game/morebattlelist',{lastTime:0,recommendPrivacy:0,apiVersion:5,friendUserId:String(auth.userId),option:0}));
  const candidates=rows(page.list??page.battle_list).filter(r=>{const t=time(r.dtEventTime??r.dteventtime??r.battle_time);return t&&Date.parse(t)>=Date.parse(round.createdAt)-1000&&Date.parse(t)<=now.valueOf()+60_000&&!round.baselineMatchIds.includes(text(r.gameSeq));}).sort((a,b)=>Number(b.dtEventTime??b.dteventtime??b.battle_time)-Number(a.dtEventTime??a.dteventtime??a.battle_time)).slice(0,3);
  const found=[];let message='最近战绩还没有与本场时间对应的新对局，请稍后重试。',status='no_match';
  for(const row of candidates){
    const gameSeq=text(row.gameSeq),gameSvr=text(row.gameSvrId||row.gameSvr),relaySvr=text(row.relaySvrId||row.relaySvr),battleType=Number(row.battleType);
    if(!gameSeq||!gameSvr||!relaySvr||!Number.isInteger(battleType)){status='incomplete';message='战绩页缺少读取单场详情的字段，请重新扫码同步后再试。';continue;}
    const detail=await post('/game/battledetail',{recommendPrivacy:0,battleType,gameSvr,relaySvr,targetRoleId,gameSeq});
    const matched=matchDetailToRound({detail,row,targetRoleId,round,reporterId,now});
    if(matched.result&&!found.some(r=>r.sourceKey===matched.result.sourceKey))found.push(matched.result);else if(!matched.result){status=matched.status;message=matched.message;}
  }
  if(found.length===1)return {status:'verified',message:'十人名单、双方阵营与胜负已核验，结果已记录。',candidates:found};
  if(found.length>1)return {status:'ambiguous',message:'找到多场符合十人名单的对局，请选择本场的实际记录。',candidates:found};
  return {status,message,candidates:[]};
}
/** Manual own-account preflight. Return schema/availability only, never another game's roster or auth. */
export async function probeEventAccess({auth,request,provider,reporterId}){
  const post=(path,body)=>request('https://kohcamp.qq.com'+path,{method:'POST',body:JSON.stringify(body),auth});
  const profile=unwrap(await post('/game/koh/profile',{targetUserId:String(auth.userId),targetRoleId:'0',resVersion:'3',recommendPrivacy:'0',apiVersion:'2'}));
  const roles=rows(profile.roleList),role=roles.find(r=>String(r.roleId)===String(auth.gameRoleId||profile.targetRoleId))||roles[0],targetRoleId=text(role?.roleId);
  if(!targetRoleId||digest(`arena-v1:${provider}:${auth.userId}:${targetRoleId}`).slice(0,24)!==reporterId)return {message:'当前营地角色与报名账号不一致，请重新扫码。',ready:false,schema:null};
  const page=unwrap(await post('/game/morebattlelist',{lastTime:0,recommendPrivacy:0,apiVersion:5,friendUserId:String(auth.userId),option:0}));
  const row=rows(page.list??page.battle_list)[0];if(!row)return {message:'营地授权有效，但暂未返回最近对局；比赛后可再检查。',ready:false,schema:null};
  const gameSeq=text(row.gameSeq),gameSvr=text(row.gameSvrId||row.gameSvr),relaySvr=text(row.relaySvrId||row.relaySvr),battleType=Number(row.battleType);
  if(!gameSeq||!gameSvr||!relaySvr||!Number.isInteger(battleType))return {message:'最近对局可读，但缺少请求十人详情的字段。',ready:false,schema:{listFields:Object.keys(row)}};
  const data=unwrap(await post('/game/battledetail',{recommendPrivacy:0,battleType,gameSvr,relaySvr,targetRoleId,gameSeq}));
  const all=[...rows(data.blueRoles),...rows(data.redRoles)],ids=all.map(r=>text(obj(r.basicInfo).roleId)),hasIds=all.length===10&&ids.every(Boolean)&&new Set(ids).size===10&&ids.includes(targetRoleId);
  return {message:hasIds?'营地连接正常，最近对局与十人角色面板均可读取。':'最近对局可读，十人角色面板暂不完整；赛后核验时会再检查。',ready:!!hasIds,schema:{topFields:Object.keys(data).slice(0,60),roleCount:all.length,basicFields:[...new Set(all.flatMap(r=>Object.keys(obj(r.basicInfo))))].slice(0,80),statsFields:[...new Set(all.flatMap(r=>Object.keys(obj(r.battleStats))))].slice(0,100),recordFields:[...new Set(all.flatMap(r=>Object.keys(obj(r.battleRecords))))].slice(0,100)}};
}

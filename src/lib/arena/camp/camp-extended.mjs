import {normalizeHeroStats} from './camp-heroes.mjs';
import {normalizeSeasonHistory} from './camp-seasons.mjs';

const ORIGIN='https://kohcamp.qq.com'; // hero schema revision 2
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const unpack=value=>object(value).data&&typeof value.data==='object'?object(value.data):object(value);
const list=value=>Array.isArray(value)?value.filter(item=>item&&typeof item==='object'&&!Array.isArray(item)):[];
const text=value=>['string','number'].includes(typeof value)?String(value).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,300):'';
const number=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
const fatal=error=>['auth','auth_required','rate_limit','hidden','cancelled'].includes(error?.code);

export function responseShape(value,depth=0){
 if(value===null)return 'null';
 if(depth>7)return Array.isArray(value)?'array':typeof value;
 if(Array.isArray(value))return {type:'array',length:value.length,examples:value.slice(0,2).map(item=>responseShape(item,depth+1))};
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).slice(0,100).map(key=>[key,responseShape(value[key],depth+1)]));
 return typeof value;
}

function profileDetails(profile,role,season,auth){
 const current=list(unpack(season).historyList)[0]||{};
 const rank=object(current.rankInfo),peak=object(current.masterInfo);
 const records=[
  ['营地 ID',auth.userId],['游戏昵称',role.roleName??role.nickname],['区服',role.areaName??role.roleText],
  ['角色 ID',role.roleId],['赛季排位场次',rank.totalCnt],['赛季排位胜场',rank.totalWinCnt],
  ['赛季排位评分',rank.averageScore],['巅峰分',peak.masterScore],['巅峰场次',peak.totalCnt],['巅峰评分',peak.averageScore],
 ];
 return {items:records.filter(([,value])=>value!==null&&value!==undefined&&text(value)!=='').map(([label,value])=>({label,value:text(value)})),message:'角色与赛季接口返回的游戏资料；缺失字段不作推算。'};
}

/** Only reads the authorized role. Additional season requests follow server-provided
 * season IDs. No guessed ID ranges, account rotation, retries or per-hero fan-out. */
export async function fetchExtended({auth,request,catalog=[],onProgress=()=>{},onObserve=()=>{},signal,delayMs=750,maxSeasons=64}){
 const state={status:'running',heroStats:{status:'idle',items:[],scope:'待同步'},seasons:{status:'idle',items:[],scope:'待同步'},profileDetails:{items:[]},coverage:{},limitations:[],progress:{status:'running',completed:0,total:5,message:'读取本人角色资料'}};
 let calls=0;
 const update=(message,completed)=>{state.progress={...state.progress,message,completed};onProgress(structuredClone(state));};
 const post=async(path,body)=>{
  if(signal?.aborted){const error=new Error('cancelled');error.code='cancelled';throw error;}
  if(calls++&&delayMs)await new Promise((resolve,reject)=>{const done=()=>{signal?.removeEventListener('abort',cancel);resolve();};const timer=setTimeout(done,delayMs);const cancel=()=>{clearTimeout(timer);const error=new Error('cancelled');error.code='cancelled';reject(error);};signal?.addEventListener('abort',cancel,{once:true});});
  if(signal?.aborted){const error=new Error('cancelled');error.code='cancelled';throw error;}
  try{
   const result=await request(ORIGIN+path,{method:'POST',body:JSON.stringify(body),auth});
   try{await onObserve(path,responseShape(result));}catch{}
   return result;
  }catch(error){try{await onObserve(path,{error:{code:text(error?.code),httpStatus:error?.details?.httpStatus??null,returnCode:error?.details?.returnCode??null,diagnosis:error?.details?.diagnosis??null}});}catch{}throw error;}
 };
 const reportFailure=(label,error)=>{state.limitations.push(`${label}暂未读取成功。`);if(fatal(error))throw error;};
 try{
  const profile=await post('/game/koh/profile',{targetUserId:String(auth.userId),targetRoleId:'0',resVersion:'3',recommendPrivacy:'0',apiVersion:'2'});
  const p=unpack(profile),roles=list(p.roleList);
  const wanted=text(auth.gameRoleId)||text(p.targetRoleId);
  const role=roles.find(item=>text(item.roleId)===wanted)||roles[0];
  if(!role?.roleId)throw Object.assign(new Error('missing role'),{code:'role_missing'});
  const roleId=text(role.roleId);
  const gameFacts={roleFields:Object.fromEntries(['roleId','gameRoleId','nrid','gameId','areaId','serverId'].map(key=>[key,text(role[key])])),modules:list(object(p.head).mods).map(mod=>{
   const raw=typeof mod.jumpUrl==='string'?mod.jumpUrl.slice(0,3000):'', query=raw.includes('?')?raw.split('?').slice(1).join('?'):'';
   const params=new URLSearchParams(query);
   return {name:text(mod.name),route:raw.split('?')[0].replace(/(token|openid|uin|key|code)=[^&]*/gi,'$1=REDACTED'),queryKeys:[...params.keys()],nestedRoute:(()=>{try{const u=new URL(params.get('url'));return {origin:u.origin,path:u.pathname,queryKeys:[...u.searchParams.keys()]};}catch{return null;}})(),gameParams:Object.fromEntries([...params].filter(([key])=>['roleId','uniqueRoleId','seasonId','page','route','heroid','heroId','modulename','toAppRoleId','toAreaId','toServerId'].includes(key)))};
  })};
  try{await onObserve('profile-game-routing',gameFacts);}catch{}

  update('读取赛季与历史段位',1);
  let season=null,seasonList=null;
  try{season=await post('/game/seasonpage',{recommendPrivacy:0,seasonId:0,roleId});state.seasons={status:'ready',scope:'接口返回的赛季快照',...normalizeSeasonHistory({seasonPayload:season})};}catch(error){state.seasons={...state.seasons,status:'error',message:'赛季记录暂未读取成功。'};reportFailure('赛季记录',error);}
  state.profileDetails=profileDetails(profile,role,season,auth);
  update('读取英雄战力、场次与胜率',2);
  // Shipped Hippy battle.zip / game-battle.zip call this RPC using target IDs.
  const candidates=[{path:'/game/profile/herolist',body:{targetRoleId:roleId,targetUserId:String(auth.userId)}}];
  const verifiedUnique=list(object(p.head).mods).map(mod=>{try{return new URL(mod.jumpUrl).searchParams.get('uniqueRoleId');}catch{return null;}}).find(value=>value&&/^\d+$/.test(value));
  if(verifiedUnique&&roleId===text(p.targetRoleId))candidates.push({path:'/play/h5getherolist',body:{uniqueRoleId:verifiedUnique}});
  const heroResults=[];
  for(const candidate of candidates){
   try{const payload=await post(candidate.path,candidate.body);const result=normalizeHeroStats(payload,{catalog,source:candidate.path});heroResults.push({...result,endpoint:candidate.path});if(result.items.length>state.heroStats.items.length)state.heroStats={status:'ready',...result};}
   catch(error){reportFailure('一个英雄数据入口',error);}
   update('核对英雄列表覆盖范围',3);
  }
  if(!heroResults.length||!state.heroStats.items.length)state.heroStats={...state.heroStats,status:'error',message:'已知英雄数据入口暂未返回可识别的记录。'};
  state.coverage.heroSources=heroResults.map(result=>({endpoint:result.endpoint,rows:result.items.length,coverage:result.coverage}));
  update('核对可访问的赛季列表',4);
  try{seasonList=await post('/game/seasonlist',{roleId});}catch(error){reportFailure('赛季目录',error);}
  let normalized=normalizeSeasonHistory({seasonPayload:season,seasonListPayload:seasonList});
  const collected=[...normalized.items];
  const seen=new Set(collected.map(row=>row.id).filter(Boolean));
  const todo=normalized.options.filter(option=>/^\d+$/.test(option.id||'')&&!seen.has(option.id)).slice(0,maxSeasons);
  state.progress.total=5+todo.length;
  for(let i=0;i<todo.length;i++){
   const option=todo[i];update(`读取 ${option.name||'赛季 '+option.id} 的段位记录`,5+i);
   try{
    const payload=await post('/game/seasonpage',{recommendPrivacy:0,seasonId:Number(option.id),roleId});
    const next=normalizeSeasonHistory({seasonPayload:payload,seasonListPayload:seasonList});
    for(const row of next.items){const key=row.id||`${row.name}:${row.startTime}`;if(!seen.has(key)){collected.push(row);seen.add(key);}}
   }catch(error){reportFailure(`赛季 ${option.name||option.id}`,error);}
  }
  state.seasons={status:collected.length?'ready':state.seasons.status,scope:'接口返回的赛季快照',...normalized,items:collected,coverage:{...normalized.coverage,returnedSeasons:collected.length,requestedAdditionalSeasons:todo.length}};
  if(normalized.options.length>maxSeasons+seen.size)state.limitations.push(`本次最多补充 ${maxSeasons} 个已列出的赛季，仍有未读取记录。`);
  state.coverage.requests=calls;
  state.coverage.heroRecords=state.heroStats.items.length;state.coverage.heroCatalogMatched=state.heroStats.coverage?.catalogMatched===true;state.coverage.seasonRecords=collected.length;
  state.limitations.push('英雄列表保留零场英雄及缺失统计的条目；熟练度为接口等级，最高战力未返回。','赛季记录不能等同于逐日段位曲线；未返回的历史不作补造。');
  state.status=state.heroStats.items.length&&collected.length?'ready':'partial';
  state.updatedAt=new Date().toISOString();state.progress={status:'complete',completed:state.progress.total,total:state.progress.total,message:'同步完成'};
  state.message=`已读取 ${state.heroStats.items.length} 个英雄记录、${collected.length} 个赛季快照。`;
 }catch(error){
  state.status=state.heroStats.items.length||state.seasons.items.length?'partial':'error';
  state.message=error?.code==='rate_limit'?'营地提示请求频繁，本次同步已停止。':error?.code==='auth'?'营地授权已失效，请重新扫码后同步。':error?.code==='cancelled'?'同步已取消。':'更多数据同步未能完成，已保留本次成功读取的记录。';
  state.progress={...state.progress,status:'stopped',message:state.message};state.limitations.push(state.message);state.errorCode=error?.code||'upstream';
  if(state.heroStats.items.length||state.seasons.items.length)state.updatedAt=new Date().toISOString();
 }
 onProgress(structuredClone(state));return state;
}

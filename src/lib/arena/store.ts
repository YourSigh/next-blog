import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { HeroStat, MatchStat, Player, PlayerPreferences, Provider, SeasonStat, SeasonStats } from './types.ts';
import { LANES } from './types.ts';
import { HERO_CATALOG, heroIcon, resolveHeroLanes } from './hero-lanes.ts';

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown, max: number) => Array.isArray(value) ? value.slice(0,max).map(object) : [];
const text = (value: unknown, max = 200): string | null => typeof value === 'string' || typeof value === 'number' ? String(value).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max) || null : null;
const num = (value: unknown, max=1e9) => (typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value)) && Number(value)>=0 && Number(value)<=max ? Number(value) : null;
const image = (value: unknown): string | null => { try { const url=new URL(text(value,2000) || ''); return url.protocol==='https:'&&!url.username&&!url.password ? url.href : null; } catch { return null; } };
const hero = (h: Row): HeroStat => {const id=text(h.id??h.heroId,30),name=text(h.name??h.heroName)||'未知英雄';return {id,name,games:num(h.games),wins:num(h.wins),losses:num(h.losses),winRate:num(h.winRate,100),power:num(h.power),maxPower:num(h.maxPower),proficiency:num(h.proficiency,100),icon:image(h.icon)||heroIcon(id),lanes:resolveHeroLanes({id,name}).lanes};};
const seasonStats = (raw:unknown): SeasonStats => { const s=object(raw); return {games:num(s.games),wins:num(s.wins),winRate:num(s.winRate,100),averageScore:num(s.averageScore),maxWinStreak:num(s.maxWinStreak),goldMedals:num(s.goldMedals),silverMedals:num(s.silverMedals),heroes:rows(s.heroes,50).map(h=>({id:text(h.id,30),name:text(h.name),games:num(h.games),wins:num(h.wins),winRate:num(h.winRate,100),power:num(h.power)}))}; };
const season = (s: Row): SeasonStat => ({id:text(s.id,30),name:text(s.name),rank:text(s.rank),stars:num(s.stars,10000),maxRank:text(s.maxRank),maxStars:num(s.maxStars,10000),peakScore:num(s.peakScore,10000),games:num(s.games),wins:num(s.wins),winRate:num(s.winRate,100),averageScore:num(s.averageScore),rankStats:seasonStats(s.rankStats),peakStats:seasonStats(s.peakStats),startTime:text(s.startTime,40),endTime:text(s.endTime,40)});
const match = (m:Row):MatchStat => {const heroId=text(m.heroId,30),supplied=text(m.heroName??m.hero);const heroName=(!supplied||/^英雄\s*\d+$/.test(supplied)?HERO_CATALOG.find(h=>String(h.ename)===heroId)?.cname:null)||supplied||'未知英雄';return {id:text(m.id,100)||undefined,heroId,heroName,result:text(m.result,20),mode:text(m.mode,80),kills:num(m.kills,1000),deaths:num(m.deaths,1000),assists:num(m.assists,1000),score:num(m.score,1000),playedAt:text(m.playedAt,60),durationSeconds:num(m.durationSeconds,86400)};};
export const defaultPreferences = (): PlayerPreferences => ({preferredLanes:[],avoidedLanes:[],laneAdjustments:{}});
export function normalizePreferences(raw: unknown): PlayerPreferences {
  const p=object(raw);
  const lanes=(value:unknown)=>Array.isArray(value)?[...new Set(value.filter((v):v is typeof LANES[number]=>typeof v==='string'&&LANES.includes(v as typeof LANES[number])))].slice(0,5):[];
  const preferredLanes=lanes(p.preferredLanes),avoidedLanes=lanes(p.avoidedLanes).filter(lane=>!preferredLanes.includes(lane));
  const laneAdjustments:PlayerPreferences['laneAdjustments']={};
  for(const lane of LANES){const n=object(p.laneAdjustments)[lane];if(typeof n==='number'&&Number.isFinite(n))laneAdjustments[lane]=Math.max(-15,Math.min(15,Math.round(n)));}
  return {preferredLanes,avoidedLanes,laneAdjustments};
}
/** Projection of game data only: credentials and arbitrary upstream fields cannot pass. */
export function normalizePlayer(value:unknown):Player {
  const p=object(value),c=object(p.coverage);
  if(!/^[a-f0-9]{24}$/.test(String(p.id)))throw Error('选手标识无效');
  const heroes=rows(p.heroes,500).map(hero),seasons=rows(p.seasons,300).map(season),matches=rows(p.matches,200).map(match);
  return {id:String(p.id),roleKey:typeof p.roleKey==='string'&&/^[a-f0-9]{64}$/.test(p.roleKey)?p.roleKey:null,provider:p.provider==='wechat'?'wechat':'qq',nickname:text(p.nickname)||'未命名选手',avatar:image(p.avatar),area:text(p.area),rank:text(p.rank),stars:num(p.stars,10000),updatedAt:text(p.updatedAt,40)||new Date().toISOString(),importedAt:text(p.importedAt,40)||new Date().toISOString(),heroes,seasons,matches,preferences:normalizePreferences(p.preferences),coverage:{heroRecords:heroes.length,seasonRecords:seasons.length,matchRecords:matches.length,catalogMatched:c.catalogMatched===true,limitations:Array.isArray(c.limitations)?c.limitations.slice(0,15).map(v=>text(v,300)?.replace('只读取本人最近一页战绩，英雄统计由这一页聚合，不代表完整生涯英雄池或完整赛季。','最近对局只覆盖最新一页；累计英雄档案与最近对局分别展示。').replace('只读取本人最近一页战绩，英雄统计由这一页聚合，不代表完整英雄池或完整赛季。','最近对局只覆盖最新一页；累计英雄档案与最近对局分别展示。')).filter((v):v is string=>!!v):[]}};
}
export function playerIdFor(userId:string,roleId:string,provider:Provider){return createHash('sha256').update(`arena-v1:${provider}:${userId}:${roleId}`).digest('hex').slice(0,24);}
export function gameRoleKey(roleId:string){return createHash('sha256').update(`arena-koh-role-v1:${roleId}`).digest('hex');}
export function playerFromCamp({userId,roleId,provider,dashboard,extended}:{userId:string;roleId:string;provider:Provider;dashboard:unknown;extended:unknown}):Player {
  const d=object(dashboard),p=object(d.profile),e=object(extended),s=object(e.seasons),h=object(e.heroStats),first=rows(s.items,1)[0]||{};
  return normalizePlayer({id:playerIdFor(userId,roleId,provider),roleKey:roleId?gameRoleKey(roleId):null,provider,nickname:p.nickname,avatar:p.avatar,area:p.area,rank:first.rank??p.rank,stars:first.stars,updatedAt:e.updatedAt||new Date().toISOString(),importedAt:new Date().toISOString(),heroes:h.items,seasons:s.items,matches:d.matches,preferences:defaultPreferences(),coverage:{catalogMatched:object(h.coverage).catalogMatched,limitations:[...(Array.isArray(d.limitations)?d.limitations:[]),...(Array.isArray(e.limitations)?e.limitations:[])]}});
}
export function arenaDataDirectory(){ return process.env.ARENA_DATA_DIR || (process.env.ATTACHMENTS_DIR ? path.join(process.env.ATTACHMENTS_DIR,'.arena','players') : path.join(process.cwd(),'data','arena')); }
export function createPlayerStore(directory=arenaDataDirectory()) {
  const file=(id:string)=>{if(!/^[a-f0-9]{24}$/.test(id))throw Error('选手标识无效');return path.join(directory,id+'.json');};
  let queue:Promise<unknown>=Promise.resolve();
  const mutate=<T>(operation:()=>Promise<T>):Promise<T>=>{const next=queue.then(operation,operation);queue=next.catch(()=>{});return next;};
  const read=async(id:string):Promise<Player|null>=>{try{const raw=await readFile(file(id),'utf8');if(Buffer.byteLength(raw)>8*1024*1024)throw Error('档案超出读取上限');const data=JSON.parse(raw);return normalizePlayer(data.player);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}};
  return {
    read,
    async list(){let names:string[];try{names=await readdir(directory);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}const ids=names.filter(n=>/^[a-f0-9]{24}\.json$/.test(n)).slice(0,500).map(n=>n.slice(0,-5));const found=await Promise.all(ids.map(async id=>{try{return await read(id);}catch{return null;}}));return found.filter((p):p is Player=>!!p).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));},
    save(value:Player){return mutate(async()=>{await mkdir(directory,{recursive:true,mode:0o700});const player=normalizePlayer(value),target=file(player.id);let previous:Row={};try{previous=JSON.parse(await readFile(target,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      const prior=previous.player?normalizePlayer(previous.player):null;player.importedAt=prior?.importedAt||player.importedAt;player.preferences=prior?.preferences||player.preferences;
      const snapshots=rows(previous.snapshots,29).map(s=>normalizePlayer(s));snapshots.push(player);
      const temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify({version:1,player,snapshots:snapshots.slice(-30)}),{mode:0o600});await rename(temp,target);return player;});},
    preferences(id:string,value:unknown){return mutate(async()=>{const player=await read(id);if(!player)throw Error('选手不存在');player.preferences=normalizePreferences(value);const target=file(id),data=JSON.parse(await readFile(target,'utf8'));const temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify({...data,player}),{mode:0o600});await rename(temp,target);return player;});},
    bindRoleIdentity(id:string,roleKey:string){return mutate(async()=>{if(!/^[a-f0-9]{64}$/.test(roleKey))throw Error('角色标识无效');const target=file(id),data=JSON.parse(await readFile(target,'utf8')),player=normalizePlayer(data.player);player.roleKey=roleKey;const temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify({...data,player}),{mode:0o600});await rename(temp,target);return player;});},
    remove(id:string){return mutate(async()=>{try{await unlink(file(id));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}});},
    async history(id:string){try{const raw=JSON.parse(await readFile(file(id),'utf8'));return rows(raw.snapshots,30).map(normalizePlayer);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}},
  };
}

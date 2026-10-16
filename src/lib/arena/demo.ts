import { HERO_CATALOG, resolveHeroLanes, heroIcon } from './hero-lanes.ts';
import { LANES, type Player } from './types.ts';
/** Explicitly fictional, never persisted or mixed with the real public pool. */
export function createDemoPlayers():Player[]{
  const names=['北境','白夜','折光','回声','山岚','望野','墨雨','拾光','远山','清和'];
  return names.map((nickname,index)=>{
    const primary=LANES[index%5],secondary=LANES[(index+1)%5];
    const heroes=HERO_CATALOG.filter(h=>resolveHeroLanes({id:String(h.ename),name:h.cname}).lanes.includes(primary)).slice(0,9).map((h,i)=>{
      const games=30+(index*17+i*11)%160,wins=Math.round(games*(0.48+((index+i)%7)*0.017));return {id:String(h.ename),name:h.cname,games,wins,losses:games-wins,winRate:Math.round(wins/games*1000)/10,power:1800+(index*311+i*137)%5000,proficiency:4+(i%4),maxPower:null,icon:heroIcon(h.ename),lanes:resolveHeroLanes({id:String(h.ename),name:h.cname}).lanes};
    });
    return {id:`demo-${index+1}`,provider:index%2?'wechat':'qq',nickname:`${nickname} · 示例`,avatar:null,area:'虚构演示区',rank:'最强王者',stars:[22,35,10,48,28,25,30,14,44,31][index],updatedAt:'2026-10-16T04:00:00.000Z',importedAt:'2026-10-16T04:00:00.000Z',heroes,seasons:[],matches:[],preferences:{preferredLanes:[primary,secondary],avoidedLanes:[],laneAdjustments:{}},coverage:{heroRecords:heroes.length,seasonRecords:0,matchRecords:0,catalogMatched:false,limitations:['虚构演示选手，仅用于体验交互与分队算法，不代表真实账号。']},sample:true};
  });
}

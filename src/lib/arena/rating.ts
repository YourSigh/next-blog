import { LANES, LANE_LABELS, type HeroStat, type Lane, type LaneRating, type Player, type PlayerRating, type SeasonStat } from './types.ts';
import { HERO_LANE_VERSION, isLane, resolveHeroLanes } from './hero-lanes.ts';

export const RATING_VERSION = 'arena-role-evidence-v2';
const clamp = (n:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,n));
const round = (n:number,p=2)=>Number(n.toFixed(p));
const finite = (n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const count = (n:unknown):n is number=>finite(n)&&Number.isSafeInteger(n)&&n>=0;
const stamp = (s:unknown)=>typeof s==='string'&&Number.isFinite(Date.parse(s))?Date.parse(s):null;
const DAY=86400000;
function interpolate(n:number,anchors:readonly (readonly [number,number])[]):number {
  if(n<=anchors[0][0])return anchors[0][1];
  for(let i=1;i<anchors.length;i++){const [x,y]=anchors[i],[px,py]=anchors[i-1];if(n<=x)return py+(y-py)*(n-px)/(x-px);}
  return anchors[anchors.length-1][1];
}
/** Heuristic common scale, never an official MMR or a player percentile. */
export function rankIndex(rank:string|null,stars:number|null):number|null {
  if(typeof rank!=='string')return null;
  if(/王者/.test(rank)){
    const named=rank.match(/(\d+)\s*星/),floor=/传奇|百星/.test(rank)?100:/荣耀/.test(rank)?50:/无双/.test(rank)?25:/至圣/.test(rank)?40:/非凡/.test(rank)?10:0;
    const n=finite(stars)&&stars>=0?stars:named?Number(named[1]):floor;
    return round(62+clamp(n,0,150)*.2);
  }
  for(const [name,base,divisions]of[['青铜',16,3],['白银',23,3],['黄金',31,4],['铂金',39,4],['钻石',47,5],['星耀',55,5]]as const){
    if(!rank.includes(name))continue;
    const roman=rank.match(/(IV|III|II|V|I)\s*$/)?.[1],part=roman?({I:1,II:2,III:3,IV:4,V:5}[roman]??divisions):divisions;
    return round(base+(divisions-part)*1.1+(finite(stars)?clamp(stars,0,5)*.18:0));
  }
  return null;
}
export function peakIndex(points:number):number {
  return interpolate(points,[[0,20],[1200,50],[1500,64],[1800,77],[2100,87],[2400,94],[2700,98]]);
}
export function powerIndex(power:number):number {
  return interpolate(power,[[0,0],[500,15],[1500,32],[3000,50],[5000,65],[7500,78],[10000,88],[15000,96],[20000,100]]);
}
type Sample={games:number;wins:number;quality:number};
function sample(games:unknown,wins:unknown,winRate:unknown):Sample|null {
  if(!count(games)||games===0)return null;
  if(count(wins)&&wins<=games)return{games,wins,quality:1};
  if(finite(winRate)&&winRate>=0&&winRate<=100)return{games,wins:games*winRate/100,quality:.7};
  return null;
}
function posterior(s:Sample,cap:number,modeQuality=1){const n=Math.min(s.games,cap)*s.quality*modeQuality;return{n,rate:(s.wins/s.games*n+12)/(n+24)};}
const seasonSequence=(s:SeasonStat)=>Number((s.id??s.name??'').match(/\d+/)?.[0]??0);
function orderedSeasons(player:Player){
  const unique=new Map<string,SeasonStat>();
  for(const [i,s]of(player.seasons??[]).entries()){const key=s.id??s.name??`row-${i}`;if(!unique.has(key))unique.set(key,s);}
  return [...unique.values()].sort((a,b)=>seasonSequence(b)-seasonSequence(a)||(stamp(b.endTime)??stamp(b.startTime)??0)-(stamp(a.endTime)??stamp(a.startTime)??0));
}
function seasonWeight(season:SeasonStat,latest:SeasonStat,index:number,reference:number|null){
  const a=seasonSequence(latest),b=seasonSequence(season),gap=a&&b?Math.max(0,a-b):index;
  const time=stamp(season.endTime)??stamp(season.startTime);
  return Math.pow(.6,gap)*(reference!==null&&time!==null?Math.exp(-Math.max(0,reference-time)/DAY/270):1);
}
function competitiveMatches(player:Player){
  const ref=stamp(player.updatedAt),seen=new Set<string>();
  if(ref===null)return[];
  return (player.matches??[]).filter(m=>{
    const mode=String(m.mode??'').toLowerCase(),time=stamp(m.playedAt);
    if(/开房|自定义|人机|custom|room|娱乐|匹配/.test(mode)||!/排位|ranked|巅峰|peak/.test(mode))return false;
    if(time===null||ref-time<0||ref-time>30*DAY||!['win','loss','lose','胜利','失败'].includes(String(m.result)))return false;
    if(m.id){if(seen.has(m.id))return false;seen.add(m.id);}return true;
  }).sort((a,b)=>(stamp(b.playedAt)??0)-(stamp(a.playedAt)??0)).slice(0,30);
}
const won=(result:unknown)=>['win','胜利'].includes(String(result));
type HeroSignal={hero:HeroStat;lanes:Lane[];mapping:number;games:number|null;rate:number|null;n:number;seasonGames:number;recentGames:number;power:number|null;practice:number;strength:number};

export function ratePlayer(player:Player):PlayerRating {
  const seasons=orderedSeasons(player),reference=stamp(player.updatedAt),recent=competitiveMatches(player);
  const current=rankIndex(player.rank,player.stars);
  const history=seasons.slice(0,3).map((s,i)=>({score:rankIndex(s.rank,s.stars),weight:seasonWeight(s,seasons[0],i,reference)})).filter((r):r is{score:number;weight:number}=>r.score!==null);
  const historyWeight=history.reduce((n,r)=>n+r.weight,0),historical=historyWeight?history.reduce((n,r)=>n+r.score*r.weight,0)/historyWeight:null;
  let rank=current??historical??50;
  if(current!==null&&historical!==null)rank=.8*current+.2*historical;
  const peaks=seasons.slice(0,3).flatMap((s,i)=>finite(s.peakScore)&&s.peakScore>0&&count(s.peakStats?.games)&&s.peakStats.games>0?[{points:s.peakScore,games:s.peakStats.games,weight:seasonWeight(s,seasons[0],i,reference)}]:[]);
  const peakWeight=peaks.reduce((n,s)=>n+s.weight*Math.min(s.games,100),0);
  const peakPoints=peakWeight?peaks.reduce((n,s)=>n+s.points*s.weight*Math.min(s.games,100),0)/peakWeight:null;
  const peakReliability=peakWeight/(peakWeight+30),peak=peakPoints===null?null:peakIndex(peakPoints);
  const recentRate=recent.length?(recent.filter(m=>won(m.result)).length+12)/(recent.length+24):.5;
  const recentDelta=clamp((recentRate-.5)*8,-1.5,1.5);
  const account=clamp(rank+(peak===null?0:(peak-rank)*.35*peakReliability)+recentDelta,5,95);
  const accountConfidence=clamp(.15+(current!==null?.42:historical!==null?.25:0)+Math.min(historyWeight,2)*.04+.12*peakReliability+.08*recent.length/30,.1,.88);

  // Season hero lists are partial. Presence provides evidence; absence is not
  // zero usage. Lifetime, season and recent observations overlap: blend their
  // estimates and take max effective N instead of adding the same games twice.
  const seasonal=new Map<string,{games:number;wins:number;quality:number}>();
  const heroMap=new Map<string,HeroStat>();
  const keyFor=(id:string|null,name:string|null)=>id?`id:${id}`:`name:${name}`;
  for(const h of player.heroes??[]){const key=keyFor(h.id,h.name);if(!heroMap.has(key))heroMap.set(key,h);}
  for(const [i,s]of seasons.slice(0,3).entries()){
    const weight=seasonWeight(s,seasons[0],i,reference);
    for(const stats of [s.rankStats,s.peakStats]){const seen=new Set<string>();for(const h of stats?.heroes??[]){
      const evidence=sample(h.games,h.wins,h.winRate);if(!evidence)continue;
      const key=keyFor(h.id,h.name);if(seen.has(key))continue;seen.add(key);const old=seasonal.get(key)??{games:0,wins:0,quality:1};
      const n=Math.min(evidence.games,80)*weight*evidence.quality;old.games+=n;old.wins+=n*evidence.wins/evidence.games;seasonal.set(key,old);
      if(!heroMap.has(key))heroMap.set(key,{id:h.id,name:h.name??`英雄 ${h.id}`,games:null,wins:null,winRate:null,power:null,proficiency:null});
    }}
  }
  const signals:HeroSignal[]=[];
  for(const [key,h]of heroMap){
    const mapping=resolveHeroLanes(h);if(!mapping.lanes.length)continue;
    const games=count(h.games)?h.games:count(h.wins)&&count(h.losses)?h.wins+h.losses:null;
    const life=sample(games,h.wins,h.winRate),lifePost=life?posterior(life,180,.55):null;
    const s=seasonal.get(key),seasonPost=s&&s.games>0?{n:s.games,rate:(s.wins+12)/(s.games+24)}:null;
    const matches=recent.filter(m=>keyFor(m.heroId,m.heroName)===key);
    const recentPost=matches.length?{n:matches.length,rate:(matches.filter(m=>won(m.result)).length+12)/(matches.length+24)}:null;
    let rate=lifePost?.rate??seasonPost?.rate??recentPost?.rate??null;
    if(rate!==null&&seasonPost){const w=.75*seasonPost.n/(seasonPost.n+12);rate=rate*(1-w)+seasonPost.rate*w;}
    if(rate!==null&&recentPost){const w=.45*recentPost.n/(recentPost.n+8);rate=rate*(1-w)+recentPost.rate*w;}
    const n=Math.max(lifePost?.n??0,seasonPost?.n??0,recentPost?.n??0);
    const power=finite(h.power)&&h.power>=0?h.power:null;
    const practice=100*(1-Math.exp(-Math.max(games??0,s?.games??0,matches.length)/60));
    // Select reliable main heroes, not whichever has a lucky 1/1 win rate.
    const strength=.5*(1-Math.exp(-((s?.games??0)+matches.length*2)/20))+.3*practice/100+.2*powerIndex(power??0)/100;
    signals.push({hero:h,lanes:mapping.lanes,mapping:mapping.confidence,games,rate,n,seasonGames:s?.games??0,recentGames:matches.length,power,practice,strength});
  }
  const totalGames=signals.reduce((n,s)=>n+(s.games??0),0);
  const totalSeasonGames=signals.reduce((n,s)=>n+s.seasonGames,0);
  const totalPower=signals.reduce((n,s)=>n+(s.power??0),0);
  const preferred=new Set((player.preferences?.preferredLanes??[]).filter(isLane)),avoided=new Set((player.preferences?.avoidedLanes??[]).filter(isLane));
  const reasons=[
    current===null?'当前段位不可识别，使用可用近季记录或中性先验。':`当前段位指数 ${current}，近三季记录作小幅平滑。`,
    peakPoints===null?'近三季没有实际巅峰场次：0分和未参赛的1200分不作为实力证据。':`近三季实际参赛的巅峰记录加权约 ${Math.round(peakPoints)} 分，按场次与赛季距离降低权重。`,
    `近30天取最多30场排位/巅峰：${recent.length}场；开房、匹配、娱乐和未知模式不计入竞技近况。`,
    '分路基础由账号40%、主力英雄胜率25%、熟练度20%、英雄池15%组成；另计当前战力0至10分及个人分路专精-14至10分。',
    '战力受段位、巅峰系数、活跃程度和赛季影响，低战力不扣基础分；历史最高战力不冒充当前战力。',
    '最终位置评分限制在5至95；证据充分度是数据覆盖指标，不是胜率或经过校准的统计概率。',
    `英雄分路采用 ${HERO_LANE_VERSION}；多位置英雄分摊场次和覆盖，不代表已取得官方实际分路统计。`,
  ];
  if(player.sample)reasons.unshift('虚构演示选手，不代表真实账号。');
  const lanes=Object.fromEntries(LANES.map(lane=>{
    const rows=signals.filter(s=>s.lanes.includes(lane)),used=rows.filter(s=>(s.games??0)>0||s.seasonGames>0||s.recentGames>0||(s.power??0)>0);
    const known=rows.filter(s=>s.games!==null).length;
    const complete=player.coverage.catalogMatched&&rows.length>0&&known/rows.length>=.65;
    const unknown=!used.length&&!complete;
    const games=rows.reduce((n,s)=>n+(s.games??0)/s.lanes.length,0);
    const seasonalGames=rows.reduce((n,s)=>n+s.seasonGames/s.lanes.length,0);
    const main=[...used].sort((a,b)=>b.strength-a.strength||String(a.hero.id??a.hero.name).localeCompare(String(b.hero.id??b.hero.name))).slice(0,3);
    const coreWeights=[.5,.3,.2];
    const blend=(pick:(s:HeroSignal)=>number|null)=>{let sum=0,weight=0;for(const [i,s]of main.entries()){const v=pick(s);if(v===null)continue;const w=coreWeights[i]/s.lanes.length;sum+=v*w;weight+=w;}return weight?sum/weight:null;};
    const winRate=blend(s=>s.rate===null?null:s.rate*100);
    const performance=winRate===null?50:clamp(50+(winRate/100-.5)*160,10,90);
    const share=totalGames>0?games/totalGames:0;
    const gameExperience=100*(.8*(1-Math.exp(-Math.max(games,seasonalGames)/180))+.2*Math.sqrt(clamp(share/.4,0,1)));
    const proficiency=blend(s=>finite(s.hero.proficiency)?interpolate(s.hero.proficiency,[[0,0],[3,30],[5,60],[8,90],[10,100]]):null);
    const experience=proficiency===null?gameExperience:.9*gameExperience+.1*proficiency;
    const ready=used.reduce((n,s)=>n+Math.sqrt(clamp(Math.max(s.games??0,s.seasonGames,s.recentGames)/50,0,1))/s.lanes.length,0);
    const depth=100*(1-Math.exp(-ready/2.5));
    const powerRows=[...used].filter(s=>s.power!==null).sort((a,b)=>b.power!-a.power!).slice(0,3);
    const powerWeight=powerRows.reduce((n,s,i)=>n+coreWeights[i]/s.lanes.length,0);
    const power=powerWeight?powerRows.reduce((n,s,i)=>n+powerIndex(s.power!)*coreWeights[i]/s.lanes.length,0)/powerWeight:null;
    const powerBonus=(power??0)*.10;
    // Within-player specialization is centered on equal five-lane exposure.
    // It does not force a spread for a genuinely balanced hero pool. Partial
    // season lists provide observed preference, never official lane counts.
    const lanePower=rows.reduce((n,s)=>n+(s.power??0)/s.lanes.length,0);
    let shareSum=0,shareWeight=0;
    if(totalGames>0){shareSum+=share*.5;shareWeight+=.5;}
    if(totalSeasonGames>0){shareSum+=seasonalGames/totalSeasonGames*.35;shareWeight+=.35;}
    if(totalPower>0){shareSum+=lanePower/totalPower*.15;shareWeight+=.15;}
    const specializationShare=shareWeight?shareSum/shareWeight:.2;
    const specialization=shareWeight?clamp(12*Math.log((specializationShare+.04)/.24),-14,10):0;
    const manualValue=player.preferences?.laneAdjustments?.[lane],manual=finite(manualValue)?clamp(manualValue,-15,15):0;
    const raw=unknown?account-12:.40*account+.25*performance+.20*experience+.15*depth+powerBonus+specialization;
    const effective=rows.reduce((n,s)=>n+s.n*s.mapping/s.lanes.length,0);
    const laneConfidence=unknown?Math.min(.25,accountConfidence*.35):clamp(.2*accountConfidence+.43*effective/(effective+65)+.15*ready/(ready+2)+.08*(powerRows.length>0?1:0)+.10*(complete?1:.5),.1,.88);
    const evidence:LaneRating['evidence']=unknown?'unknown':effective>=35&&ready>=1?'supported':'limited';
    let preference=unknown?.25:clamp(.2+.8*Math.sqrt(clamp(share/.4,0,1)),.15,1);
    if(preferred.has(lane))preference=1;if(avoided.has(lane))preference=.05;
    const laneReasons=[
      unknown?'该路资料不足，页面不展示确定分数；分队使用账号指数减12的保守补位先验。':`${LANE_LABELS[lane]}按英雄映射累计约${Math.round(games)}场，近三季可见英雄约${Math.round(seasonalGames)}个加权场次。`,
      main.length?`主力英雄：${main.map(s=>s.hero.name).join('、')}；取可靠的前3名，不用全英雄均值稀释专精。`:'未见该路有使用记录的主力英雄。',
      winRate===null?'胜率样本不足，保留50%的中性先验。':`主力英雄收缩后胜率约${round(winRate,1)}%；生涯、近季和近况分层混合，重叠场次不累加为独立样本。`,
      `当前战力加成 +${round(powerBonus,1)}；${round(ready,1)}个折算熟练英雄，英雄池深度 ${round(depth,1)}。`,
      `个人专精修正 ${specialization>=0?'+':''}${round(specialization,1)}：生涯使用、近季可见主力英雄和当前战力分布综合占比约${round(specializationShare*100,1)}%。`,
      '多分路英雄的个人实际位置未知，场次与英雄池按位置数分摊；开房KDA不提升竞技分。',
    ];
    if(!unknown&&!used.length)laneReasons.push('英雄档案覆盖较完整，但未见该路练习记录：按低熟练度补位估计，证据仍较少。');
    if(preferred.has(lane))laneReasons.push('本人偏好此路，分队优先适配；偏好本身不额外增加实力分。');
    if(avoided.has(lane))laneReasons.push('本人选择尽量避开此路。');
    if(manual)laneReasons.push(`本人手动校正 ${manual>0?'+':''}${manual} 分，与观测证据分开。`);
    return[lane,{
      score:round(clamp(raw+manual,5,95)),confidence:round(laneConfidence),games:Math.round(games),winRate:winRate===null?null:round(winRate,1),preference:round(preference,3),reasons:laneReasons,evidence,
      components:unknown?[{key:'prior',label:'分队暂用补位先验',value:round(clamp(account-12,5,95),1),weight:1}]:[{key:'account',label:'账号竞技水平',value:round(account,1),weight:.4},{key:'performance',label:'主力英雄表现',value:round(performance,1),weight:.25},{key:'experience',label:'分路熟练度',value:round(experience,1),weight:.2},{key:'depth',label:'英雄池深度',value:round(depth,1),weight:.15},{key:'power',label:'当前战力加成',value:power===null?null:round(power,1),weight:0,bonus:round(powerBonus,1)},{key:'specialization',label:'个人分路专精',value:round(clamp(specializationShare/.4*100,0,100),1),weight:0,bonus:round(specialization,1)}],
      topHeroes:main.map(s=>({id:s.hero.id,name:s.hero.name,icon:s.hero.icon??null,games:s.games,power:s.power,winRate:s.rate===null?null:round(s.rate*100,1)})),manual,
    }satisfies LaneRating];
  }))as Record<Lane,LaneRating>;
  const best=Math.max(...LANES.filter(l=>lanes[l].evidence!=='unknown').map(l=>lanes[l].score),0);
  for(const lane of LANES){const item=lanes[lane];item.specialty=item.evidence==='unknown'?'资料不足':item.games<20&&item.evidence==='limited'?'练习较少':item.score>=best-3?'优势分路':item.score>=best-10?'常用分路':'补位分路';}
  return{playerId:player.id,overall:round(account),confidence:round(accountConfidence),lanes,reasons,version:RATING_VERSION,
    basis:{rankScore:round(rank),peakScore:peak===null?null:round(peak),peakPoints:peakPoints===null?null:Math.round(peakPoints),recentGames:recent.length}};
}

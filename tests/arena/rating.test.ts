import test from 'node:test';import assert from 'node:assert/strict';
import {createDemoPlayers}from'../../src/lib/arena/demo.ts';import{ratePlayer,rankIndex}from'../../src/lib/arena/rating.ts';
const base=createDemoPlayers()[0];
test('unknown records keep neutral prior and low confidence rather than fabricated strength',()=>{const r=ratePlayer({...base,rank:null,stars:null,heroes:[],matches:[],seasons:[],sample:false});assert.equal(r.overall,50);assert.ok(r.confidence<.3);assert.equal(r.lanes.clash.winRate,null);});
test('tiny samples are shrunk and custom-room games cannot change recent-ranked correction',()=>{const hero={...base.heroes[0],games:1,wins:1,losses:0,winRate:100};const a=ratePlayer({...base,heroes:[hero],matches:[]});const lane=hero.lanes![0];assert.ok(a.lanes[lane].winRate!<60);const b=ratePlayer({...base,heroes:[hero],matches:[{heroId:hero.id,heroName:hero.name,result:'win',mode:'王者峡谷 开房间',kills:50,deaths:0,assists:99,score:100,playedAt:base.updatedAt}]});assert.equal(a.overall,b.overall);});
test('manual preference is explicit and calibration is bounded',()=>{const a=ratePlayer(base);const b=ratePlayer({...base,preferences:{preferredLanes:['mid'],avoidedLanes:['farm'],laneAdjustments:{mid:999}}});assert.equal(b.lanes.mid.preference,1);assert.equal(b.lanes.farm.preference,.05);assert.ok(b.lanes.mid.score-a.lanes.mid.score<=15.01);assert.equal(rankIndex('无双王者',30),68);});

import { LANES, type HeroStat, type Lane, type Player, type SeasonStat } from '../../src/lib/arena/types.ts';
const heroFor=(lane:Lane,games=80,wins=44,power=1800):HeroStat=>({id:`fixture-${lane}`,name:`测试${lane}`,lanes:[lane],games,wins,losses:games-wins,winRate:games?wins/games*100:0,power,proficiency:5});
function profile(heroes=LANES.map(lane=>heroFor(lane))):Player{return{...base,sample:false,rank:'最强王者',stars:20,heroes,matches:[],seasons:[],preferences:{preferredLanes:[],avoidedLanes:[],laneAdjustments:{}},coverage:{heroRecords:heroes.length,seasonRecords:0,matchRecords:0,catalogMatched:true,limitations:[]}};}
const season=(id:string,peakScore:number,peakGames:number):SeasonStat=>({id,name:`S${id}`,rank:'最强王者',stars:20,peakScore,games:100,wins:55,winRate:55,averageScore:null,peakStats:{games:peakGames,wins:Math.floor(peakGames*.55),winRate:55,averageScore:null,maxWinStreak:null,goldMedals:null,silverMedals:null,heroes:[]}});
test('a real lane specialist scores clearly above the same player on barely practised lanes',()=>{
 const p=profile(LANES.map(lane=>lane==='jungle'?heroFor(lane,500,310,8000):heroFor(lane,3,1,70)));
 const r=ratePlayer(p);assert.ok(r.lanes.jungle.score-r.lanes.farm.score>20);assert.equal(r.lanes.jungle.specialty,'优势分路');assert.equal(r.lanes.farm.evidence,'limited');
});
test('equal five-lane evidence produces equal scores without an artificial spread',()=>{
 const r=ratePlayer(profile());const values=LANES.map(l=>r.lanes[l].score);assert.equal(Math.max(...values),Math.min(...values));
 for(const lane of LANES)assert.equal(r.lanes[lane].components.find(c=>c.key==='specialization')?.bonus,0);
});
test('current hero power changes the relevant lane and its bounded power contribution',()=>{
 const a=profile([heroFor('jungle',200,120,1000)]),b=profile([heroFor('jungle',200,120,12000)]);
 const x=ratePlayer(a),y=ratePlayer(b);assert.ok(y.lanes.jungle.score>x.lanes.jungle.score);assert.equal(y.overall,x.overall);
 assert.ok(y.lanes.jungle.components.find(c=>c.key==='power')!.bonus!<=10);
 const historical=ratePlayer({...a,heroes:[{...a.heroes[0],maxPower:25000}]});assert.equal(historical.lanes.jungle.score,x.lanes.jungle.score);
});
test('peak points require played games; high competitive peak evidence affects account strength',()=>{
 const p=profile(),empty=ratePlayer({...p,seasons:[season('50',1200,0)]}),none=ratePlayer({...p,seasons:[season('50',0,0)]});assert.equal(empty.overall,none.overall);assert.equal(empty.basis.peakPoints,null);
 const low=ratePlayer({...p,seasons:[season('50',1500,80)]}),high=ratePlayer({...p,seasons:[season('50',2200,80)]});assert.ok(high.overall>low.overall);assert.equal(high.basis.peakPoints,2200);
 const old=ratePlayer({...p,seasons:[season('50',1200,0),season('49',1200,0),season('48',1200,0),season('20',2700,500)]});assert.equal(old.basis.peakPoints,null);
});
test('current competitive hero records influence their lane; room KDA and duplicates do not',()=>{
 const p=profile();const s=season('50',0,0);s.rankStats={games:100,wins:30,winRate:30,averageScore:null,maxWinStreak:null,goldMedals:null,silverMedals:null,heroes:[{id:p.heroes[2].id,name:p.heroes[2].name,games:80,wins:20,winRate:25,power:null}]};
 const without=ratePlayer(p),withSeason=ratePlayer({...p,seasons:[s]});assert.ok(withSeason.lanes.mid.winRate!<without.lanes.mid.winRate!);
 const duplicate=ratePlayer({...p,seasons:[{...s,rankStats:{...s.rankStats,heroes:[...s.rankStats.heroes,...s.rankStats.heroes]}}]});assert.deepEqual(duplicate,withSeason);
 const withRoom=ratePlayer({...p,seasons:[s],matches:[{heroId:p.heroes[2].id,heroName:p.heroes[2].name,mode:'开房间',result:'win',kills:100,deaths:0,assists:100,score:16,playedAt:p.updatedAt}]});assert.deepEqual(withRoom,withSeason);
});
test('missing lane data is distinguished from a covered zero-game lane',()=>{
 const missing=ratePlayer({...profile(),heroes:[],coverage:{...profile().coverage,catalogMatched:false}});assert.equal(missing.lanes.roam.evidence,'unknown');
 const zero=ratePlayer(profile(LANES.map(l=>heroFor(l,0,0,0))));assert.equal(zero.lanes.roam.evidence,'limited');assert.ok(zero.lanes.roam.score<missing.lanes.roam.score);
});
test('one lucky game cannot outweigh reliable mastery; preference cannot invent skill',()=>{
 const lucky=ratePlayer(profile([heroFor('farm',1,1,0)])),reliable=ratePlayer(profile([heroFor('farm',200,120,3000)]));assert.ok(lucky.lanes.farm.winRate!<55);assert.ok(reliable.lanes.farm.score>lucky.lanes.farm.score);
 const p=profile(),a=ratePlayer(p),b=ratePlayer({...p,preferences:{preferredLanes:['roam'],avoidedLanes:[],laneAdjustments:{}}});assert.equal(a.lanes.roam.score,b.lanes.roam.score);assert.equal(b.lanes.roam.preference,1);
 assert.deepEqual(ratePlayer({...p,heroes:[...p.heroes,...p.heroes]}),a);
});
test('multi-lane heroes split exposure; obsolete peak evidence decays',()=>{
 const h={...heroFor('clash',200,120,3000),lanes:['clash','jungle']as Lane[]};const r=ratePlayer(profile([h]));assert.equal(r.lanes.clash.games,100);assert.equal(r.lanes.jungle.games,100);
 const p=profile(),fresh=season('50',2200,100),old={...fresh,endTime:'2020-01-01T00:00:00Z'};assert.ok(ratePlayer({...p,seasons:[fresh]}).overall>ratePlayer({...p,seasons:[old]}).overall);
 assert.ok(rankIndex('永恒钻石I',4)!>rankIndex('永恒钻石V',0)!);
});

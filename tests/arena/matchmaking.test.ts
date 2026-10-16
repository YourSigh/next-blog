import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoPlayers } from '../../src/lib/arena/demo.ts';
import { balancePlayers } from '../../src/lib/arena/matchmaking.ts';
import { LANES } from '../../src/lib/arena/types.ts';
const players=createDemoPlayers(),selectedIds=players.map(p=>p.id);
test('assigns ten distinct people and exactly one of every lane per team',()=>{const r=balancePlayers(players,{selectedIds,locks:[],seed:'test',variety:.7});for(const team of [r.teams.A,r.teams.B]){assert.equal(team.length,5);assert.deepEqual(new Set(team.map(s=>s.lane)),new Set(LANES));}assert.equal(new Set([...r.teams.A,...r.teams.B].map(s=>s.playerId)).size,10);assert.ok(r.alternatives>0);});
test('hard lane and team locks are always honored and contradictions rejected',()=>{const r=balancePlayers(players,{selectedIds,locks:[{playerId:selectedIds[0],lane:'jungle',team:'B'},{playerId:selectedIds[1],lane:'mid',team:'A'}],seed:'locked'});assert.ok(r.teams.B.some(s=>s.playerId===selectedIds[0]&&s.lane==='jungle'));assert.ok(r.teams.A.some(s=>s.playerId===selectedIds[1]&&s.lane==='mid'));assert.throws(()=>balancePlayers(players,{selectedIds,locks:[{playerId:selectedIds[0],lane:'mid',team:'A'},{playerId:selectedIds[1],lane:'mid',team:'A'}]}),/同一分路/);assert.throws(()=>balancePlayers(players,{selectedIds:[...selectedIds.slice(0,9),selectedIds[0]],locks:[]}),/重复/);});
test('seed reproduces results; fresh seeds vary only within bounded fairness range',()=>{const a=balancePlayers(players,{selectedIds,locks:[],seed:'same'}),b=balancePlayers(players,{selectedIds,locks:[],seed:'same'});assert.deepEqual(a,b);const best=balancePlayers(players,{selectedIds,locks:[],seed:'best',variety:0});const ids=new Set<string>();for(const seed of ['one','two','three']){const r=balancePlayers(players,{selectedIds,locks:[],seed,variety:1});ids.add(r.id);assert.ok(r.gap<=best.gap+2.01);assert.ok(r.objective<=best.objective+3.01);}assert.ok(ids.size>1);});

test('balanced specialist pairs receive their strong lanes using the v2 lane scores',()=>{
 const specialists=players.map((p,i)=>{const lane=LANES[i%5];return{...p,rank:'最强王者',stars:20,seasons:[],matches:[],heroes:[{id:`specialist-${lane}`,name:`专精${lane}`,lanes:[lane],games:400,wins:240,losses:160,winRate:60,power:5000,proficiency:8}],preferences:{preferredLanes:[lane],avoidedLanes:[],laneAdjustments:{}}};});
 const r=balancePlayers(specialists,{selectedIds:specialists.map(p=>p.id),locks:[],seed:'specialist-pairs',variety:0});
 for(const seat of [...r.teams.A,...r.teams.B])assert.equal(seat.lane,LANES[specialists.findIndex(p=>p.id===seat.playerId)%5]);
 assert.equal(r.gap,0);
});

test('daily history changes candidate sampling without relaxing the original fairness bounds', () => {
  const pool = createDemoPlayers();
  const options = { selectedIds: pool.map(p => p.id), locks: [], variety: .6, seed: 'daily-history' };
  const baseline = balancePlayers(pool, { ...options, variety: 0 });
  const result = balancePlayers(pool, { ...options, history: [baseline.teams, baseline.teams, baseline.teams] });
  assert.deepEqual(result, balancePlayers(pool, { ...options, history: [baseline.teams, baseline.teams, baseline.teams] }));
  assert.ok(result.gap <= baseline.gap + .5 + .6 * 1.5 + .02);
  assert.ok(result.objective <= baseline.objective + .5 + .6 * 2.5 + .002);
  const max = (r: ReturnType<typeof balancePlayers>) => Math.max(...Object.values(r.laneGaps));
  assert.ok(max(result) <= max(baseline) + 1 + .6 * 3 + .02);
});

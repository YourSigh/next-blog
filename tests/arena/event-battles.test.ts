import test from 'node:test';
import assert from 'node:assert/strict';
import { balancePlayers } from '../../src/lib/arena/matchmaking.ts';
import { fetchEventBattles, matchDetailToRound } from '../../src/lib/arena/camp/event-battles.mjs';
import { eventPlayers, battleFixture } from './event-fixtures.ts';
import type { EventRound } from '../../src/lib/arena/events-types.ts';
const pool = eventPlayers(10);
const r: EventRound = { id: 'fixture', number: 1, status: 'active', createdAt: '2026-10-16T08:00:00.000Z', allocation: balancePlayers(pool, { selectedIds: pool.map(p => p.id), locks: [], seed: 'fixture', variety: 0 }), players: pool, baselineMatchIds: ['already-imported-game'], check: null, attempts: [], result: null };
test('exact ten stable identities and teams verify a battle; reversed blue/red also works', () => {
  const f = battleFixture(r, pool), result = matchDetailToRound({ ...f, round: r }); assert.equal(result.status, 'verified'); assert.equal(result.result?.winner, 'A'); assert.equal(result.result?.players.length, 10); assert.ok(!JSON.stringify(result).includes('private-upstream-token')); assert.ok(!JSON.stringify(result).includes('roleId'));
  const swapped = structuredClone(f); [swapped.detail.data.blueRoles, swapped.detail.data.redRoles] = [swapped.detail.data.redRoles, swapped.detail.data.blueRoles]; assert.equal(matchDetailToRound({ ...swapped, round: r }).result?.winner, 'A');
});
test('same nickname is insufficient; incomplete, wrong team, old and reused battles are rejected', () => {
  const f = battleFixture(r, pool);
  const incomplete = structuredClone(f); incomplete.detail.data.redRoles.pop(); assert.equal(matchDetailToRound({ ...incomplete, round: r }).status, 'incomplete');
  const outsider = structuredClone(f); outsider.detail.data.redRoles[0].basicInfo.roleId = 'unknown-role'; assert.equal(matchDetailToRound({ ...outsider, round: r }).status, 'mismatch');
  const teams = structuredClone(f); [teams.detail.data.redRoles[0], teams.detail.data.blueRoles[0]] = [teams.detail.data.blueRoles[0], teams.detail.data.redRoles[0]]; assert.equal(matchDetailToRound({ ...teams, round: r }).status, 'mismatch');
  const old = structuredClone(f); old.row.dtEventTime = Date.parse(r.createdAt) / 1000 - 60; assert.equal(matchDetailToRound({ ...old, round: r }).status, 'incomplete');
  const imported = structuredClone(f); imported.row.gameSeq = 'already-imported-game'; assert.equal(matchDetailToRound({ ...imported, round: r }).status, 'incomplete');
  const missing = structuredClone(r); missing.players[0].roleKey = null; assert.equal(matchDetailToRound({ ...f, round: missing }).status, 'incomplete');
});
test('own-account lookup reads only candidate details and does not guess among multiple matched games', async () => {
  const f = battleFixture(r, pool), calls: string[] = [], auth = { userId: String(123450 + f.ownIndex) };
  const network = async (url: string, options: { body: string }) => {
    const p = new URL(url).pathname; calls.push(p); const b = JSON.parse(options.body);
    if (p === '/game/koh/profile') return { data: { targetRoleId: f.targetRoleId, roleList: [{ roleId: f.targetRoleId }] } };
    if (p === '/game/morebattlelist') return { data: { list: [f.row, { ...f.row, gameSeq: 'second-matching-game' }] } };
    assert.equal(p, '/game/battledetail'); assert.equal(b.targetRoleId, f.targetRoleId); return f.detail;
  };
  const found = await fetchEventBattles({ auth, request: network, provider: 'qq', reporterId: f.reporterId, round: r, now: f.now }); assert.equal(found.status, 'ambiguous'); assert.equal(found.candidates.length, 2); assert.equal(calls.filter(p => p === '/game/battledetail').length, 2);
  calls.length = 0; const wrong = await fetchEventBattles({ auth, request: network, provider: 'qq', reporterId: 'f'.repeat(24), round: r, now: f.now }); assert.equal(wrong.status, 'needs_login'); assert.deepEqual(calls, ['/game/koh/profile']);
});

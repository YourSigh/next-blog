import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEventStore, dailyStandings, eventDate, validEventDate } from '../../src/lib/arena/events.ts';
import { matchDetailToRound } from '../../src/lib/arena/camp/event-battles.mjs';
import { eventPlayers, battleFixture } from './event-fixtures.ts';
import type { VerifiedBattle } from '../../src/lib/arena/events-types.ts';

test('competition dates use Shanghai midnight and reject impossible calendar dates', () => {
  assert.equal(eventDate(new Date('2026-10-16T15:59:59Z')), '2026-10-16'); assert.equal(eventDate(new Date('2026-10-16T16:00:00Z')), '2026-10-17');
  for (const d of ['2026-02-30', '../2026-10-16', '2026-13-01', '']) assert.equal(validEventDate(d), false); assert.equal(validEventDate('2028-02-29'), true);
});
test('concurrent registrations across stores create exactly one immutable shared round', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arena-events-')), pool = eventPlayers(12), now = new Date('2026-10-16T08:00:00Z');
  const a = createEventStore(dir, () => now), b = createEventStore(dir, () => now);
  try {
    await Promise.all(pool.map((p, i) => (i % 2 ? a : b).register(p, 'play', pool)));
    const first = await a.read('2026-10-16'); assert.equal(first.entries.length, 12); assert.equal(first.rounds.length, 1); assert.equal(first.rounds[0].players.length, 10); assert.deepEqual(first, await b.read('2026-10-16'));
    const allocation = structuredClone(first.rounds[0].allocation), activePlayer = first.rounds[0].players[0];
    await a.register(pool.find(p => p.id === activePlayer.id)!, 'watch', pool);
    const changed = await b.read('2026-10-16'); assert.deepEqual(changed.rounds[0].allocation, allocation); assert.equal(changed.entries.find(e => e.player.id === activePlayer.id)?.mode, 'watch');
    await a.register(pool[11], 'play', pool); assert.equal((await a.read('2026-10-16')).entries.length, 12);
    assert.equal((await a.read('2026-10-17')).rounds.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('verified finish is idempotent, rotates substitutes and records reward-ready stats', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arena-events-')), pool = eventPlayers(12); let now = new Date('2026-10-16T08:00:00Z'); const store = createEventStore(dir, () => now);
  try {
    for (const p of pool) await store.register(p, 'play', pool);
    const first = (await store.read(eventDate(now))).rounds[0], bench = pool.filter(p => !first.players.some(x => x.id === p.id));
    const fixture = battleFixture(first, pool), matched = matchDetailToRound({ ...fixture, round: first }); assert.equal(matched.status, 'verified');
    const begun = await store.beginCheck('2026-10-16', first.id, fixture.reporterId); assert.ok(begun.result);
    await assert.rejects(store.beginCheck('2026-10-16', first.id, fixture.reporterId), /已有选手/);
    now = fixture.now; const check = { status: 'verified' as const, reporterId: fixture.reporterId, checkedAt: now.toISOString(), message: '核验通过' };
    const done = await store.finishCheck('2026-10-16', first.id, begun.result.checkId, check, matched.result as VerifiedBattle, pool);
    assert.equal(done.rounds.length, 2); assert.equal(done.rounds[0].status, 'completed'); assert.equal(done.rounds[1].status, 'active');
    for (const p of bench) assert.ok(done.rounds[1].players.some(x => x.id === p.id));
    const standings = dailyStandings(done); assert.equal(standings.length, 10); assert.equal(standings.reduce((n, s) => n + s.wins, 0), 5); assert.equal(standings.reduce((n, s) => n + s.losses, 0), 5); assert.equal(standings[0].averageScore, 8.2);
    await store.finishCheck('2026-10-16', first.id, begun.result.checkId, check, matched.result as VerifiedBattle, pool);
    assert.equal((await store.read('2026-10-16')).rounds.length, 2); assert.equal((await store.beginCheck('2026-10-16', first.id, fixture.reporterId)).result, null);
    const second = done.rounds[1], next = await store.beginCheck('2026-10-16', second.id, second.players[0].id);
    const reused = { ...matched.result, players: [...second.allocation.teams.A, ...second.allocation.teams.B].map(s => ({ ...matched.result!.players[0], playerId: s.playerId, lane: s.lane, team: second.allocation.teams.A.includes(s) ? 'A' as const : 'B' as const })) } as VerifiedBattle;
    await assert.rejects(store.finishCheck('2026-10-16', second.id, next.result!.checkId, check, reused, pool), /已经记录过/);
    assert.equal((await createEventStore(dir).read('2026-10-16')).rounds[0].result?.sourceKey, matched.result!.sourceKey);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('spectators do not fill seats; failed checks cannot advance a round; old days do not auto-start', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arena-events-')), pool = eventPlayers(11); let now = new Date('2026-10-16T08:00:00Z'); const store = createEventStore(dir, () => now);
  try {
    for (const p of pool.slice(0, 9)) await store.register(p, 'play', pool); await store.register(pool[9], 'watch', pool); assert.equal((await store.read('2026-10-16')).rounds.length, 0);
    await store.register(pool[9], 'play', pool); const r = (await store.read('2026-10-16')).rounds[0];
    await assert.rejects(store.beginCheck('2026-10-16', r.id, pool[10].id), /本场参赛选手/);
    const start = await store.beginCheck('2026-10-16', r.id, r.players[0].id);
    now = new Date(now.valueOf() + 10_000);
    await store.finishCheck('2026-10-16', r.id, start.result!.checkId, { status: 'needs_login', checkedAt: now.toISOString(), reporterId: r.players[0].id, message: '请重新扫码' }, null, pool);
    assert.equal((await store.read('2026-10-16')).rounds.length, 1); assert.equal(dailyStandings(await store.read('2026-10-16')).length, 0);
    now = new Date(now.valueOf() + 10_000); const retry = await store.beginCheck('2026-10-16', r.id, r.players[0].id);
    const fixture = battleFixture(r, pool), matched = matchDetailToRound({ ...fixture, round: r }); now = new Date('2026-10-17T08:00:00Z');
    await store.finishCheck('2026-10-16', r.id, retry.result!.checkId, { status: 'verified', checkedAt: now.toISOString(), reporterId: r.players[0].id, message: '通过' }, matched.result as VerifiedBattle, pool);
    assert.equal((await store.read('2026-10-16')).rounds.length, 1); assert.equal((await store.read('2026-10-17')).entries.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('ambiguous results require choosing a server-verified candidate and stale jobs cannot overwrite newer checks', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arena-events-')), pool = eventPlayers(10); let now = new Date('2026-10-16T08:00:00Z'); const store = createEventStore(dir, () => now);
  try {
    for (const p of pool) await store.register(p, 'play', pool); const r = (await store.read('2026-10-16')).rounds[0], id = r.players[0].id;
    const first = await store.beginCheck('2026-10-16', r.id, id); now = new Date(now.valueOf() + 121000); const retry = await store.beginCheck('2026-10-16', r.id, id);
    await store.finishCheck('2026-10-16', r.id, first.result!.checkId, { status: 'unavailable', reporterId: id, checkedAt: now.toISOString(), message: '过期任务' }, null, pool);
    assert.equal((await store.read('2026-10-16')).rounds[0].check?.id, retry.result!.checkId);
    const f = battleFixture(r, pool), a = matchDetailToRound({ ...f, round: r }).result as VerifiedBattle, b = matchDetailToRound({ ...battleFixture(r, pool, 'second'), round: r }).result as VerifiedBattle;
    await store.finishCheck('2026-10-16', r.id, retry.result!.checkId, { status: 'ambiguous', reporterId: id, checkedAt: now.toISOString(), message: '请选择' }, null, pool, [a, b]);
    assert.equal((await store.read('2026-10-16')).rounds.length, 1); await assert.rejects(store.confirmCandidate('2026-10-16', r.id, 'f'.repeat(64), id, pool), /已核验/);
    const done = await store.confirmCandidate('2026-10-16', r.id, b.sourceKey, id, pool); assert.equal(done.rounds[0].result?.gameId, 'second'); assert.equal(done.rounds.length, 2);
    const missing = structuredClone(done); for (const p of missing.rounds[0].result!.players) { p.kills = null; p.score = null; }
    const standing = dailyStandings(missing)[0]; assert.equal(standing.kills, null); assert.equal(standing.kdaGames, 0); assert.equal(standing.averageScore, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

import { createDemoPlayers } from '../../src/lib/arena/demo.ts';
import { gameRoleKey, playerIdFor } from '../../src/lib/arena/store.ts';
import type { EventRound } from '../../src/lib/arena/events-types.ts';
import type { Player } from '../../src/lib/arena/types.ts';
export function eventPlayers(count = 12): Player[] { const base = createDemoPlayers(); return Array.from({ length: count }, (_, i) => ({ ...structuredClone(base[i % 10]), id: playerIdFor(String(123450 + i), String(1000 + i), 'qq'), roleKey: gameRoleKey(String(1000 + i)), provider: 'qq', nickname: `选手 ${i + 1}`, sample: false, matches: [], importedAt: '2026-10-16T08:00:00.000Z', updatedAt: '2026-10-16T08:00:00.000Z' })); }
export function battleFixture(round: EventRound, pool: Player[], gameSeq = 'fresh-game') {
  const reporterId = round.players[0].id, ownIndex = pool.findIndex(p => p.id === reporterId), targetRoleId = String(1000 + ownIndex);
  const role = (id: string) => { const i = pool.findIndex(p => p.id === id); return { basicInfo: { roleId: String(1000 + i), roleName: '同名不作为依据' }, battleRecords: { heroId: '111', killCnt: 3, deadCnt: 2, assistCnt: 5 }, battleStats: { gradeGame: 8.2, money: 10000, totalHeroHurtCnt: 25000, totalBeheroHurtCnt: 15000, joinGamePercent: .6 } }; };
  const blueRoles = round.allocation.teams.A.map(s => role(s.playerId)), redRoles = round.allocation.teams.B.map(s => role(s.playerId));
  const ownSide = round.allocation.teams.A.some(s => s.playerId === reporterId) ? 'A' : 'B';
  const row = { gameSeq, gameSvrId: 'server-1', relaySvrId: 'relay-1', battleType: 1, dtEventTime: Math.floor(Date.parse(round.createdAt) / 1000) + 1200, gameresult: ownSide === 'A' ? 1 : 2, heroId: '111', usedTime: 1200 };
  return { detail: { returnCode: 0, data: { blueRoles, redRoles, token: 'private-upstream-token' } }, row, reporterId, targetRoleId, ownIndex, now: new Date(Date.parse(round.createdAt) + 1500_000) };
}

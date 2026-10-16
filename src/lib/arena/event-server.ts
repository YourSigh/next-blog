import type { NextRequest } from 'next/server';
import { arenaRuntime, ArenaError, getSession, network, participantIdentity } from './server';
import { createEventStore, dailyStandings, eventDate, EventError, validEventDate } from './events.ts';
import { gameRoleKey, playerIdFor } from './store.ts';
import { createCampTransport } from './camp/camp-transport.mjs';
import { fetchEventBattles, probeEventAccess } from './camp/event-battles.mjs';
import type { DailyEvent, CheckStatus, VerifiedBattle, EventMode } from './events-types.ts';
import type { Player } from './types.ts';

type EventRuntime = { store: ReturnType<typeof createEventStore>; jobs: Map<string, Promise<void>>; storeVersion?: number };
const globalRuntime = globalThis as typeof globalThis & { __arenaEvents?: EventRuntime };
export function eventRuntime() { const r = globalRuntime.__arenaEvents ||= { store: createEventStore(), jobs: new Map(), storeVersion: 2 }; if (r.storeVersion !== 2) { r.store = createEventStore(); r.storeVersion = 2; } return r; }
export function requestedDate(value: unknown) { const date = value || eventDate(); if (!validEventDate(date) || date > eventDate()) throw new ArenaError(400, '比赛日期无效。'); return date; }
function publicDay(day: DailyEvent): DailyEvent {
  const person = ({ roleKey, ...p }: DailyEvent['entries'][number]['player']) => p;
  return { ...day, entries: day.entries.map(e => ({ ...e, player: person(e.player) })), rounds: day.rounds.map(r => ({ ...r, players: r.players.map(person), baselineMatchIds: [] })) };
}
export async function eventView(request: NextRequest, date = eventDate()) {
  const event = await eventRuntime().store.read(date);
  return { event: publicDay(event), dates: await eventRuntime().store.dates(), today: eventDate(), identityPlayerId: await participantIdentity(request), campConnected: !!getSession(request)?.auth, standings: dailyStandings(event) };
}
export async function requireParticipant(request: NextRequest) { const id = await participantIdentity(request); if (!id) throw new ArenaError(401, '请先扫码连接本人账号，之后本机可记住报名身份。'); const player = await arenaRuntime().store.read(id); if (!player) throw new ArenaError(401, '本人档案已移除，请重新扫码同步。'); return player; }
async function ensureRoleIdentity(request: NextRequest, player: Player) {
  if (player.roleKey) return player;
  const s = getSession(request); if (!s?.auth || s.playerId !== player.id) throw new ArenaError(401, '旧档案缺少赛后核验所需的角色标识，请重新扫码补齐一次。');
  const epoch = s.epoch, auth = s.auth;
  const raw = await createCampTransport({ network, auth, observe: undefined })('https://kohcamp.qq.com/game/koh/profile', { method: 'POST', body: JSON.stringify({ targetUserId: auth.userId, targetRoleId: '0', resVersion: '3', recommendPrivacy: '0', apiVersion: '2' }), auth });
  const data = raw.data || raw, roles = Array.isArray(data.roleList) ? data.roleList : [], role = roles.find((r: { roleId: string }) => String(r.roleId) === String(auth.gameRoleId || data.targetRoleId)) || roles[0];
  const roleId = String(role?.roleId || '');
  if (s.epoch !== epoch || !roleId || playerIdFor(auth.userId, roleId, s.provider || player.provider) !== player.id) throw new ArenaError(401, '当前营地角色与报名身份不一致，请重新扫码。');
  return arenaRuntime().store.bindRoleIdentity(player.id, gameRoleKey(roleId));
}
export async function registerForToday(request: NextRequest, mode: EventMode | 'leave') {
  let player = await requireParticipant(request); if (mode !== 'leave') player = await ensureRoleIdentity(request, player);
  await eventRuntime().store.register(player, mode, await arenaRuntime().store.list()); return eventView(request);
}
const failure = (error: unknown): { status: CheckStatus; message: string } => {
  const e = error as { code?: string; status?: number };
  if (e?.status === 401 || ['auth', 'auth_required'].includes(e?.code || '')) return { status: 'needs_login', message: '营地授权已失效，请本场选手重新扫码连接本人账号后，再点核验。' };
  if (e?.code === 'rate_limit') return { status: 'rate_limit', message: '营地提示请求频繁，请稍后手动重试。' };
  if (e?.code === 'hidden') return { status: 'unavailable', message: '营地限制了战绩访问，请检查本人战绩隐私设置后重试。' };
  return { status: 'unavailable', message: error instanceof EventError ? error.message : '暂未取得足够的对局资料；可以稍后重试，或重新扫码后读取。' };
};
export async function startEventVerification(request: NextRequest, date: string, roundId: string) {
  const player = await requireParticipant(request), session = getSession(request);
  if (!session?.auth || session.playerId !== player.id) throw new ArenaError(401, '报名身份仍保留，但营地临时授权已失效。请重新扫码连接本人账号，再读取最近对局。');
  const { result: task } = await eventRuntime().store.beginCheck(date, roundId, player.id, await arenaRuntime().store.list());
  if (!task) return eventView(request, date);
  const epoch = session.epoch, auth = session.auth, provider = session.provider || player.provider, key = `${date}:${roundId}`;
  const job = (async () => {
    const transport = createCampTransport({ network, auth, battleDetails: true, observe: undefined });
    const requestOwn = async (url: string, options: Record<string, unknown>) => { if (session.epoch !== epoch || session.auth !== auth) throw new ArenaError(401, '会话已更新。'); return transport(url, options); };
    try {
      const found = await fetchEventBattles({ auth, request: requestOwn, provider, reporterId: player.id, round: task.round });
      if (session.epoch !== epoch || session.auth !== auth) throw new ArenaError(401, '会话已更新。');
      await eventRuntime().store.finishCheck(date, roundId, task.checkId, { status: found.status as CheckStatus, message: found.message, reporterId: player.id, checkedAt: new Date().toISOString() }, found.status === 'verified' ? found.candidates[0] as VerifiedBattle : null, await arenaRuntime().store.list(), found.candidates as VerifiedBattle[]);
    } catch (e) { const f = failure(e); await eventRuntime().store.finishCheck(date, roundId, task.checkId, { ...f, reporterId: player.id, checkedAt: new Date().toISOString() }, null, []); }
  })().catch(() => { console.error('[arena events] Could not persist verification status.'); }).finally(() => eventRuntime().jobs.delete(key));
  eventRuntime().jobs.set(key, job);
  return eventView(request, date);
}
export async function confirmEventCandidate(request: NextRequest, date: string, roundId: string, sourceKey: string) {
  const player = await requireParticipant(request); await eventRuntime().store.confirmCandidate(date, roundId, sourceKey, player.id, await arenaRuntime().store.list()); return eventView(request, date);
}
export async function checkEventConnection(request: NextRequest) {
  const player = await requireParticipant(request), s = getSession(request);
  if (!s?.auth || s.playerId !== player.id) throw new ArenaError(401, '请重新扫码连接本人营地账号后检查。');
  if (Date.now() - (s.lastEventProbe || 0) < 30_000) throw new ArenaError(429, '请稍候再检查战绩连接。');
  s.lastEventProbe = Date.now(); const epoch = s.epoch, auth = s.auth, transport = createCampTransport({ network, auth, battleDetails: true, observe: undefined });
  try { return await probeEventAccess({ auth, request: async (url: string, options: Record<string, unknown>) => { if (s.epoch !== epoch || s.auth !== auth) throw new ArenaError(401, '登录已更新。'); return transport(url, options); }, provider: s.provider || player.provider, reporterId: player.id }); }
  catch (e) { const f = failure(e); throw new ArenaError(f.status === 'needs_login' ? 401 : f.status === 'rate_limit' ? 429 : 502, f.message); }
}

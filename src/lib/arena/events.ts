import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { balancePlayers } from './matchmaking.ts';
import { arenaDataDirectory } from './store.ts';
import type { Player } from './types.ts';
import type { DailyEvent, DailyStanding, EventCheck, EventMode, EventPlayer, EventRound, VerifiedBattle } from './events-types.ts';

export class EventError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
export function eventDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
export function validEventDate(value: unknown): value is string { if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false; const d = new Date(value + 'T00:00:00Z'); return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === value; }
const snapshot = (p: Player): EventPlayer => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, provider: p.provider, area: p.area, rank: p.rank, stars: p.stars, roleKey: p.roleKey || null });
const emptyDay = (date: string, now: Date): DailyEvent => ({ version: 1, date, timezone: 'Asia/Shanghai', revision: 0, updatedAt: now.toISOString(), entries: [], rounds: [] });
export function dailyStandings(day: DailyEvent): DailyStanding[] {
  const rows = new Map<string, DailyStanding & { scoreTotal: number }>();
  for (const r of day.rounds) if (r.status === 'completed' && r.result) for (const p of r.result.players) {
    const s = rows.get(p.playerId) || { playerId: p.playerId, nickname: r.players.find(x => x.id === p.playerId)?.nickname || '未命名选手', played: 0, wins: 0, losses: 0, kills: null, deaths: null, assists: null, kdaGames: 0, scoredGames: 0, averageScore: null, scoreTotal: 0 };
    s.played++; if (p.team === r.result.winner) s.wins++; else s.losses++;
    if (p.kills !== null && p.deaths !== null && p.assists !== null) { s.kills = (s.kills ?? 0) + p.kills; s.deaths = (s.deaths ?? 0) + p.deaths; s.assists = (s.assists ?? 0) + p.assists; s.kdaGames++; }
    if (p.score !== null) { s.scoredGames++; s.scoreTotal += p.score; }
    rows.set(p.playerId, s);
  }
  return [...rows.values()].map(({ scoreTotal, ...s }) => ({ ...s, averageScore: s.scoredGames ? Number((scoreTotal / s.scoredGames).toFixed(2)) : null })).sort((a, b) => b.wins - a.wins || b.played - a.played || a.playerId.localeCompare(b.playerId));
}
export function waitingOrder(day: DailyEvent, pool: Player[]) {
  const available = new Set(pool.filter(p => !p.sample).map(p => p.id));
  const played = (id: string) => day.rounds.filter(r => r.players.some(p => p.id === id)).length;
  const last = (id: string) => Math.max(0, ...day.rounds.filter(r => r.players.some(p => p.id === id)).map(r => r.number));
  return day.entries.filter(e => e.mode === 'play' && available.has(e.player.id)).sort((a, b) => played(a.player.id) - played(b.player.id) || last(a.player.id) - last(b.player.id) || a.joinedAt.localeCompare(b.joinedAt) || a.player.id.localeCompare(b.player.id));
}
function generateRound(day: DailyEvent, pool: Player[], now: Date) {
  if (day.date !== eventDate(now) || day.rounds.some(r => r.status === 'active')) return;
  const selected = waitingOrder(day, pool).slice(0, 10);
  if (selected.length < 10) return;
  const id = randomUUID(), selectedIds = selected.map(e => e.player.id);
  const allocation = balancePlayers(pool, { selectedIds, locks: [], seed: `daily:${day.date}:${id}`, variety: .65, history: day.rounds.slice(-3).map(r => r.allocation.teams) });
  const players = selectedIds.map(id => snapshot(pool.find(p => p.id === id)!));
  day.rounds.push({ id, number: day.rounds.length + 1, status: 'active', createdAt: now.toISOString(), allocation, players, baselineMatchIds: [...new Set(pool.filter(p => selectedIds.includes(p.id)).flatMap(p => p.matches.map(m => m.id).filter((id): id is string => !!id)))], check: null, attempts: [], result: null });
}

/** File lock + atomic rename: different HTTP requests/processes cannot create two round ones. */
export function createEventStore(directory = path.join(arenaDataDirectory(), '.events'), clock = () => new Date()) {
  const target = (date: string) => { if (!validEventDate(date)) throw new EventError(400, '比赛日期无效。'); return path.join(directory, date + '.json'); };
  const read = async (date: string): Promise<DailyEvent> => { try { const raw = await readFile(target(date), 'utf8'); if (Buffer.byteLength(raw) > 16 * 1024 * 1024) throw Error('event too large'); const d = JSON.parse(raw); if (d.version !== 1 || d.date !== date || !Array.isArray(d.entries) || !Array.isArray(d.rounds)) throw Error('invalid event'); return d; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyDay(date, clock()); throw e; } };
  const mutate = async <T>(date: string, operation: (day: DailyEvent, now: Date) => Promise<T> | T) => {
    const file = target(date), lock = file + '.lock'; await mkdir(directory, { recursive: true, mode: 0o700 });
    const deadline = Date.now() + 10_000;
    for (;;) { try { await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; try { if (Date.now() - (await stat(lock)).mtimeMs > 120_000) { await unlink(lock); continue; } } catch {} if (Date.now() > deadline) throw new EventError(409, '报名正在更新，请稍后重试。'); await new Promise(resolve => setTimeout(resolve, 20)); } }
    try { const day = await read(date), now = clock(); const result = await operation(day, now); day.revision++; day.updatedAt = now.toISOString(); const temp = file + '.' + randomUUID() + '.tmp'; try { await writeFile(temp, JSON.stringify(day), { mode: 0o600 }); await rename(temp, file); } finally { await unlink(temp).catch(() => {}); } return { day, result }; } finally { await unlink(lock).catch(() => {}); }
  };
  const complete = async (date: string, day: DailyEvent, r: EventRound, result: VerifiedBattle, pool: Player[], now: Date) => {
    const ids = r.players.map(p => p.id);
    if (!/^[a-f0-9]{64}$/.test(result.sourceKey) || result.players.length !== 10 || new Set(result.players.map(p => p.playerId)).size !== 10 || result.players.some(p => !ids.includes(p.playerId)) || !['A', 'B'].includes(result.winner)) throw new EventError(400, '比赛核验结果不完整。');
    const receipts = path.join(directory, 'verified'); await mkdir(receipts, { recursive: true, mode: 0o700 });
    const receipt = path.join(receipts, result.sourceKey + '.json');
    try { await writeFile(receipt, JSON.stringify({ date, roundId: r.id }), { flag: 'wx', mode: 0o600 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; const used = JSON.parse(await readFile(receipt, 'utf8')); if (used.date !== date || used.roundId !== r.id) throw new EventError(409, '这条营地对局已经记录过，不能重复记为新的一场。'); }
    r.status = 'completed'; r.completedAt = now.toISOString(); r.result = result; r.candidates = [];
    generateRound(day, pool, now);
  };
  return {
    read,
    async dates() { try { return (await readdir(directory)).filter(n => /^20\d{2}-\d{2}-\d{2}\.json$/.test(n)).map(n => n.slice(0, 10)).sort().reverse().slice(0, 90); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; } },
    async register(player: Player, mode: EventMode | 'leave', pool: Player[]) {
      if (player.sample || !/^[a-f0-9]{24}$/.test(player.id)) throw new EventError(400, '只能用本人真实游戏档案报名。');
      if (!['play', 'watch', 'leave'].includes(mode)) throw new EventError(400, '报名席位无效。');
      const date = eventDate(clock());
      return (await mutate(date, (day, now) => {
        if (day.date !== eventDate(now)) throw new EventError(409, '日期已变化，请刷新后报名今天的比赛。');
        const prior = day.entries.find(e => e.player.id === player.id);
        if (!prior && day.entries.length >= 200) throw new EventError(409, '今日报名人数已达上限。');
        if (mode === 'leave') day.entries = day.entries.filter(e => e.player.id !== player.id);
        else if (prior) { prior.mode = mode; prior.player = snapshot(player); prior.updatedAt = now.toISOString(); }
        else day.entries.push({ player: snapshot(player), mode, joinedAt: now.toISOString(), updatedAt: now.toISOString() });
        generateRound(day, pool, now);
      })).day;
    },
    async beginCheck(date: string, roundId: string, reporterId: string, pool: Player[] = []) {
      return mutate(date, (day, now) => {
        const r = day.rounds.find(r => r.id === roundId); if (!r) throw new EventError(404, '这场比赛不存在。');
        if (!r.players.some(p => p.id === reporterId)) throw new EventError(403, '请由本场参赛选手读取自己的战绩并核验。');
        if (r.status === 'completed') return null;
        for (const p of r.players) if (!p.roleKey) p.roleKey = pool.find(player => player.id === p.id)?.roleKey || null;
        if (r.check?.status === 'checking' && now.valueOf() - Date.parse(r.check.checkedAt) < 120_000) throw new EventError(409, '已有选手正在核验，所有人将看到同一份结果。');
        if (r.check && now.valueOf() - Date.parse(r.check.checkedAt) < 8_000) throw new EventError(429, '请稍候再核验，营地战绩可能尚未更新。');
        const check: EventCheck = { id: randomUUID(), status: 'checking', reporterId, checkedAt: now.toISOString(), message: '正在读取本人最近对局并核对十人名单…' };
        r.check = check; return { round: structuredClone(r), checkId: check.id };
      });
    },
    async finishCheck(date: string, roundId: string, checkId: string, check: Omit<EventCheck, 'id'>, result: VerifiedBattle | null, pool: Player[], candidates: VerifiedBattle[] = []) {
      return (await mutate(date, async (day, now) => {
        const r = day.rounds.find(r => r.id === roundId); if (!r || r.status === 'completed' || r.check?.id !== checkId) return;
        if (result) await complete(date, day, r, result, pool, now);
        else r.candidates = check.status === 'ambiguous' ? candidates.slice(0, 3) : [];
        r.check = { ...check, id: checkId }; r.attempts.push(r.check); r.attempts = r.attempts.slice(-30);
      })).day;
    },
    async confirmCandidate(date: string, roundId: string, sourceKey: string, reporterId: string, pool: Player[]) {
      return (await mutate(date, async (day, now) => {
        const r = day.rounds.find(r => r.id === roundId); if (!r) throw new EventError(404, '这场比赛不存在。');
        if (!r.players.some(p => p.id === reporterId)) throw new EventError(403, '只有本场选手能确认对局记录。');
        if (r.status === 'completed') return;
        const result = r.check?.status === 'ambiguous' && r.candidates?.find(c => c.sourceKey === sourceKey);
        if (!result) throw new EventError(409, '请从服务器已核验的候选对局中选择。');
        await complete(date, day, r, result, pool, now);
        r.check = { id: randomUUID(), status: 'verified', checkedAt: now.toISOString(), reporterId, message: '已确认核验通过的对局，结果已记录。' }; r.attempts.push(r.check); r.attempts = r.attempts.slice(-30);
      })).day;
    },
  };
}

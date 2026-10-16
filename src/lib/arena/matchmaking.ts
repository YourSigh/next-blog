import { LANES, LANE_LABELS, type BalanceOptions, type BalancedMatch, type Lane, type LaneLock, type Player, type PlayerRating, type TeamSeat } from './types.ts';
import { isLane } from './hero-lanes.ts';
import { ratePlayer, RATING_VERSION } from './rating.ts';

export const MATCHMAKING_VERSION = 'arena-bounded-exhaustive-v1';
const round = (n: number, places = 2) => Number(n.toFixed(places));

export class MatchmakingError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'MatchmakingError'; this.code = code; }
}
function reject(code: string, message: string): never { throw new MatchmakingError(code, message); }
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
function randomFor(seed: string): () => number {
  let state = hash(seed);
  return () => {
    state = state + 0x6d2b79f5 | 0;
    let x = Math.imul(state ^ state >>> 15, 1 | state);
    x ^= x + Math.imul(x ^ x >>> 7, 61 | x);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

type Assignment = { indices: number[]; scores: number[]; total: number; confidence: number; fitCost: number };
type Division = { A: Assignment[]; B: Assignment[] };
type Pair = { A: Assignment; B: Assignment; objective: number; gap: number; meanLaneGap: number; maxLaneGap: number };

function assignments(indices: number[], ratings: PlayerRating[], locks: Map<string, LaneLock>, players: Player[]): Assignment[] {
  const result: Assignment[] = [];
  const seats: number[] = [];
  function place(position: number, used: number) {
    if (position === 5) {
      const scores = seats.map((index, lane) => ratings[index].lanes[LANES[lane]].score);
      result.push({ indices: seats.slice(), scores, total: scores.reduce((sum, n) => sum + n, 0),
        confidence: seats.reduce((sum, index, lane) => sum + ratings[index].lanes[LANES[lane]].confidence, 0) / 5,
        fitCost: seats.reduce((sum, index, lane) => sum + 1 - ratings[index].lanes[LANES[lane]].preference, 0) });
      return;
    }
    for (let slot = 0; slot < indices.length; slot++) {
      if (used & 1 << slot) continue;
      const index = indices[slot];
      const laneLock = locks.get(players[index].id)?.lane;
      if (laneLock && laneLock !== LANES[position]) continue;
      seats[position] = index;
      place(position + 1, used | 1 << slot);
    }
  }
  place(0, 0);
  return result;
}

function components(A: Assignment, B: Assignment): Pair {
  const gap = Math.abs(A.total - B.total) / 5;
  let sum = 0, max = 0;
  for (let lane = 0; lane < 5; lane++) {
    const d = Math.abs(A.scores[lane] - B.scores[lane]);
    sum += d; if (d > max) max = d;
  }
  const meanLaneGap = sum / 5;
  const objective = gap * 3 + meanLaneGap * 0.9 + max * 0.35
    + (A.fitCost + B.fitCost) / 10 * 6 + Math.abs(A.confidence - B.confidence) * 2;
  return { A, B, objective, gap, meanLaneGap, maxLaneGap: max };
}

export function balancePlayers(pool: Player[], options: BalanceOptions): BalancedMatch {
  if (!options || !Array.isArray(options.selectedIds) || options.selectedIds.length !== 10) reject('player_count', '必须恰好选择10名不同选手。');
  const selected = options.selectedIds;
  if (new Set(selected).size !== 10) reject('duplicate_player', '所选名单包含重复选手。');
  const available = new Map<string, Player>();
  for (const player of pool) {
    if (!player || typeof player.id !== 'string' || !player.id) reject('invalid_player', '选手ID无效。');
    if (available.has(player.id)) reject('duplicate_player', '选手池中存在重复ID，无法确认10名不同的人。');
    available.set(player.id, player);
  }
  const players = selected.map(id => available.get(id) ?? reject('missing_player', '所选选手已不存在，请刷新名单。')).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const sampleCount = players.filter(player => player.sample === true).length;
  if (sampleCount > 0 && sampleCount !== 10) reject('mixed_sample', '演示选手与真实选手不能混合分队。');
  if (!Array.isArray(options.locks)) reject('invalid_locks', '锁定条件必须为数组。');
  const selectedSet = new Set(selected);
  const locks = new Map<string, LaneLock>();
  const teamCounts = { A: 0, B: 0 };
  const laneCounts = new Map<Lane, number>();
  const teamLane = new Set<string>();
  for (const lock of options.locks) {
    if (!lock || !selectedSet.has(lock.playerId)) reject('lock_player', '锁定条件引用了未选择的选手。');
    if (locks.has(lock.playerId)) reject('duplicate_lock', '同一选手只能有一条锁定条件；请将队伍和分路写在一起。');
    if (lock.lane !== undefined && !isLane(lock.lane)) reject('invalid_lane', '锁定条件包含未知分路。');
    if (lock.team !== undefined && lock.team !== 'A' && lock.team !== 'B') reject('invalid_team', '锁定条件包含未知队伍。');
    if (!lock.team && !lock.lane) reject('empty_lock', '锁定条件必须指定分路或队伍。');
    locks.set(lock.playerId, lock);
    if (lock.team && ++teamCounts[lock.team] > 5) reject('overconstrained', `${lock.team}队锁定超过5人。`);
    if (lock.lane) {
      const n = (laneCounts.get(lock.lane) ?? 0) + 1;
      laneCounts.set(lock.lane, n);
      if (n > 2) reject('overconstrained', `${LANE_LABELS[lock.lane]}锁定超过两个席位。`);
      if (lock.team) {
        const key = `${lock.team}:${lock.lane}`;
        if (teamLane.has(key)) reject('overconstrained', `${lock.team}队有两人锁定同一分路。`);
        teamLane.add(key);
      }
    }
  }
  const ratings = players.map(ratePlayer);
  const divisions: Division[] = [];
  const hasTeamLocks = teamCounts.A + teamCounts.B > 0;
  // There are only C(10,5)=252 team partitions and at most120 lane assignments
  // per side. With no team locks, fix player0 in A to remove label-only mirrors.
  for (let mask = 0; mask < 1024; mask++) {
    if (!hasTeamLocks && !(mask & 1)) continue;
    const A: number[] = [], B: number[] = [];
    let allowed = true;
    for (let index = 0; index < 10; index++) {
      const side = mask & 1 << index ? 'A' : 'B';
      if (locks.get(players[index].id)?.team && locks.get(players[index].id)?.team !== side) { allowed = false; break; }
      (side === 'A' ? A : B).push(index);
    }
    if (!allowed || A.length !== 5 || B.length !== 5) continue;
    const a = assignments(A, ratings, locks, players);
    const b = assignments(B, ratings, locks, players);
    if (a.length && b.length) divisions.push({ A: a, B: b });
  }
  if (!divisions.length) reject('infeasible', '锁队和锁位条件组合无解，无法让每队五路各有一人。');
  let best: Pair | null = null;
  let examined = 0;
  // Streaming: no candidate matrix is stored and work is bounded by 3,628,800
  // pairs/pass even if a caller supplies many players in the unselected pool.
  for (const division of divisions) for (const A of division.A) for (const B of division.B) {
    examined++;
    const pair = components(A, B);
    if (best === null || pair.objective < best.objective - 1e-9) best = pair;
  }
  const reference = best!;
  if (options.seed !== undefined && typeof options.seed !== 'string') reject('invalid_seed', 'seed必须是字符串。');
  const seed = options.seed?.slice(0, 256) || globalThis.crypto.randomUUID();
  const variety = typeof options.variety === 'number' && Number.isFinite(options.variety) ? Math.min(1, Math.max(0, options.variety)) : 0.7;
  const rng = randomFor(seed);
  let chosen = reference, eligible = 1;
  const slack = 0.5 + variety * 2.5;
  if (variety > 0) {
    eligible = 0;
    // Uniform streaming reservoir across ALL candidates meeting all four near-
    // fairness limits. Randomness cannot bypass any hard constraint or limit.
    for (const division of divisions) for (const A of division.A) for (const B of division.B) {
      const gap = Math.abs(A.total - B.total) / 5;
      if (gap > reference.gap + 0.5 + variety * 1.5 + 1e-9) continue;
      const pair = components(A, B);
      if (pair.objective > reference.objective + slack + 1e-9
        || pair.maxLaneGap > reference.maxLaneGap + 1 + variety * 3 + 1e-9
        || pair.meanLaneGap > reference.meanLaneGap + 0.5 + variety * 1.5 + 1e-9) continue;
      eligible++;
      if (rng() < 1 / eligible) chosen = pair;
    }
  }
  const toSeats = (assignment: Assignment): TeamSeat[] => assignment.indices.map((index, lane) => ({
    playerId: players[index].id, lane: LANES[lane], score: assignment.scores[lane],
    confidence: ratings[index].lanes[LANES[lane]].confidence,
    preferred: ratings[index].lanes[LANES[lane]].preference >= 0.6,
  }));
  const teams = { A: toSeats(chosen.A), B: toSeats(chosen.B) };
  const laneGaps = Object.fromEntries(LANES.map((lane, i) => [lane, round(Math.abs(chosen.A.scores[i] - chosen.B.scores[i]))])) as Record<Lane, number>;
  const fitted = [...teams.A, ...teams.B].filter(seat => seat.preferred).length;
  const lowConfidence = [...teams.A, ...teams.B].filter(seat => seat.confidence < 0.45).length;
  const reasons = [
    '每队5人且五路各一人，所有硬锁队/锁位条件均已满足。',
    `枚举${examined}个合法组合；按团队均值差、分路对位差、偏好和可信度差共同评分。`,
    variety > 0 ? `在${eligible}个满足公平阈值的近平衡候选中按seed选择；阈值相对最优解：均值差额外≤${round(0.5 + variety * 1.5)}、最大对位差额外≤${round(1 + variety * 3)}。` : '多样性为0，使用确定性的最低目标值组合。',
    `团队均值差${round(chosen.gap)}；最大分路差${round(chosen.maxLaneGap)}；${fitted}/10个席位符合手动或使用偏好。`,
    `${lowConfidence}名选手的分路可信度偏低；相对指数不等于官方MMR，也不是胜率预测。`,
  ];
  if (locks.size && (chosen.gap > 5 || chosen.maxLaneGap > 15)) reasons.push('硬锁定限制了公平性；本次按约束给出最佳范围内方案，建议放宽锁定。');
  if (sampleCount) reasons.unshift('全部10名均为虚构演示选手。');
  return {
    id: `arena-${hash(`${seed}|${teams.A.map(seat => `${seat.playerId}:${seat.lane}`).join(',')}|${teams.B.map(seat => `${seat.playerId}:${seat.lane}`).join(',')}`).toString(16).padStart(8, '0')}`,
    seed, teams, totals: { A: round(chosen.A.total), B: round(chosen.B.total) },
    gap: round(chosen.gap), laneGaps, objective: round(chosen.objective, 3), alternatives: Math.max(0, eligible - 1),
    reasons, algorithmVersion: `${MATCHMAKING_VERSION}/${RATING_VERSION}`,
  };
}

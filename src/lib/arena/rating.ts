import { LANES, LANE_LABELS, type HeroStat, type Lane, type LaneRating, type Player, type PlayerRating, type SeasonStat } from './types.ts';
import { HERO_LANE_VERSION, isLane, resolveHeroLanes } from './hero-lanes.ts';

export const RATING_VERSION = 'arena-explainable-v1';
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const round = (n: number, places = 2) => Number(n.toFixed(places));
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const validCount = (n: unknown): n is number => finite(n) && Number.isSafeInteger(n) && n >= 0;
const stamp = (s: unknown) => typeof s === 'string' && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null;
const day = 86400000;

/** Local 0–100 relative index, NOT official MMR, probability or a prediction. */
export function rankIndex(rank: string | null, stars: number | null): number | null {
  if (typeof rank !== 'string') return null;
  const text = rank.trim();
  if (/王者/.test(text)) {
    const inName = text.match(/(\d+)\s*星/);
    const titleFloor = /传奇|百星/.test(text) ? 100 : /荣耀/.test(text) ? 50 : /无双/.test(text) ? 25 : 0;
    const star = finite(stars) && stars >= 0 ? stars : inName ? Number(inName[1]) : titleFloor;
    return round(62 + clamp(star, 0, 150) * 0.2);
  }
  for (const [name, score] of [['青铜', 16], ['白银', 23], ['黄金', 31], ['铂金', 39], ['钻石', 47], ['星耀', 55]] as const) {
    if (text.includes(name)) return score;
  }
  return null;
}

type HeroEvidence = { games: number; effectiveGames: number; effectiveWins: number; confidence: number; approximate: boolean };
function heroEvidence(hero: HeroStat): HeroEvidence | null {
  let games = validCount(hero.games) ? hero.games : null;
  if (games === null && validCount(hero.wins) && validCount(hero.losses)) games = hero.wins + hero.losses;
  if (games === null || games <= 0) return null;
  let rate: number;
  let approximate = false;
  if (validCount(hero.wins) && hero.wins <= games) rate = hero.wins / games;
  else if (finite(hero.winRate) && hero.winRate >= 0 && hero.winRate <= 100) { rate = hero.winRate / 100; approximate = true; }
  else return null;
  const quality = approximate ? 0.7 : 1;
  const effectiveGames = Math.min(games, 120) * quality;
  return { games, effectiveGames, effectiveWins: effectiveGames * rate,
    confidence: quality * effectiveGames / (effectiveGames + 24), approximate };
}

function history(player: Player): { score: number | null; count: number; ageWeight: number } {
  const reference = stamp(player.updatedAt);
  const rows = (Array.isArray(player.seasons) ? player.seasons : []).map((season, index) => ({
    season, index, score: rankIndex(season.rank, season.stars),
    time: stamp(season.endTime) ?? stamp(season.startTime),
    sequence: Number((season.id ?? season.name ?? '').match(/\d+/)?.[0] ?? 0),
  })).filter(row => row.score !== null);
  rows.sort((a, b) => a.time !== null && b.time !== null ? b.time - a.time : a.sequence !== b.sequence ? b.sequence - a.sequence : a.index - b.index);
  let total = 0, weight = 0, freshness = 0;
  for (const [index, row] of rows.slice(0, 3).entries()) {
    const age = reference !== null && row.time !== null ? Math.max(0, (reference - row.time) / day) : null;
    const quality = age === null ? 0.6 : Math.exp(-age / 365);
    const w = (1 / (index + 1)) * quality;
    total += row.score! * w; weight += w; freshness += quality;
  }
  return { score: weight > 0 ? total / weight : null, count: Math.min(rows.length, 3), ageWeight: rows.length ? freshness / Math.min(rows.length, 3) : 0 };
}

function recentRanked(player: Player): { games: number; delta: number; ignored: number } {
  const reference = stamp(player.updatedAt);
  if (reference === null) return { games: 0, delta: 0, ignored: player.matches?.length ?? 0 };
  const seen = new Set<string>();
  const rows = (Array.isArray(player.matches) ? player.matches : []).filter(match => {
    const mode = String(match.mode ?? '').toLowerCase();
    // Do not convert room, normal matchmaking, peak or unknown games into rank form.
    if (/开房|自定义|人机|custom|room|娱乐|匹配|巅峰|peak/.test(mode) || !/排位|ranked/.test(mode)) return false;
    const time = stamp(match.playedAt);
    if (time === null || reference - time < 0 || reference - time > 30 * day) return false;
    if (!['win', 'loss', 'lose', '胜利', '失败'].includes(String(match.result))) return false;
    if (match.id) { if (seen.has(match.id)) return false; seen.add(match.id); }
    return true;
  }).sort((a, b) => (stamp(b.playedAt) ?? 0) - (stamp(a.playedAt) ?? 0)).slice(0, 20);
  const wins = rows.filter(match => ['win', '胜利'].includes(String(match.result))).length;
  const posterior = (wins + 10) / (rows.length + 20);
  return { games: rows.length, delta: rows.length >= 3 ? clamp((posterior - 0.5) * 6, -2, 2) : 0,
    ignored: (player.matches?.length ?? 0) - rows.length };
}

export function ratePlayer(player: Player): PlayerRating {
  const current = rankIndex(player.rank, player.stars);
  const past = history(player);
  const recent = recentRanked(player);
  let baseline = current ?? past.score ?? 50;
  if (current !== null && past.score !== null) {
    const weight = 0.2 * past.ageWeight;
    baseline = current * (1 - weight) + past.score * weight;
  }
  const baseConfidence = current !== null ? 0.65 : past.score !== null ? 0.42 * past.ageWeight : 0.15;
  const buckets: Record<Lane, { n: number; wins: number; games: number; familiarity: number; approximate: number }> = Object.fromEntries(
    LANES.map(lane => [lane, { n: 0, wins: 0, games: 0, familiarity: 0, approximate: 0 }]),
  ) as Record<Lane, { n: number; wins: number; games: number; familiarity: number; approximate: number }>;
  let knownHeroGames = 0, mapped = 0;
  // Duplicated hero records are not independent evidence. Keep the first ID/name.
  const seen = new Set<string>();
  for (const hero of Array.isArray(player.heroes) ? player.heroes : []) {
    const key = hero.id ? `id:${hero.id}` : `name:${hero.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mapping = resolveHeroLanes(hero);
    if (!mapping.lanes.length) continue;
    mapped++;
    if (validCount(hero.games)) {
      const usage = Math.min(hero.games, 200);
      knownHeroGames += usage;
      for (const lane of mapping.lanes) buckets[lane].familiarity += usage / mapping.lanes.length;
    }
    const evidence = heroEvidence(hero);
    if (!evidence) continue;
    for (const lane of mapping.lanes) {
      const split = mapping.confidence / mapping.lanes.length;
      buckets[lane].n += evidence.effectiveGames * split;
      buckets[lane].wins += evidence.effectiveWins * split;
      buckets[lane].games += evidence.games / mapping.lanes.length;
      if (evidence.approximate) buckets[lane].approximate++;
    }
  }
  const preferred = new Set((player.preferences?.preferredLanes ?? []).filter(isLane));
  const avoided = new Set((player.preferences?.avoidedLanes ?? []).filter(isLane));
  const reasons = [
    current === null ? past.score === null ? '缺少可识别段位：以中性50为先验，可信度低。' : '当前段位缺失：使用近三段历史段位并按年代降低可信度。' : `当前段位映射为相对指数 ${current}，不是官方MMR。`,
    past.count ? `参考最近 ${past.count} 个可识别历史赛季；不使用历史最高段位抬高当前水平。` : '没有可用历史段位，未补造赛季数据。',
    `近期仅参考30天内最多20场明确排位：${recent.games}场，修正${recent.delta >= 0 ? '+' : ''}${round(recent.delta)}；其余${recent.ignored}场未纳入。`,
    '英雄累计统计的模式/赛季范围不明，仅作受限分路适配线索，不当作排位战绩；战力和KDA不直接换算MMR。',
    `分路映射 ${HERO_LANE_VERSION}：${mapped}个英雄可映射，多分路英雄按比例分摊。`,
  ];
  if (player.sample) reasons.unshift('虚构演示选手，不代表真实账号。');
  const lanes = Object.fromEntries(LANES.map(lane => {
    const bucket = buckets[lane];
    const posterior = (bucket.wins + 12) / (bucket.n + 24);
    // Unknown hero-stat modes warrant a small transfer effect, even at high n.
    const heroDelta = clamp((posterior - 0.5) * 14, -6, 6);
    const share = knownHeroGames > 0 ? bucket.familiarity / knownHeroGames : null;
    let preference = share === null ? 0.5 : clamp(0.25 + 0.75 * share, 0.25, 1);
    if (preferred.has(lane)) preference = 1;
    if (avoided.has(lane)) preference = 0.05;
    const manualValue = player.preferences?.laneAdjustments?.[lane];
    const manual = finite(manualValue) ? clamp(manualValue, -15, 15) : 0;
    const laneReasons = [
      bucket.n ? `${LANE_LABELS[lane]}映射英雄约${Math.round(bucket.games)}场；Beta(12,12)收缩后胜率${round(posterior * 100, 1)}%。` : `${LANE_LABELS[lane]}无可用英雄胜率样本，保留中性先验。`,
      '映射场次是按英雄兼任位置分摊的估计，不是官方分路统计。',
    ];
    if (bucket.approximate) laneReasons.push('部分胜场仅来自已四舍五入的展示胜率，有效样本降低30%。');
    if (preferred.has(lane)) laneReasons.push('手动标记为偏好分路。');
    if (avoided.has(lane)) laneReasons.push('手动标记为避免分路，优先降低适配度。');
    if (manual) laneReasons.push(`手动相对校正${manual > 0 ? '+' : ''}${manual}，不是已观测比赛实力。`);
    const laneRating: LaneRating = {
      score: round(clamp(baseline + recent.delta + heroDelta + manual, 5, 95)),
      confidence: round(clamp(baseConfidence + 0.14 * bucket.n / (bucket.n + 24) + 0.04 * Math.min(recent.games / 20, 1), 0.1, 0.85)),
      games: Math.round(bucket.games), winRate: bucket.n > 0 ? round(posterior * 100, 1) : null,
      preference: round(preference, 3), reasons: laneReasons,
    };
    return [lane, laneRating];
  })) as Record<Lane, LaneRating>;
  return { playerId: player.id, overall: round(clamp(baseline + recent.delta, 5, 95)),
    confidence: round(clamp(baseConfidence + (past.count ? 0.06 * past.ageWeight : 0) + 0.04 * Math.min(recent.games / 20, 1), 0.1, 0.85)),
    lanes, reasons, version: RATING_VERSION };
}

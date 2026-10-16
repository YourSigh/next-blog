// Static field evidence and remaining schema gaps: reports/season-history-research.md.
// This pure adapter does not query Camp, retain credentials, or fabricate chart points.
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const rows = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
const unpack = value => { const p = object(value); return p.data && typeof p.data === 'object' && !Array.isArray(p.data) ? p.data : p; };
const text = value => ['string', 'number'].includes(typeof value)
  ? String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 300) || null : null;
const number = value => (typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value)) ? Number(value) : null;
const nonnegative = value => { const n = number(value); return n !== null && n >= 0 ? n : null; };
const count = value => { const n = nonnegative(value); return Number.isSafeInteger(n) ? n : null; };
const first = (...values) => values.find(value => value !== null && value !== undefined);
const id = row => text(first(row.seasonId, row.seasonID, row.id));
const name = row => text(first(row.seasonName, row.name));
const winRate = (games, wins) => games !== null && games > 0 && wins !== null && wins <= games
  ? Math.round(wins / games * 10000) / 100 : null;
const hasData = value => Array.isArray(value) ? value.some(hasData)
  : value && typeof value === 'object' ? Object.values(value).some(hasData)
    : value !== null && value !== undefined;

// Verified historyList.rankInfo/masterInfo fields; never substitute lifetime maxima.
function seasonStats(value) {
  const source = object(value);
  const games = count(source.totalCnt);
  const wins = count(source.totalWinCnt);
  return {
    games, wins, winRate: winRate(games, wins),
    averageScore: nonnegative(source.averageScore),
    maxWinStreak: count(source.maxContinuousWinCnt),
    goldMedals: count(source.goldCnt),
    silverMedals: count(source.silverCnt),
    heroes: rows(source.heros).slice(0, 50).map(hero => {
      const heroGames = count(hero.gameCnt);
      const heroWins = count(hero.winCnt);
      return {
        id: text(hero.heroId), name: text(hero.heroName),
        games: heroGames, wins: heroWins, winRate: winRate(heroGames, heroWins),
        power: nonnegative(hero.heroFightPower),
      };
    }).filter(hasData),
  };
}

function time(value) {
  const n = number(value);
  if (n !== null) {
    if (n <= 0) return null;
    const date = new Date(n < 100000000000 ? n * 1000 : n);
    return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
  }
  // Accept explicit ISO timestamps; avoid guessing locale-dependent date strings.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
}

/** Returned snapshots only; detail fields follow the verified extended response schema. */
export function normalizeSeasonHistory({ seasonPayload = null, seasonListPayload = null } = {}) {
  const page = unpack(seasonPayload);
  const list = unpack(seasonListPayload);
  const optionRows = rows(first(list.seasonList, list.seasonListInfo, list.list));
  const options = [];
  const seen = new Set();
  for (const row of optionRows) {
    const option = { id: id(row), name: name(row) };
    if (option.id === null || seen.has(option.id)) continue;
    seen.add(option.id);
    options.push(option);
  }
  const byId = new Map(options.map(option => [option.id, option]));
  const items = rows(page.historyList).slice(0, 200).map(row => {
    const rank = object(row.rankInfo);
    const peak = object(row.masterInfo);
    const rankStats = seasonStats(rank);
    const peakStats = seasonStats(peak);
    const seasonId = id(row);
    const games = count(rank.totalCnt);
    const wins = count(rank.totalWinCnt);
    return {
      id: seasonId,
      name: name(row) ?? byId.get(seasonId)?.name ?? null,
      // Keep supplied labels/codes verbatim. There is no inferred rank-code mapping.
      rank: text(first(rank.jobName, rank.roleJobName, rank.rankName, rank.shortJobName, rank.roleJob)),
      stars: count(rank.rankingStar),
      maxRank: text(first(rank.seasonMaxJob, row.seasonMaxJob, rank.maxRank, row.maxRank)),
      maxStars: count(first(rank.seasonMaxJobStar, row.seasonMaxJobStar, rank.maxStars, row.maxStars)),
      peakScore: nonnegative(peak.masterScore),
      games, wins,
      winRate: winRate(games, wins),
      averageScore: nonnegative(rank.averageScore),
      rankStats, peakStats,
      startTime: time(first(row.seasonStartTime, row.startTime)),
      endTime: time(first(row.seasonEndTime, row.endTime)),
    };
  }).filter(hasData);
  return {
    items, options,
    coverage: {
      kind: 'returned-season-snapshots',
      returnedSeasons: items.length,
      availableOptions: options.length,
      complete: false,
      dailyHistory: false,
      truncated: rows(page.historyList).length > 200,
    },
    message: items.length
      ? '仅展示接口本次返回的赛季快照；尚未确认涵盖全部历史赛季，也不代表逐日段位曲线。'
      : '尚无可识别的赛季快照；缺失字段保留为空，赛季范围尚未确认。',
  };
}

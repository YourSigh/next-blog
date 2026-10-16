// Private Camp contracts researched from the pinned source in reports/data-api-research.md.
// This module deliberately has no network or credential persistence implementation.
const BASE = 'https://kohcamp.qq.com';
const RESEARCH_SOURCE = 'https://github.com/lizupingsama/Honor-of-Kings-Match-Dashboard/tree/c04acbabe21c85230c5911a07c6aba55577ea634/src/lib/camp';
const MAX_MATCHES = 50;

const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
const text = value => typeof value === 'string' || typeof value === 'number'
  ? String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 300) : '';
const number = value => (typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value)) ? Number(value) : null;
const count = value => { const n = number(value); return n !== null && n >= 0 ? n : null; };
const rounded = value => Math.round(value * 100) / 100;
const average = values => values.length ? rounded(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
const unpack = payload => { const p = record(payload); return p.data && typeof p.data === 'object' && !Array.isArray(p.data) ? p.data : p; };
const image = value => { try { const url = new URL(text(value)); return url.protocol === 'https:' ? url.href : null; } catch { return null; } };

function timestamp(value) {
  const n = number(value);
  if (n === null || n <= 0) return null;
  const d = new Date(n < 100000000000 ? n * 1000 : n);
  return Number.isFinite(d.valueOf()) ? d.toISOString() : null;
}

function normalizeMatch(row, index) {
  const outcome = row.gameresult ?? row.gameResult ?? row.result;
  const result = [1, '1', 'win', '胜利', '胜'].includes(outcome) ? 'win'
    : [2, '2', 'lose', 'loss', '失败', '负'].includes(outcome) ? 'loss' : 'unknown';
  const kills = count(row.killcnt ?? row.kills);
  const deaths = count(row.deadcnt ?? row.deaths);
  const assists = count(row.assistcnt ?? row.assists);
  const heroId = text(row.heroId ?? row.hero_id) || null;
  return {
    id: text(row.gameSeq ?? row.battleId ?? row.battle_id) || `page-row-${index}`,
    playedAt: timestamp(row.dtEventTime ?? row.dteventtime ?? row.battle_time),
    heroId,
    heroName: text(row.heroName ?? row.hero_name ?? row.chessName) || (heroId ? `英雄 ${heroId}` : '未知英雄'),
    heroIcon: image(row.heroIcon ?? row.hero_icon),
    mode: text(row.mapName ?? row.map_name) || '未知模式',
    result, kills, deaths, assists,
    kda: [kills, deaths, assists].every(n => n !== null) ? rounded((kills + assists) / Math.max(1, deaths)) : null,
    score: count(row.gradeGame ?? row.score),
    durationSeconds: count(row.usedTime ?? row.durationSec),
    rank: text(row.roleJobName ?? row.rankName) || null,
    evaluate: text(row.desc ?? row.evaluate) || null,
  };
}

function aggregateHeroes(matches) {
  const buckets = new Map();
  for (const match of matches) {
    const key = match.heroId || match.heroName;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(match);
  }
  return [...buckets.values()].map(rows => {
    const knownResults = rows.filter(row => row.result !== 'unknown');
    const wins = knownResults.filter(row => row.result === 'win').length;
    return {
      heroId: rows[0].heroId, heroName: rows[0].heroName, heroIcon: rows[0].heroIcon,
      games: rows.length, wins, knownResults: knownResults.length,
      winRate: knownResults.length ? rounded(wins / knownResults.length * 100) : null,
      averageKda: average(rows.map(row => row.kda).filter(value => value !== null)),
      averageScore: average(rows.map(row => row.score).filter(value => value !== null)),
      scope: 'latest-page',
    };
  }).sort((a, b) => b.games - a.games || (b.averageScore ?? -1) - (a.averageScore ?? -1));
}

export function normalizeCampDashboard({ userId, profilePayload, battlePayload, seasonPayload = null, roleId = null }) {
  const p = unpack(profilePayload);
  const b = unpack(battlePayload);
  const roles = list(p.roleList);
  const wantedRole = text(roleId) || text(p.targetRoleId);
  const role = roles.find(item => text(item.roleId) === wantedRole) || roles[0] || {};
  const rankMod = list(record(p.head).mods).find(item => Number(item.modId) === 701);
  let stars = null;
  try { stars = count(record(JSON.parse(text(rankMod?.param1) || '{}')).rankingStar); } catch { /* malformed optional rank metadata */ }
  const rows = list(b.list ?? b.battle_list);
  const matches = rows.slice(0, MAX_MATCHES).map(normalizeMatch);
  const knownResults = matches.filter(match => match.result !== 'unknown');
  const wins = knownResults.filter(match => match.result === 'win').length;
  const season = unpack(seasonPayload);
  const rankInfo = record(list(season.historyList)[0]?.rankInfo);
  const masterInfo = record(list(season.historyList)[0]?.masterInfo);
  const limitations = [
    '只读取本人最近一页战绩，英雄统计由这一页聚合，不代表完整英雄池或完整赛季。',
    '未读取单场详情、出装或队伍数据；缺失值保留为空。',
  ];
  if (rows.length > MAX_MATCHES) limitations.push(`本页仅保留前 ${MAX_MATCHES} 场。`);
  return {
    profile: {
      campId: text(userId), roleId: text(role.roleId) || null,
      nickname: text(role.roleName ?? role.nickname) || '我的游戏角色',
      avatar: image(role.roleIcon ?? role.avatar),
      area: text(role.areaName ?? role.roleText) || null,
      rank: text(rankMod?.name) || null, stars,
    },
    summary: {
      scope: 'latest-page', games: matches.length, wins, losses: knownResults.length - wins,
      unknownResults: matches.length - knownResults.length,
      winRate: knownResults.length ? rounded(wins / knownResults.length * 100) : null,
      averageKda: average(matches.map(match => match.kda).filter(value => value !== null)),
      averageScore: average(matches.map(match => match.score).filter(value => value !== null)),
      seasonGames: count(rankInfo.totalCnt), seasonWins: count(rankInfo.totalWinCnt),
      rankAverageScore: count(rankInfo.averageScore), peakAverageScore: count(masterInfo.averageScore),
      peakScore: count(masterInfo.masterScore),
    },
    matches, heroes: aggregateHeroes(matches),
    source: { kind: 'camp-private-api', contract: RESEARCH_SOURCE, latestPageOnly: true, hasMore: b.hasMore === true || b.hasMore === 1 || b.hasMore === '1' },
    limitations,
  };
}

export class CampDataError extends Error {
  constructor(code, message) { super(message); this.name = 'CampDataError'; this.code = code; }
}

function checkPayload(payload) {
  const p = record(payload);
  const code = number(p.returnCode);
  if (code === -10107) throw new CampDataError('hidden', '营地提示战绩隐私限制，请在营地检查本人战绩权限。');
  if (code === -30107) throw new CampDataError('rate_limit', '营地提示请求频繁，请稍后手动重试。');
  if (code !== null && ![0, 200].includes(code)) throw new CampDataError('upstream', '营地请求未成功，请检查授权状态。');
  return p;
}

/**
 * request must be an explicitly supplied, authorized Camp transport returning decoded JSON.
 * Signature: request(absoluteUrl, { method, body, auth }). It must sign/decrypt as needed,
 * reject HTTP/transport errors, send credentials only to Camp, and never persist or log auth.
 * A raw global fetch is insufficient. This function never reads a device or starts login.
 */
export async function fetchDashboard({ auth, request }) {
  if (typeof request !== 'function') throw new CampDataError('transport_required', '尚未接入经过验证的营地授权传输层。');
  const userId = text(auth?.userId);
  if (!/^\d{5,15}$/.test(userId)) throw new CampDataError('auth_required', '需要已授权的本人营地会话。');
  const post = async (path, body) => checkPayload(await request(`${BASE}${path}`, {
    method: 'POST', body: JSON.stringify(body), auth,
  }));
  const profilePayload = await post('/game/koh/profile', {
    targetUserId: userId, targetRoleId: '0', resVersion: '3', recommendPrivacy: '0', apiVersion: '2',
  });
  const battlePayload = await post('/game/morebattlelist', {
    lastTime: 0, recommendPrivacy: 0, apiVersion: 5, friendUserId: userId, option: 0,
  });
  const data = unpack(profilePayload);
  const roles = list(data.roleList);
  const wantedRole = text(auth.gameRoleId) || text(data.targetRoleId);
  const role = roles.find(item => text(item.roleId) === wantedRole) || roles[0];
  const roleId = text(role?.roleId);
  // At most three read-only calls. Privacy/rate/auth errors propagate; no retries or rotation.
  const seasonPayload = roleId ? await post('/game/seasonpage', { recommendPrivacy: 0, seasonId: 0, roleId }) : null;
  return normalizeCampDashboard({ userId, profilePayload, battlePayload, seasonPayload, roleId });
}

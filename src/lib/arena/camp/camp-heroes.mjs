// Read-only hero schemas from official Camp H5 + shipped APK evidence.
// See reports/full-hero-api-research.md. No network, credentials or storage here.
const H5_SOURCE = 'https://camp.qq.com/h5/webdist/frequency-hero-list/static/js/main.280fafb4.js';
const NATIVE_SOURCE = 'reports/hero-dex-contracts.json';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const string = value => ['string', 'number'].includes(typeof value) ? String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 300) : '';
const count = value => {
  if (!['string', 'number'].includes(typeof value) || string(value) === '') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};
const image = value => { try { const url = new URL(string(value)); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; } };

function percent(value) {
  if (!['string', 'number'].includes(typeof value)) return null;
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d+)?\s*%?$/.test(raw)) return null;
  const n = Number(raw.replace(/\s*%$/, ''));
  return n >= 0 && n <= 100 ? n : null;
}

/** Observed legacy HeroResponse/H5 shape only. Never infer wins by rounding a
 * displayed rate; never turn unknown all-time/season/mode scope into certainty.
 */
export function normalizeHeroStats(payload, { catalog = [], source = '' } = {}) {
  const outer = object(payload) ? payload : {};
  const data = object(outer.data) ? outer.data : outer;
  const recognized = Array.isArray(data.heroList);
  const rows = recognized ? data.heroList.filter(object) : [];
  const catalogRows = Array.isArray(catalog) ? catalog.filter(object) : [];
  const byId = new Map(catalogRows.map(row => [string(row.ename), row]));
  const byName = new Map(catalogRows.map(row => [string(row.cname), row]));
  const fullSource=source==='/play/h5getherolist';
  const items = rows.map(row => {
    const modern=object(row.basicInfo);
    row=modern?row.basicInfo:row;
    const rawName = string(row.name)||string(row.title);
    const found = byId.get(string(row.heroId)) || byName.get(rawName);
    const id = string(row.heroId) || string(found?.ename) || null;
    const name = rawName || string(found?.cname) || (id ? `英雄 ${id}` : '未知英雄');
    return {
      id, name, games: count(row.playNum), wins: count(row.winNum), losses:count(row.failNum), score:count(row.score),
      winRate: percent(row.winRate), winRateText: string(row.winRate) || null,
      power: count(row.heroFightPower), maxPower: null, proficiency: count(row.skilledLevel),
      icon: image(row.heroIcon),
      scope: modern?'profile-featured-total':fullSource?'hero-list-total':'server-unspecified',
    };
  });
  const modern=rows.some(row=>object(row.basicInfo));
  const ids = items.map(item => item.id).filter(Boolean);
  const missingCatalogIds=[...byId.keys()].filter(id=>!ids.includes(id));
  const catalogMatched=catalogRows.length>0&&!missingCatalogIds.length&&ids.length===new Set(ids).size&&ids.every(id=>byId.has(id));
  return {
    items,
    scope: {
      period: 'unknown', seasonId: null, mode: 'unknown',
      description: fullSource?`官方英雄列表返回 ${items.length} 个条目；标注总场数、总胜率和荣耀战力，模式范围未注明。`:modern?'主页常用英雄：官方标注总场数、总胜率、荣耀战力；不代表完整英雄池，模式范围未注明。':'营地返回的角色英雄统计；尚未证明是历史累计、本赛季或仅排位。',
    },
    coverage: {
      schema: recognized ? (modern?'profile-featured-heroList':'legacy-heroList') : 'unrecognized',
      receivedRows: recognized ? data.heroList.length : 0,
      normalizedRows: items.length,
      catalogSize: catalogRows.length,
      identifiedHeroes: new Set(ids).size,
      duplicateIds: ids.length - new Set(ids).size,
      itemsWithGames: items.filter(item => item.games !== null).length,
      itemsWithWinRate: items.filter(item => item.winRate !== null).length,
      itemsWithPower: items.filter(item => item.power !== null).length,
      catalogMatched,missingCatalogIds,
      complete: false,
      completeness: 'unknown',
      pagination: 'not-observed-in-client',
      unavailableFields: ['wins','maxPower','proficiency'].filter(key=>!items.some(item=>item[key]!==null)),
    },
    message: recognized
      ? `已读取接口返回的 ${items.length} 个英雄；${fullSource?`${catalogMatched?'覆盖当前官方目录。':'目录覆盖仍待确认。'} ${items.filter(item=>item.games!==null).length} 个带场次数据，缺失项保留为空。熟练度为接口等级值。`:modern?'当前为主页常用英雄，完整列表仍待核验。熟练度为接口等级值。':'完整英雄池、赛季/模式范围仍待校验。'}最高战力未返回。`
      : '接口结构与已观察到的 heroList 不一致，未把空结果当作没有英雄。',
  };
}

/** Concrete observed request candidates, not a claim both endpoints return all
 * heroes. Callers must constrain these IDs to the authenticated user's role.
 * uniqueRoleId is distinct URL metadata; never substitute userId or roleId.
 * The H5 helper returns undefined when it is absent, and JSON.stringify omits it.
 */
export function buildHeroRequests({ userId, roleId, uniqueRoleId } = {}) {
  if (!/^\d{5,15}$/.test(string(userId))) throw new TypeError('需要本人营地 userId 上下文。');
  const role = string(roleId);
  if (!/^\d+$/.test(role) || !Number.isSafeInteger(Number(role)) || Number(role) <= 0) {
    throw new TypeError('原生 roleId 是 Long；需要能够无损表示的本人数字角色 ID。');
  }
  const requests = [{
    path: '/play/getherolist', body: { roleId: Number(role) },
    evidence: { source: NATIVE_SOURCE, method: 'GameApi.e', caller: 'GameStatsViewModel.T',
      requestType: 'CharRequest', completeness: 'unknown-profile-section' },
  }];
  const h5Body = { roleId: role };
  if (uniqueRoleId !== undefined && uniqueRoleId !== null && string(uniqueRoleId)) {
    const unique = String(uniqueRoleId);
    if (unique.length > 128 || /[\u0000-\u0020\u007f]/.test(unique)) throw new TypeError('uniqueRoleId 格式无效。');
    h5Body.uniqueRoleId = unique;
  }
  requests.push({
    path: '/play/h5getherolist', body: h5Body,
    evidence: { source: H5_SOURCE, transport: 'php',
      absentUniqueRoleId: 'helper-returns-undefined-json-omits-key',
      completeness: 'whole-array-consumed-by-list-page' },
  });
  return requests;
}

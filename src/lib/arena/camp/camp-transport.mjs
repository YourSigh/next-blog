// Private protocol adapted from lizupingsama/Honor-of-Kings-Match-Dashboard,
// commit c04acbabe21c85230c5911a07c6aba55577ea634, under Mulan PSL v2.
// See ../../../../docs/arena-third-party.md and ../../../../docs/licenses/MulanPSL-2.0.txt.
// THIS SOFTWARE IS PROVIDED AS IS, WITHOUT WARRANTIES OF ANY KIND.
// First own-account QQ login and basic data reads were verified on 2026-10-16.
import crypto from 'node:crypto';
import { encryptXXTEA, decryptXXTEA } from './camp-crypto.mjs';

const ORIGIN = 'https://kohcamp.qq.com';
const PHP_ORIGIN = 'https://ssl.kohsocialapp.qq.com:10001';
const PATHS = new Set(['/game/koh/profile', '/game/morebattlelist', '/game/seasonpage']);
const EXTENDED_PATHS = new Set(['/game/seasonlist', '/play/getherolist', '/play/h5getherolist', '/game/profile/herolist']);
const PUBLIC_KEY = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC0h62mV/zjJtFsNdfFNlxksfUOpjDI2KCcBrPiA8T7szABT4InLDTrdXAW84QyGNiazB0i7pgPCNGSAYbiJrCRutZ5jQsVS0Wg/RnXfwVQDJcAHJDjP5IXyroeLX7NUxDai8nPcpfRsvq6sneobyPexZSH0TlVSnecsJZTj5wu/wIDAQAB';
const PEM = `-----BEGIN PUBLIC KEY-----\n${PUBLIC_KEY.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
export { PEM as CAMP_PUBLIC_KEY_PEM };
// App version is the inspected APK's actual metadata. Device version/hardware
// and unknown tinker suffix are omitted. Login-supplied known fields may override.
const DEFAULTS = {
  userAgent: 'okhttp/4.9.1', xClientProto: 'https', contentEncrypt: '', acceptEncrypt: '',
  noEncrypt: '1', isTrpcRequest: 'true', cChannelId: '10003391',
  cClientVersionCode: '2057969907', cClientVersionName: '10.114.0722',
  cCurrentGameId: '20001', cGameId: '20001', cGzip: '1', cIsArm64: 'true',
  cSupportArm64: 'true', cSystem: 'android',
};

export class CampTransportError extends Error {
  constructor(code, message, details) { super(message); this.name = 'CampTransportError'; this.code = code; if(details)this.details=details; }
}
const fail = (code, message,details) => { throw new CampTransportError(code, message,details); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const scalar = value => ['string', 'number'].includes(typeof value) ? String(value) : '';

function base64(value) {
  const encoded = scalar(value).trim();
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail('auth', '营地加密数据格式无效。');
  return Buffer.from(encoded, 'base64');
}

function resolveKey(auth) {
  if (typeof auth.userKey === 'string' && auth.userKey.length && auth.userKey.length < 1024) return auth.userKey;
  try {
    const decoded = crypto.publicDecrypt({ key: PEM, padding: crypto.constants.RSA_PKCS1_PADDING }, base64(auth.encodeRes));
    const key = JSON.parse(decoded.toString('utf8')).userKey;
    if (typeof key === 'string' && key.length && key.length < 1024) return key;
  } catch { /* No raw crypto input/errors enter the UI. */ }
  fail('auth', '营地会话缺少有效 userKey，需要重新授权。');
}

function headersFor(auth, userKey) {
  const settings = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) if (typeof auth[key] === 'string') settings[key] = auth[key];
  const offset = Number(auth.serverTimeOffsetMs || 0);
  const timestamp = Date.now() + (Number.isFinite(offset) ? offset : 0);
  const nonce = `${auth.userId}:${crypto.randomUUID().replace(/-/g, '')}:${timestamp}`;
  const headers = {
    Host: 'kohcamp.qq.com', 'Content-Type': 'application/json; charset=UTF-8',
    'User-Agent': settings.userAgent, 'Content-Encrypt': settings.contentEncrypt,
    'Accept-Encrypt': settings.acceptEncrypt, NOENCRYPT: settings.noEncrypt,
    'X-Client-Proto': settings.xClientProto,
    'x-log-uid': scalar(auth.xLogUid) || crypto.randomUUID().toUpperCase(),
    traceparent: `00-${crypto.randomBytes(16).toString('hex')}-${crypto.randomBytes(8).toString('hex')}-01`,
    istrpcrequest: settings.isTrpcRequest, cchannelid: settings.cChannelId,
    cclientversioncode: settings.cClientVersionCode, cclientversionname: settings.cClientVersionName,
    ccurrentgameid: settings.cCurrentGameId, cgameid: settings.cGameId,
    cgzip: settings.cGzip, cisarm64: settings.cIsArm64, crand: String(Date.now()),
    csupportarm64: settings.cSupportArm64, csystem: settings.cSystem,
    // The pinned camp-api source fixes these values in resolveAuth.
    gameareaid: '1', gameid: settings.cGameId, gameusersex: '1', kohdimgender: '2',
    token: auth.token, userid: auth.userId,
    encodeParam: encryptXXTEA(JSON.stringify({ timestamp, nonce }), userKey).toString('base64'),
  };
  for (const [field, header] of [['openId', 'openid'], ['gameOpenId', 'gameopenid'], ['gameRoleId', 'gameroleid'], ['gameServerId', 'gameserverid']]) {
    if (scalar(auth[field])) headers[header] = scalar(auth[field]);
  }
  return headers;
}

function enforceBody(path, body, userId, knownRoles, extended, knownSeasons, uniqueRoles, knownBattles) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 16384) fail('scope', '营地请求体不在允许范围。');
  let data;
  try { data = JSON.parse(body); } catch { fail('scope', '营地请求体不是有效 JSON。'); }
  if (!plain(data)) fail('scope', '营地请求体不在允许范围。');
  const roleAllowed = value => knownRoles.has(scalar(value));
  if(path==='/game/battledetail'){
    const key=JSON.stringify([data.gameSeq,data.gameSvr,data.relaySvr,data.battleType]);
    if(Object.keys(data).length!==6||data.recommendPrivacy!==0||typeof data.targetRoleId!=='string'||!roleAllowed(data.targetRoleId)||!knownBattles.has(key))fail('scope','只能读取本人最新战绩页已经返回的对局详情。');
    return;
  }
  if(extended&&path==='/game/profile/herolist'){
    if(Object.keys(data).length!==2||typeof data.targetRoleId!=='string'||!roleAllowed(data.targetRoleId)||data.targetUserId!==userId)fail('scope','只能读取本人角色的当前英雄列表。');
    return;
  }
  if (extended && ['/game/seasonlist', '/play/getherolist'].includes(path)) {
    if (Object.keys(data).length !== 1 || !roleAllowed(data.roleId)) fail('scope', '只能读取本人角色的英雄与赛季。');
    return;
  }
  if (extended && path === '/play/h5getherolist') {
    const uniqueOnly=Object.keys(data).length===1&&typeof data.uniqueRoleId==='string'&&[...uniqueRoles.values()].some(values=>values.has(data.uniqueRoleId));
    if(uniqueOnly)return;
    if (Object.keys(data).some(key=>!['roleId','uniqueRoleId'].includes(key)) || !roleAllowed(data.roleId)) fail('scope', '英雄列表角色不在本人范围。');
    if ('uniqueRoleId' in data && !uniqueRoles.get(scalar(data.roleId))?.has(scalar(data.uniqueRoleId))) fail('scope', '不能指定未经本人个人页验证的角色标识。');
    return;
  }
  let expected;
  if (path === '/game/koh/profile') expected = { targetUserId: userId, targetRoleId: '0', resVersion: '3', recommendPrivacy: '0', apiVersion: '2' };
  if (path === '/game/morebattlelist') expected = { lastTime: 0, recommendPrivacy: 0, apiVersion: 5, friendUserId: userId, option: 0 };
  if (path === '/game/seasonpage') {
    if (typeof data.roleId !== 'string' || !knownRoles.has(data.roleId)) fail('scope', '只能读取本人个人页返回的角色赛季。');
    if (extended && data.seasonId !== 0 && !knownSeasons.has(scalar(data.seasonId))) fail('scope', '只能读取接口已列出的赛季。');
    expected = { recommendPrivacy: 0, seasonId: extended ? data.seasonId : 0, roleId: data.roleId };
  }
  if (Object.keys(data).length !== Object.keys(expected).length || Object.entries(expected).some(([key, value]) => data[key] !== value)) {
    fail('scope', '仅允许读取本人最新一页营地数据。');
  }
}

function safeDiagnosis(message) {
  const value=scalar(message);
  const fields=['roleId','uniqueRoleId','userId','seasonId','apiVersion','gameRoleId','heroid','heroId','type','option'].filter(key=>new RegExp('\\b'+key+'\\b','i').test(value));
  const category=/参数|parameter|param|invalid|缺少|格式/i.test(value)?'parameter':/不存在|not found|no route|路由/i.test(value)?'not_found':/登录|token|鉴权|权限/i.test(value)?'auth':/频繁|limit/i.test(value)?'rate_limit':'unknown';
  return {category,fields,chineseHint:(value.match(/[\u3400-\u9fff，。：；！？、（）]+/g)||[]).join('·').slice(0,100)};
}
function checkCode(code, message='') {
  if (code === null || code === undefined || code === '') return;
  if (!Number.isFinite(Number(code))) fail('upstream', '营地返回无法识别的状态。');
  const n = Number(code);
  if (n === -10107) fail('hidden', '营地限制了战绩访问，请检查本人隐私设置。');
  if (n === -30107) fail('rate_limit', '营地提示请求频繁，请稍后手动重试。');
  if (![0, 200].includes(n)) fail('upstream', '营地请求失败，请检查授权状态。',{returnCode:n,diagnosis:safeDiagnosis(message)});
}

/** In-memory only. network is a fetch-compatible function with no logging/persistence.
 * It MUST honor redirect:'manual', use the supplied URL, and return a Response.
 * Basic and extended own-account reads verified on 2026-10-16; this does not create a login session.
 */
export function createCampTransport({ network, auth, extended = false, battleDetails = false, observe }) {
  if (typeof network !== 'function') fail('transport_required', '需要显式提供本地网络传输函数。');
  if (!plain(auth) || !/^\d{5,15}$/.test(scalar(auth.userId)) || typeof auth.token !== 'string' || !auth.token) {
    fail('auth', '需要完整的本人营地授权会话。');
  }
  // Copy only in memory so changing a shared session cannot redirect its identity.
  const session = { ...auth, userId: scalar(auth.userId) };
  const userKey = resolveKey(session);
  const knownRoles = new Set();
  const uniqueRoles = new Map();
  const knownSeasons = new Set();
  const knownBattles = new Set();
  const request = async (url, options = {}) => {
    if (typeof url !== 'string') fail('scope', '营地地址不在允许范围。');
    const path = url.startsWith(ORIGIN) ? url.slice(ORIGIN.length) : '';
    if (!(PATHS.has(path) || extended && EXTENDED_PATHS.has(path) || battleDetails && path==='/game/battledetail') || url !== `${ORIGIN}${path}` || options.method !== 'POST') fail('scope', '仅允许指定的营地 HTTPS 只读接口。');
    if (options.auth && scalar(options.auth.userId) !== session.userId) fail('scope', '会话账号与请求账号不一致。');
    enforceBody(path, options.body, session.userId, knownRoles, extended, knownSeasons, uniqueRoles, knownBattles);
    // The official H5 production map routes serviceType=php to this origin,
    // not the newer RPC host. Only these two already-validated role reads use it.
    const php = extended && ['/play/getherolist','/play/h5getherolist'].includes(path);
    const targetUrl = php ? PHP_ORIGIN+path : url;
    const headers = headersFor(session,userKey);
    if(php){headers.Host='ssl.kohsocialapp.qq.com:10001';headers['Content-Type']='application/x-www-form-urlencoded; charset=UTF-8';headers.istrpcrequest='false';}
    let body=options.body;
    if(php){
      // BaseParamInterceptor builds a FormBody from BaseParam(false), preserving
      // Java field case. Headers alone cannot authenticate legacy PHP requests.
      const settings={...DEFAULTS};
      for(const key of Object.keys(DEFAULTS))if(typeof session[key]==='string')settings[key]=session[key];
      const base={userId:session.userId,token:session.token,encodeParam:headers.encodeParam,recommendPrivacy:0};
      if(scalar(session.openId))base.openId=scalar(session.openId);
      for(const field of ['cChannelId','cClientVersionCode','cClientVersionName','cCurrentGameId','cGameId','cGzip','cIsArm64','cSupportArm64','cSystem'])base[field]=settings[field];
      base.gameId=settings.cGameId;base.cRand=headers.crand;
      for(const field of ['gameOpenId','gameRoleId','gameServerId'])if(scalar(session[field]))base[field]=scalar(session[field]);
      body=new URLSearchParams(Object.entries({...base,...JSON.parse(options.body)}).map(([key,value])=>[key,String(value)])).toString();
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await network(targetUrl, {
        method: 'POST', body, headers,
        signal: controller.signal, redirect: 'manual', cache: 'no-store',
      });
      if (!response || typeof response.text !== 'function' || typeof response.headers?.get !== 'function') fail('upstream', '本地网络传输没有返回有效响应。');
      if (response.url && response.url !== targetUrl) fail('scope', '营地响应地址发生变化，已停止。');
      if (response.status >= 300 && response.status < 400) fail('scope', '营地返回重定向，已停止。');
      if (response.status === 401 || response.status === 403) fail('auth', '营地授权失效，请重新授权。');
      if (response.status === 429) fail('rate_limit', '营地提示请求频繁，请稍后手动重试。');
      if (!response.ok) fail('upstream', '营地请求未成功。',{httpStatus:response.status});
      if (response.headers.get('encryptparamerr')) fail('auth', '营地安全参数校验失败，请重新授权。');
      const headerCode=response.headers.get('returncode');
      if(['-10107','-30107'].includes(headerCode))checkCode(headerCode);
      let dataText = await response.text();
      if (Buffer.byteLength(dataText) > 2097152) fail('upstream', '营地响应超出本地读取上限。');
      if (response.headers.get('campencrypt') === 'true') dataText = decryptXXTEA(base64(dataText), userKey).toString('utf8').replace(/\0+$/, '');
      let data;
      try { data = JSON.parse(dataText); } catch { fail('upstream', '营地响应无法解析。'); }
      if (!plain(data)) fail('upstream', '营地响应不是有效对象。');
      checkCode(headerCode, data.returnMsg ?? data.message ?? data.msg ?? response.headers.get('returnmsg'));
      checkCode(data.returnCode, data.returnMsg ?? data.message ?? data.msg);
      // Preserve the pinned client's auth-failure detection, without reflecting its message.
      if (/登录|登录态|token|鉴权|安全参数|重新登录|权限/i.test(scalar(data.returnMsg ?? data.message ?? data.msg))) fail('auth', '营地授权失效或权限不足，请重新授权。');
      if (/操作频繁|请求频繁/.test(scalar(data.returnMsg ?? data.message ?? data.msg))) fail('rate_limit', '营地提示请求频繁，请稍后手动重试。');
      if (path === '/game/koh/profile') {
        const profile = plain(data.data) ? data.data : data;
        knownRoles.clear();
        if (Array.isArray(profile.roleList)) for (const role of profile.roleList) {
          if (plain(role) && scalar(role.roleId)) {
            const roleId = scalar(role.roleId);knownRoles.add(roleId);
            uniqueRoles.set(roleId,new Set([role.uniqueRoleId,role.uniqueRoleID].map(scalar).filter(Boolean)));
          }
        }
      }
      if(path==='/game/morebattlelist'&&battleDetails){
        knownBattles.clear();const page=plain(data.data)?data.data:data;
        for(const row of (page.list||page.battle_list||[]).slice(0,50)){
          const values=[scalar(row.gameSeq),scalar(row.gameSvrId||row.gameSvr),scalar(row.relaySvrId||row.relaySvr),Number(row.battleType)];
          if(values.slice(0,3).every(v=>v&&v.length<300)&&Number.isInteger(values[3])&&values[3]>=0)knownBattles.add(JSON.stringify(values));
        }
      }
      if(path==='/game/koh/profile'){
        const profile=plain(data.data)?data.data:data;
        const target=scalar(profile.targetRoleId);
        if(knownRoles.has(target)&&Array.isArray(profile.head?.mods))for(const mod of profile.head.mods){
          try{const parsed=new URL(mod.jumpUrl);const unique=parsed.searchParams.get('uniqueRoleId');if(unique&&/^\d+$/.test(unique))uniqueRoles.get(target).add(unique);}catch{}
        }
      }
      if (path === '/game/seasonlist' || path === '/game/seasonpage') {
        const page = plain(data.data) ? data.data : data;
        for (const field of ['seasonList','seasonListInfo','list','historyList']) if(Array.isArray(page[field])) for(const row of page[field]) {
          if(plain(row)){const value=scalar(row.seasonId??row.seasonID??row.id);if(/^\d+$/.test(value))knownSeasons.add(value);}
        }
      }
      if(typeof observe==='function')await observe(path,data);
      return data;
    } catch (error) {
      if (error instanceof CampTransportError) throw error;
      fail('transport', controller.signal.aborted ? '营地请求超时。' : '营地网络或加密响应处理失败。');
    } finally { clearTimeout(timer); }
  };
  request.contractStatus = 'verified-own-account';
  return request;
}

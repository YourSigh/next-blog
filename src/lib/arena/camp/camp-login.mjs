// Experimental legacy QQ exchange, not a verified live login implementation.
// QQ body: reports/qq-legacy-create-param-method.json, actual record
// ev_91a68d7d66541ae93ecf086b1d6e360722e287782c6c5b1e9d66c0f99b0c29ca.
// loginType 'openSdk': reports/login-type-constants.json original DEX static value.
// Form/signing adapted from pinned wechat-login.ts under Mulan PSL v2.
// See ../../../../docs/arena-third-party.md and ../../../../docs/licenses/MulanPSL-2.0.txt.
// THIS SOFTWARE IS PROVIDED AS IS, WITHOUT WARRANTIES OF ANY KIND.
import crypto from 'node:crypto';
import { CAMP_PUBLIC_KEY_PEM, CampTransportError } from './camp-transport.mjs';

const LOGIN_URL = 'https://ssl.kohsocialapp.qq.com:10001/user/login';
const GRAPH_URL = 'https://graph.qq.com/user/get_user_info';
const QQ_APP_ID = '1105200115';
const fail = (code, message) => { throw new CampTransportError(code, message); };
const scalar = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

const CLIENT_FIELDS = {
  cChannelId: '10003391', cClientVersionCode: '2057969907', cClientVersionName: '10.114.0722',
  cCurrentGameId: '20001', cGameId: '20001', cGzip: '1', cIsArm64: 'true',
  cSupportArm64: 'true', cSystem: 'android', gameId: '20001',
};

function specialEncodeParam(installationId) {
  const timestamp = Date.now();
  // This is explicitly an anonymous local installation identity, not a handset
  // IMEI or any claim to reproduce the connected phone's device fingerprint.
  // The pinned WeChat implementation has further Android device metadata; its
  // necessity for QQ remains unknown. We omit fabricated hardware/IMEI values.
  const raw = Buffer.from(JSON.stringify({
    timestamp, nonce: `:${crypto.randomUUID().replace(/-/g, '')}:${timestamp}`,
    cDeviceId: installationId, deviceid: installationId,
  }));
  const chunks = [];
  for (let offset = 0; offset < raw.length; offset += 117) chunks.push(crypto.publicEncrypt({
    key: CAMP_PUBLIC_KEY_PEM, padding: crypto.constants.RSA_PKCS1_PADDING,
  }, raw.subarray(offset, offset + 117)));
  return Buffer.concat(chunks).toString('base64');
}

async function jsonRequest(network, url, options) {
  const parsed = new URL(url);
  if (!(url === LOGIN_URL || parsed.origin === 'https://graph.qq.com' && parsed.pathname === '/user/get_user_info' && !parsed.hash && !parsed.username && !parsed.password)) {
    fail('scope', '登录地址不在允许范围。');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await network(url, { ...options, signal: controller.signal, redirect: 'manual', cache: 'no-store' });
    if (!response || typeof response.text !== 'function' || typeof response.headers?.get !== 'function') fail('upstream', '登录服务返回无效响应。');
    if (response.url && response.url !== url || response.status >= 300 && response.status < 400) fail('scope', '登录服务返回了重定向，已停止。');
    if (response.status === 429) fail('rate_limit', '登录服务提示请求频繁，请稍后手动重试。');
    if (response.status === 401 || response.status === 403) fail('auth', 'QQ 登录授权未被接受。');
    if (!response.ok) fail('upstream', '登录服务请求失败。');
    if (response.headers.get('encryptparamerr')) fail('auth', '登录安全参数校验失败，兼容性尚待验证。');
    const headerCode = response.headers.get('returncode');
    if (headerCode && !['0', '200'].includes(headerCode)) fail(headerCode === '-30107' ? 'rate_limit' : 'auth', '登录交换未通过，请稍后手动重试。');
    const body = await response.text();
    if (Buffer.byteLength(body) > 1048576) fail('upstream', '登录服务响应超出读取上限。');
    let data;
    try { data = JSON.parse(body); } catch { fail('upstream', '登录服务响应无法解析。'); }
    if (!plain(data)) fail('upstream', '登录服务返回了无效数据。');
    return data;
  } catch (error) {
    if (error instanceof CampTransportError) throw error;
    fail('transport', controller.signal.aborted ? '登录请求超时。' : '登录网络请求未成功。');
  } finally { clearTimeout(timer); }
}

/** Takes only the currently user-approved QQ callback. Returned auth is private
 * backend memory and must never be JSON-serialized to the page, persisted or logged.
 * No retries, account rotation, device access, bulk operations or login on import.
 */
export async function exchangeQQLogin({ network, qq }) {
  if (typeof network !== 'function') fail('transport_required', '需要显式提供本地网络传输函数。');
  if (!plain(qq) || !scalar(qq.accessToken) || !scalar(qq.openId)) fail('auth', 'QQ 回调缺少本人授权数据。');
  if (scalar(qq.accessToken).length > 8192 || scalar(qq.openId).length > 1024) fail('auth', 'QQ 回调授权格式无效。');
  let nickname = scalar(qq.nickname ?? qq.name), avatar = scalar(qq.avatar ?? qq.icon);
  let sex = [0, 1, 2].includes(Number(qq.sex)) ? scalar(qq.sex) : '';
  if (!nickname || !avatar) {
    const url = new URL(GRAPH_URL);
    url.searchParams.set('access_token', scalar(qq.accessToken));
    url.searchParams.set('oauth_consumer_key', QQ_APP_ID);
    url.searchParams.set('openid', scalar(qq.openId));
    const info = await jsonRequest(network, url.href, { method: 'GET' });
    if (Number(info.ret) !== 0) fail('auth', 'QQ 本人资料授权未被接受。');
    nickname ||= scalar(info.nickname);
    avatar ||= scalar(info.figureurl_qq_2 || info.figureurl_qq_1 || info.figureurl_2);
    // The Camp LoginParam carries numeric sex. Without a callback's numeric
    // value, omit it rather than guessing the private client's gender mapping.
  }
  const installationId = crypto.randomUUID().replace(/-/g, '');
  const xLogUid = crypto.randomUUID().toUpperCase();
  const signed = specialEncodeParam(installationId);
  const clientFields = { ...CLIENT_FIELDS, cRand: String(Date.now()) };
  const form = new URLSearchParams({
    loginType: 'openSdk', openId: scalar(qq.openId), accessToken: scalar(qq.accessToken),
    avatar, nickname, delOldUser: '0', key1: installationId,
    payToken: scalar(qq.payToken), pf: scalar(qq.pf), pfKey: scalar(qq.pfKey), expires: scalar(qq.expires),
    lastLoginTime: '0', lastGetRemarkTime: '0', ...clientFields, specialEncodeParam: signed,
  });
  if (sex) form.set('sex', sex);
  const result = await jsonRequest(network, LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Encrypt': '', 'Accept-Encrypt': '', NOENCRYPT: '1', 'X-Client-Proto': 'https',
      'User-Agent': 'okhttp/4.9.1', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-log-uid': xLogUid, ...clientFields, specialEncodeParam: signed,
    },
    body: form.toString(),
  });
  if (Number(result.returnCode) === -30107) fail('rate_limit', '营地提示登录频繁，请稍后手动重试。');
  const data = result.data;
  if (Number(result.returnCode) !== 0 || !plain(data) || !/^\d{5,15}$/.test(scalar(data.userId)) || !scalar(data.token) || !scalar(data.encodeRes)) {
    fail('auth', '营地未返回完整会话；QQ 登录交换仍在实验验证中。');
  }
  // encodeRes is an opaque server response; createCampTransport verifies and
  // decodes its userKey before it can send any battle request.
  return {
    userId: scalar(data.userId), token: scalar(data.token), encodeRes: scalar(data.encodeRes),
    openId: scalar(data.openId || data.appOpenid || qq.openId),
    expires: scalar(data.expires), xLogUid, loginPlatform: 'qq',
    contractStatus: 'experimental-unverified-live',
  };
}

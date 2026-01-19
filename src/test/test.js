// 每日限额
const LIMIT_SIZE = 200;
// 租户访问次数 map
const TENANT_ACCESS_COUNT_MAP = new Map();
// 租户限额截止时间（次日零点） map
const TENANT_LIMIT_TIME_MAP = new Map();

// 次日零点时间戳
function getTomorrowZero() {
  const now = new Date();
  const tomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1
  );
  return tomorrow.getTime();
}

/**
 * 检查并记录租户用量
 * @param {string} tenantId
 * @returns {boolean} true = 未超限，false = 已超限
 */
function checkLimit(tenantId) {
  const now = Date.now();

  // 1️⃣ 如果是第一次访问该租户，初始化
  if (!TENANT_ACCESS_COUNT_MAP.has(tenantId)) {
    TENANT_ACCESS_COUNT_MAP.set(tenantId, 1);
    TENANT_LIMIT_TIME_MAP.set(tenantId, getTomorrowZero());
    return true;
  }

  const limitTime = TENANT_LIMIT_TIME_MAP.get(tenantId);

  // 2️⃣ 如果已经过了限额时间（到了新的一天），重置
  if (now >= limitTime) {
    TENANT_ACCESS_COUNT_MAP.set(tenantId, 1);
    TENANT_LIMIT_TIME_MAP.set(tenantId, getTomorrowZero());
    return true;
  }

  // 3️⃣ 还在当天，判断是否超限
  const count = TENANT_ACCESS_COUNT_MAP.get(tenantId);

  if (count >= LIMIT_SIZE) {
    return false; // 已超限
  }

  // 4️⃣ 未超限，次数 +1
  TENANT_ACCESS_COUNT_MAP.set(tenantId, count + 1);
  return true;
}

console.log(checkLimit('A'));
# 扫码登录维护与回归

QQ 已验证基线：提交 `2162677`。修改微信时应保留 QQ 的下列完整流程；不能只验证二维码生成。

## QQ 流程

1. `openmobile.qq.com/oauth2.0/m_authorize` 发起营地 AppID `1105200115` 授权，为本次请求生成独立 state。
2. 读取官方 `xui.ptlogin2.qq.com/cgi-bin/xlogin`，保留服务器内存中的登录 Cookie。
3. `ssl.ptlogin2.qq.com/ptqrshow` 生成二维码，保留 qrsig；以 qrToken(qrsig) 轮询 `ptqrlogin`。
4. 手机确认后，处理 `check_sig` 等官方重定向。最终结果可能是直接 `auth://tauth.qq.com/`，也可能先到官方移动中转页。
5. 中转页 `https://imgcache.qq.com/open/connect/widget/mobile/login/proxy.htm` 的参数可能位于含多个 `#` 的 fragment。严格检查 AppID，并把其中的 redirect_uri_key 作为 keystr 请求固定官方端点 `https://openmobile.qq.com/oauth2.0/m_get_redirect_url`。
6. 只解析 `_Callback(JSON)` 数据，校验最终回调的 state。不要执行远端脚本，不要把授权 fragment 发送到中转页。
7. `exchangeQQLogin` 交换营地会话；成功后读取英雄、赛季和最近对局，再投影允许字段保存文件。手机确认、营地验证成功、数据保存成功是三个不同阶段。

关键文件：`src/lib/arena/camp/qq-qr.mjs`、`src/lib/arena/camp/camp-login.mjs`。微信修复应优先限定在微信 provider 内；涉及共享服务时必须同时回归两个 provider。

## 微信流程

`a/getwxsdkticket` → 签名的 `connect/sdk/qrconnect` → `long.open.weixin.qq.com/connect/l/qrconnect` → 405 确认结果中的一次性 code → `exchangeWeChatLogin` → 营地数据同步与文件保存。

404 表示已扫码待确认；405 才进入营地登录交换。网页每约 2.5 秒查询本地授权状态，随后另外查询同步状态。因此手机确认后会有网络交换、前端轮询和数据读取时间，不能仅凭等待认定使用了旧缓存。

登录票据、code、QQ access token、Cookie、营地会话都不作为测试样例或诊断文件保存。纯结构回归使用虚构值。

## 每次修改的检查

- `npm run test:arena`：包括 QQ 官方中转、state 校验与失败处理，以及微信签名和状态处理。
- 分别真人扫码 QQ 和微信，确认网页已登录、显示本人档案、同步完成且文件更新时间变化。自动测试通过不能替代这一步。
- 验证切换 provider 时旧轮询已停止；退出释放临时登录，已公开档案按产品规则保留。
- 若需排除本地历史数据，先停止本地服务，将本地 Arena 数据目录移到站点目录以外的备份位置，然后重启服务、刷新页面。确认未登录且选手池为 0 后再扫码。不要清空整个博客附件目录或把本地重置操作用于线上。

## 2026-10-16 本地复测记录

在未修改登录流程代码的情况下，微信本人扫码已走通营地登录、读取和保存，返回 133 个英雄、17 个赛季、0 场最近对局。此结果仅证明当次本地流程成功，不代表已定位或修复其他用户的线上失败。

随后按用户要求，将本地两份档案移到站点目录外备份，重启本地服务清空内存会话，刷新确认未登录且选手池为 0，重新发起微信授权。微信再次成功，2026-10-16 16:09（Asia/Shanghai）新建文件，只有 1 次同步快照，返回 133 个英雄、17 个赛季、0 场最近对局，排除了读取旧档案的情况。

退出微信临时登录后，重新 QQ 扫码确认，营地验证、读取、文件保存均成功；16:12 新建文件，只有 1 次同步快照，返回 133 个英雄、24 个赛季、30 场最近对局。QQ 的 `qq-qr.mjs` 与 `camp-login.mjs` 均未修改。

上述真人验证完成后，仅在微信 provider 内补充了固定的阶段失败提示，区分扫码状态查询与确认后的营地登录，并区分营地限流等已知错误类别；没有改变签名、请求参数、轮询、交换和保存流程。增加了失败提示不暴露原始错误、404 不交换会话、停止旧流程后忽略异步结果的回归检查，当前共 28 项通过。其他用户线上失败尚未复现，不能据此宣称已修复线上问题。

/* 微信支付 v3（JSAPI）最小实现。
 *
 * 只做小程序需要的那几个接口，不引第三方库：
 *   1. 下单   POST /v3/pay/transactions/jsapi
 *   2. 查单   GET  /v3/pay/transactions/out-trade-no/{out_trade_no}
 *   3. 回调解密（notify）
 *
 * 需要的配置（两种填法，任选其一，程序优先读环境变量）：
 *   ① 云开发控制台 → 云函数 → api → 版本与配置 → 配置 → 环境变量
 *   ② 直接写到 cloudfunctions/api/pay.local.json（该文件已在 .gitignore 里，
 *      不会进 GitHub；部署时随代码一起上传，最省事）
 * 需要的四个值：
 *   MCH_ID            商户号，10 位，例如 1006630484
 *   MCH_SERIAL_NO     商户 API 证书的序列号（32 位十六进制，证书详情里有）
 *   MCH_PRIVATE_KEY   商户 API 证书私钥 apiclient_key.pem 的内容，整段原样粘贴；
 *                     也可以粘贴该文件的 base64，本文件会自动识别
 *   API_V3_KEY        APIv3 密钥（32 位，商户平台「API安全 → 解密回调」里设的那个）
 *   PAY_APPID         小程序 AppID，不填则用 wx37e1073cc15df404
 *   PAY_NOTIFY_URL    支付结果回调地址（可选）。云开发没有公网地址时留空，
 *                     前端支付成功后由 confirmPay 主动查单
 *
 * 安全约定：私钥、密钥只在云函数里读，绝不写进代码仓库（pay.local.json 已在 .gitignore）。
 */
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

const HOST = 'api.mch.weixin.qq.com';
const LOCAL_FILE = path.join(__dirname, '..', 'pay.local.json');

let LOCAL_CACHE = null;

function local() {
  if (LOCAL_CACHE !== null) return LOCAL_CACHE;
  try {
    LOCAL_CACHE = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
  } catch (e) {
    LOCAL_CACHE = {};
  }
  return LOCAL_CACHE;
}

/* 环境变量优先，其次读同目录的 pay.local.json（大小写都认） */
function env(name) {
  const fromEnv = String(process.env[name] || '').trim();
  if (fromEnv) return fromEnv;
  const obj = local();
  const v = obj[name] || obj[name.toLowerCase()] || '';
  return String(v || '').trim();
}

/* 私钥三种给法：整段 PEM 字符串 / PEM 的 base64 / 文件名（文件放在 cloudfunctions/api/ 下） */
function privateKey() {
  const direct = env('MCH_PRIVATE_KEY');
  if (direct) return direct;
  const fileName = env('MCH_PRIVATE_KEY_FILE');
  if (!fileName) return '';
  try {
    return fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
  } catch (e) {
    return '';
  }
}

function config() {
  return {
    appid: env('PAY_APPID') || 'wx37e1073cc15df404',
    mchid: env('MCH_ID'),
    serial: env('MCH_SERIAL_NO'),
    key: env('API_V3_KEY'),
    privateKey: privateKey(),
    notifyUrl: env('PAY_NOTIFY_URL')
  };
}

/* 三样齐了才算配置好；缺一样就明确告诉调用方「没开通」，不要抛异常 */
function configured() {
  const c = config();
  return !!(c.mchid && c.serial && c.key && c.privateKey);
}

function missing() {
  const c = config();
  const out = [];
  if (!c.mchid) out.push('MCH_ID');
  if (!c.serial) out.push('MCH_SERIAL_NO');
  if (!c.key) out.push('API_V3_KEY');
  if (!c.privateKey) out.push('MCH_PRIVATE_KEY');
  return out;
}

/* 私钥允许两种贴法：整段 PEM，或 PEM 文件的 base64 */
function pem(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  if (v.indexOf('BEGIN') >= 0) return v.replace(/\\n/g, '\n');
  try {
    const text = Buffer.from(v, 'base64').toString('utf8');
    if (text.indexOf('BEGIN') >= 0) return text;
  } catch (e) {
    /* 落到原样返回 */
  }
  return v;
}

function nonce() {
  return crypto.randomBytes(16).toString('hex');
}

function sign(message) {
  const key = pem(config().privateKey);
  return crypto.createSign('RSA-SHA256').update(message, 'utf8').sign(key, 'base64');
}

/* 请求签名（微信支付 v3 的 Authorization 头） */
function authorization(method, urlPath, body) {
  const c = config();
  const ts = Math.floor(Date.now() / 1000);
  const n = nonce();
  const message = method + '\n' + urlPath + '\n' + ts + '\n' + n + '\n' + body + '\n';
  return (
    'WECHATPAY2-SHA256-RSA2048 mchid="' + c.mchid +
    '",nonce_str="' + n +
    '",signature="' + sign(message) +
    '",timestamp="' + ts +
    '",serial_no="' + c.serial + '"'
  );
}

function request(method, urlPath, body) {
  return new Promise(function (resolve) {
    const payload = body ? JSON.stringify(body) : '';
    let headers;
    try {
      headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'lanouxi-shop/1.4',
        Authorization: authorization(method, urlPath, payload)
      };
    } catch (e) {
      resolve({ status: 0, data: null, error: '签名失败：' + (e && e.message ? e.message : e) });
      return;
    }
    const req = https.request(
      { host: HOST, path: urlPath, method: method, headers: headers, timeout: 8000 },
      function (res) {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', function (chunk) { raw += chunk; });
        res.on('end', function () {
          let data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = { raw: raw }; }
          resolve({ status: res.statusCode, data: data });
        });
      }
    );
    req.on('timeout', function () { req.destroy(new Error('请求微信支付超时')); });
    req.on('error', function (e) {
      resolve({ status: 0, data: null, error: e && e.message ? e.message : String(e) });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/* 小程序端 wx.requestPayment 要的参数 */
function payParams(prepayId) {
  const c = config();
  const ts = String(Math.floor(Date.now() / 1000));
  const n = nonce();
  const pkg = 'prepay_id=' + prepayId;
  const message = c.appid + '\n' + ts + '\n' + n + '\n' + pkg + '\n';
  return {
    timeStamp: ts,
    nonceStr: n,
    package: pkg,
    signType: 'RSA',
    paySign: sign(message)
  };
}

/* 统一下单：金额由服务端给（分），前端改不了 */
async function jsapi(payload) {
  if (!configured()) {
    return { ok: false, configured: false, missing: missing(), msg: '支付还没开通（云函数缺环境变量：' + missing().join('、') + '）' };
  }
  const c = config();
  const body = {
    appid: c.appid,
    mchid: c.mchid,
    description: String(payload.description || '兰欧茜校服').slice(0, 120),
    out_trade_no: String(payload.outTradeNo || ''),
    amount: { total: payload.amountFen, currency: 'CNY' },
    payer: { openid: payload.openid }
  };
  if (c.notifyUrl) body.notify_url = c.notifyUrl;
  if (payload.attach) body.attach = String(payload.attach).slice(0, 120);

  const r = await request('POST', '/v3/pay/transactions/jsapi', body);
  if (r.status !== 200 || !r.data || !r.data.prepay_id) {
    const detail = r.data && (r.data.message || r.data.code) ? r.data.message || r.data.code : (r.error || ('HTTP ' + r.status));
    return { ok: false, configured: true, msg: '下单失败：' + detail, detail: r.data || null };
  }
  return { ok: true, configured: true, prepayId: r.data.prepay_id, payParams: payParams(r.data.prepay_id) };
}

/* 主动查单：前端支付成功后调它确认，不依赖公网回调 */
async function query(outTradeNo) {
  if (!configured()) {
    return { ok: false, configured: false, missing: missing(), msg: '支付还没开通' };
  }
  const c = config();
  const urlPath = '/v3/pay/transactions/out-trade-no/' + encodeURIComponent(outTradeNo) + '?mchid=' + c.mchid;
  const r = await request('GET', urlPath, null);
  if (r.status !== 200 || !r.data) {
    const detail = r.data && (r.data.message || r.data.code) ? r.data.message || r.data.code : (r.error || ('HTTP ' + r.status));
    return { ok: false, configured: true, msg: '查单失败：' + detail };
  }
  return {
    ok: true,
    configured: true,
    tradeState: r.data.trade_state,
    transactionId: r.data.transaction_id || '',
    amountFen: r.data.amount && r.data.amount.total ? r.data.amount.total : 0,
    payerOpenid: r.data.payer && r.data.payer.openid ? r.data.payer.openid : ''
  };
}

/* 回调报文解密（AES-256-GCM），notify 路由用得到 */
function decryptResource(resource) {
  const c = config();
  if (!c.key) return { ok: false, msg: '没有 APIv3 密钥' };
  try {
    const buf = Buffer.from(String(resource.ciphertext || ''), 'base64');
    const authTag = buf.slice(buf.length - 16);
    const data = buf.slice(0, buf.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(c.key, 'utf8'), Buffer.from(String(resource.nonce || ''), 'utf8'));
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(String(resource.associated_data || ''), 'utf8'));
    let out = decipher.update(data, null, 'utf8');
    out += decipher.final('utf8');
    return { ok: true, data: JSON.parse(out) };
  } catch (e) {
    return { ok: false, msg: '解密失败：' + (e && e.message ? e.message : e) };
  }
}

module.exports = {
  configured: configured,
  missing: missing,
  jsapi: jsapi,
  query: query,
  payParams: payParams,
  decryptResource: decryptResource,
  _config: config
};

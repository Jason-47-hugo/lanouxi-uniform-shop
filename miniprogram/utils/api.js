/* 页面统一调用入口：云端优先，云端不可用时退回本地 store。
 *
 * 为什么要这一层：
 *   - 页面不该知道「现在有没有云」，否则每页都要写 if/else
 *   - 云端一旦可用，价格、库存、权限都由云函数说了算，前端改 JS 改不动
 *   - 网页演示版 / 没开通云开发的机器照样能点完整流程
 *
 * 约定：所有函数都返回 Promise，结果形状统一为
 *   { ok: true, ...数据 }  或  { ok: false, msg: '给人看的中文原因' }
 *
 * 只在「云函数根本没部署 / 网络断了」时退回本地；
 * 业务错误（库存不足、不是你的订单、没权限）一律原样返回，不许偷偷本地下一单。
 */

const cloudApi = require('./cloud');
const store = require('./store');

/* 云端调用失败且属于「连不上」类，才允许退回本地 */
function isTransportError(r) {
  if (!r || r.ok) return false;
  const msg = String(r.msg || '');
  return (
    msg.indexOf('调用云端失败') >= 0 ||
    msg.indexOf('还没接云端') >= 0 ||
    msg.indexOf('云端返回格式不对') >= 0 ||
    msg.indexOf('function not found') >= 0 ||
    msg.indexOf('FUNCTION_NOT_FOUND') >= 0 ||
    msg.indexOf('Environment not found') >= 0 ||
    msg.indexOf('-501000') >= 0 ||
    msg.indexOf('cloud function not found') >= 0
  );
}

/* 调云端；连不上就执行 fallback()，业务错误原样抛出 */
function withFallback(action, data, fallback) {
  if (!cloudApi.ready()) {
    return Promise.resolve().then(fallback);
  }
  return cloudApi.call(action, data).then(function (r) {
    if (isTransportError(r)) {
      if (typeof console !== 'undefined') {
        console.warn('[api] 云端不可用，本次走本地：' + (r.msg || ''));
      }
      return fallback();
    }
    return r;
  }).catch(function (e) {
    /* 云端抛异常（比如 callFunction 自身 reject）也退回本地，不能让页面白掉 */
    if (typeof console !== 'undefined') {
      console.warn('[api] 云端异常，本次走本地：' + (e && e.message));
    }
    return Promise.resolve().then(fallback);
  });
}

function ok(res) {
  return Promise.resolve(res);
}

/* ---------- 商品 / 用户 ---------- */

function products() {
  return withFallback('products', {}, function () {
    return { ok: true, list: store.allProducts(), from: 'local' };
  }).then(function (r) {
    /* 云端 products 直接返回数组，这里统一成 {ok, list}，页面只认一种形状 */
    const out = Array.isArray(r) ? { ok: true, list: r, from: 'cloud' }
      : (r && r.ok && !r.list && Array.isArray(r.products) ? { ok: true, list: r.products, from: 'cloud' } : r);
    if (out && out.ok && !out.from) out.from = 'cloud';
    return out;
  });
}

function me() {
  return withFallback('me', {}, function () {
    return {
      ok: true,
      user: { points: store.points().available },
      member: store.member()
    };
  });
}

/* ---------- 买家侧 ---------- */

function createOrder(payload) {
  const p = payload || {};
  return withFallback(
    'createOrder',
    { items: p.items, delivery: p.delivery, address: p.address, usePoints: !!p.usePoints, remark: p.remark },
    function () {
      /* 本地版是同步的，包成 Promise 让上层代码只有一种写法 */
      return store.createOrder(p);
    }
  );
}

function pay(orderId) {
  return withFallback('pay', { orderId: orderId }, function () {
    return store.payOrder(orderId);
  });
}

/* 真实支付：服务端统一下单，返回 wx.requestPayment 需要的参数。
   云端没配商户号时返回 {ok:false, payReady:false}，页面提示到店付款。 */
function createPayment(orderId) {
  return withFallback('createPayment', { orderId: orderId }, function () {
    /* 本地演示版没有商户号：直接当作「演示支付」走通 */
    store.payOrder(orderId);
    return { ok: true, demo: true, payReady: false, msg: '演示版没有在线支付' };
  });
}

/* 付款后查单确认；演示版就是本地已付款 */
function confirmPay(orderId) {
  return withFallback('confirmPay', { orderId: orderId }, function () {
    const o = store.getOrder(orderId);
    return o ? { ok: true, order: o, demo: true } : { ok: false, msg: '订单不见了' };
  });
}

/* 店长手动标记已收款（家长到店付或转账） */
function markPaid(orderId) {
  return withFallback('markPaid', { orderId: orderId }, function () {
    return { ok: false, msg: '演示版不支持标记收款，联网后才有' };
  });
}

function cancel(orderId) {
  return withFallback('cancel', { orderId: orderId }, function () {
    return store.cancelOrder(orderId);
  });
}

function confirm(orderId) {
  return withFallback('confirm', { orderId: orderId }, function () {
    return store.confirmReceipt(orderId);
  });
}

function returnApply(orderId) {
  return withFallback('returnApply', { orderId: orderId }, function () {
    return store.requestReturn(orderId);
  });
}

function getOrder(orderId) {
  return withFallback('getOrder', { orderId: orderId }, function () {
    const o = store.getOrder(orderId);
    if (!o) return { ok: false, msg: '订单不存在' };
    return { ok: true, order: o };
  });
}

function listOrders(tab, opts) {
  const o = opts || {};
  const data = {
    tab: tab || 'all',
    all: !!o.all,
    includeDemo: !!o.includeDemo
  };
  if (o.limit) data.limit = o.limit;
  if (o.skip) data.skip = o.skip;
  return withFallback('listOrders', data, function () {
    /* 本地版没有分页：整份切一刀，让页面的「还有更多」逻辑两种模式都能跑 */
    const all = store.orderList(tab || 'all', { includeDemo: !!o.includeDemo });
    const skip = o.skip || 0;
    const limit = o.limit || all.length;
    return { ok: true, list: all.slice(skip, skip + limit), hasMore: skip + limit < all.length };
  });
}

/* ---------- 店长侧 ---------- */

function adminStats() {
  return withFallback('adminStats', {}, function () {
    return { ok: true, stats: store.adminStats(), basis: '本地演示数据' };
  });
}

/* 商品图上传到云存储，返回 fileID。
   本地模式没法上传（没有云存储），明确告诉调用方，别存个临时路径当图。 */
// 上传商品图：先压到 1080 宽、≤800KB，再传到云存储
// 小程序端拍的原图动辄 3–5MB，直接传会超时、也吃流量，所以先压再传。
const IMAGE_MAX = 900 * 1024;      // 压缩后仍超过就拒绝，不硬传
const IMAGE_WIDTH = 1080;

function compressImage(src) {
  return new Promise(function (resolve) {
    if (!wx.compressImage) return resolve(src);   // 老基础库直接传原图
    wx.compressImage({
      src: src,
      quality: 80,
      compressedWidth: IMAGE_WIDTH,
      success: function (r) { resolve(r.tempFilePath || src); },
      fail: function () { resolve(src); }
    });
  });
}

function fileSize(path) {
  return new Promise(function (resolve) {
    const fs = wx.getFileSystemManager && wx.getFileSystemManager();
    if (!fs || !fs.getFileInfo) return resolve(0);
    fs.getFileInfo({
      filePath: path,
      success: function (r) { resolve(r.size || 0); },
      fail: function () { resolve(0); }
    });
  });
}

function uploadImage(filePath, productId) {
  if (!cloudApi.ready()) {
    return Promise.resolve({ ok: false, msg: '联网后才能把图存到云端' });
  }
  if (!wx.cloud || !wx.cloud.uploadFile) {
    return Promise.resolve({ ok: false, msg: '这个基础库版本不支持上传图片' });
  }
  return compressImage(filePath)
    .then(function (path) {
      return fileSize(path).then(function (size) {
        if (size > IMAGE_MAX) {
          return { ok: false, msg: '这张图太大了（' + Math.round(size / 1024) + 'KB），换一张试试' };
        }
        const ext = (function () {
          const m = /\.(\w+)$/.exec(path || '');
          return m ? m[1].toLowerCase() : 'jpg';
        })();
        const name = 'products/' + (productId || 'x') + '-' + Date.now() + '.' + ext;
        return wx.cloud.uploadFile({ cloudPath: name, filePath: path }).then(function (res) {
          if (!res || !res.fileID) return { ok: false, msg: '上传失败' };
          return { ok: true, fileID: res.fileID, size: size };
        });
      });
    })
    .catch(function (e) {
      return { ok: false, msg: '上传失败：' + ((e && e.errMsg) || (e && e.message) || '未知原因') };
    });
}

function ship(orderId, company, no) {
  return withFallback('ship', { orderId: orderId, company: company, no: no }, function () {
    return store.ship(orderId, company, no);
  });
}

function setTracking(orderId, company, no) {
  return withFallback('setTracking', { orderId: orderId, company: company, no: no }, function () {
    /* 演示版没有真实运单，说明一下别让人以为坏了 */
    return { ok: false, msg: '演示版不支持补单号，联网后才有' };
  });
}

function returnHandle(orderId, indices, reason) {
  return withFallback('returnHandle', { orderId: orderId, indices: indices, reason: reason }, function () {
    return store.applyReturn(orderId, indices, reason);
  });
}

function updateProduct(id, patch) {
  /* 云端按「扁平字段」取（payload.name/price/stock/image/onSale + payload.id），
     这里摊平一次，免得店长改完价本地看着成了、云端没动 */
  return withFallback('updateProduct', Object.assign({}, patch || {}, { id: id }), function () {
    return { ok: true, patch: store.updateProduct(id, patch) };
  });
}

/* ---------- 收货地址簿 ---------- */

function listAddresses() {
  return withFallback('listAddresses', {}, function () {
    return { ok: true, addresses: store.getAddresses() };
  });
}

function saveAddress(address) {
  return withFallback('saveAddress', { address: address }, function () {
    return store.saveAddress(address);
  });
}

function removeAddress(id) {
  return withFallback('removeAddress', { id: id }, function () {
    return store.removeAddress(id);
  });
}

function setDefaultAddress(id) {
  return withFallback('setDefaultAddress', { id: id }, function () {
    return store.setDefaultAddress(id);
  });
}

module.exports = {
  ready: cloudApi.ready,
  ENV_ID: cloudApi.ENV_ID,
  products: products,
  me: me,
  createOrder: createOrder,
  pay: pay,
  createPayment: createPayment,
  confirmPay: confirmPay,
  markPaid: markPaid,
  cancel: cancel,
  confirm: confirm,
  returnApply: returnApply,
  getOrder: getOrder,
  listOrders: listOrders,
  adminStats: adminStats,
  ship: ship,
  setTracking: setTracking,
  returnHandle: returnHandle,
  updateProduct: updateProduct,
  uploadImage: uploadImage,
  listAddresses: listAddresses,
  saveAddress: saveAddress,
  removeAddress: removeAddress,
  setDefaultAddress: setDefaultAddress,
  /* 本地才有的东西，页面继续直接用 store */
  store: store,
  _internal: { isTransportError: isTransportError, ok: ok }
};

/* 分派层：一个云函数、多个 action。
 *
 * 为什么只做一个云函数：部署时只要「右键 → 上传并部署」一次，
 * 少一步错一步，学生项目没必要拆成五个。
 *
 * 调用方式（小程序端）：
 *   wx.cloud.callFunction({ name: 'api', data: { action: 'createOrder', ... } })
 * 返回值统一是 { ok: true, ... } 或 { ok: false, msg: '给人看的中文原因' }。
 */

const S = require('./service');

const ACTIONS = {
  me: S.me,
  products: S.listProducts,
  createOrder: S.createOrder,
  pay: S.pay,
  payNotify: S.payNotify,
  createPayment: S.createPayment,
  confirmPay: S.confirmPay,
  markPaid: S.markPaid,
  payNotifyV3: S.payNotifyV3,
  cancel: S.cancel,
  confirm: S.confirm,
  returnApply: S.returnApply,
  ship: S.ship,
  setTracking: S.setTracking,
  returnHandle: S.returnHandle,
  updateProduct: S.updateProduct,
  syncProducts: S.syncProducts,
  claimAdmin: S.claimAdmin,
  getOrder: S.getOrder,
  listOrders: S.listOrders,
  adminStats: S.adminStats,
  cancelExpired: S.cancelExpired,
  listAddresses: S.listAddresses,
  saveAddress: S.saveAddress,
  removeAddress: S.removeAddress,
  setDefaultAddress: S.setDefaultAddress
};

async function isAdmin(ctx) {
  if (process.env.ADMIN_OPENIDS) {
    const list = process.env.ADMIN_OPENIDS.split(',').map(function (s) {
      return s.trim();
    });
    if (list.indexOf(ctx.openid) >= 0) return true;
  }
  const doc = await ctx.db.get('admins', ctx.openid);
  return !!doc;
}

async function handle(event, ctx) {
  const action = event && event.action;
  const fn = ACTIONS[action];
  if (!fn) {
    return { ok: false, msg: '没有这个操作：' + action };
  }
  ctx.isAdmin = await isAdmin(ctx);
  const started = Date.now();
  try {
    const res = await fn(ctx, event || {});
    res.ms = Date.now() - started;
    return res;
  } catch (e) {
    /* 云函数报错要让人看得懂，同时保留原始 message 方便查日志 */
    return {
      ok: false,
      msg: '服务器出错了：' + (e && e.message ? e.message : String(e))
    };
  }
}

module.exports = { handle: handle, ACTIONS: ACTIONS, isAdmin: isAdmin };

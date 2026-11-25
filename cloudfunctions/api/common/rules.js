/* 服务端权威规则。
 *
 * 为什么要有这个文件：小程序里 miniprogram/utils/store.js 的那套算法跑在用户手机上，
 * 用户改了内存就能改价。这里的每条规则都和 store.js 逐一对应，但**只有这里的输出会落库**。
 * 前端传上来的 price、amount、discount 一律忽略，只信 productId / color / size / qty。
 *
 * 纯函数，不碰数据库、不 require 任何云 SDK —— 这样才能在本地用 node 直接测。
 */

const POINTS_PER_YUAN = 100; // 100 积分 = 1 元
const NEW_USER_POINTS = 500; // 新客礼
const MAX_DISCOUNT_RATE = 0.05; // 每单最多抵「商品金额 − 会员折扣」的 5%
const MEMBER_THRESHOLD = 1200; // 累计消费满 1200 元成为会员
const MEMBER_RATE = 0.96; // 会员 96 折
const FREE_SHIPPING = 50; // 快递满 50 包邮
const EXPRESS_FEE = 8; // 快递费

const STATUS = {
  pending_pay: { text: '待付款', hint: '微信支付，付完就安排' },
  paid: { text: '待发货', hint: '已付款，正在打包' },
  shipped: { text: '待收货', hint: '已发出，注意查收' },
  return_pending: { text: '退货申请中', hint: '店长正在处理，稍等一下' },
  done: { text: '已完成', hint: '感谢支持，欢迎再来' },
  cancelled: { text: '已取消', hint: '订单已取消' },
  refunded: { text: '已退货', hint: '货款已原路退回' }
};

/* 谁能把订单从哪个状态推到哪个状态。actions 是「买家」的，adminActions 是「店长」的。 */
const ACTIONS = {
  pay: { from: ['pending_pay'], to: 'paid', role: 'buyer' },
  cancel: { from: ['pending_pay'], to: 'cancelled', role: 'buyer' },
  confirm: { from: ['shipped'], to: 'done', role: 'buyer' },
  returnApply: { from: ['done'], to: 'return_pending', role: 'buyer' },
  ship: { from: ['paid'], to: 'shipped', role: 'admin' },
  returnHandle: { from: ['done', 'return_pending'], to: null, role: 'admin' }
};

function isMember(user) {
  return ((user && user.spent) || 0) >= MEMBER_THRESHOLD;
}

function yuan(n) {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/* 校验买家提交的商品行，只留 productId / color / size / qty。
 * 返回 { ok, items } 或 { ok:false, msg }。
 * 价格、库存、尺码都以服务端商品表为准。 */
function pickItems(rawItems, products) {
  const byId = {};
  products.forEach(function (p) {
    byId[p.id] = p;
  });
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return { ok: false, msg: '没有可以结算的商品' };
  }
  const items = [];
  for (let i = 0; i < rawItems.length; i += 1) {
    const raw = rawItems[i] || {};
    const p = byId[raw.productId];
    if (!p) return { ok: false, msg: '商品不存在：' + raw.productId };
    const qty = Math.max(1, parseInt(raw.qty, 10) || 1);
    if (qty > 99) return { ok: false, msg: '一次最多买 99 件' };
    if (Array.isArray(p.sizes) && p.sizes.length && raw.size && p.sizes.indexOf(raw.size) < 0) {
      return { ok: false, msg: p.short + ' 没有 ' + raw.size + ' 码' };
    }
    items.push({
      productId: p.id,
      name: p.name,
      image: p.image,
      color: raw.color || (p.colors && p.colors[0]) || '',
      size: raw.size || (p.sizes && p.sizes[0]) || '',
      price: p.price, // 服务端价格
      qty: qty
    });
  }
  return { ok: true, items: items };
}

function stockProblem(items, products) {
  const byId = {};
  products.forEach(function (p) {
    byId[p.id] = p;
  });
  const need = {};
  items.forEach(function (it) {
    need[it.productId] = (need[it.productId] || 0) + it.qty;
  });
  const ids = Object.keys(need);
  for (let i = 0; i < ids.length; i += 1) {
    const p = byId[ids[i]];
    if (!p) return '商品不存在：' + ids[i];
    if (typeof p.stock === 'number' && need[ids[i]] > p.stock) {
      return p.short + ' 只剩 ' + p.stock + ' 件';
    }
  }
  return '';
}

/* 算钱。全部用整数分以下的规则和 store.js 一致：
 *   商品金额 goods
 *   会员折扣 memberDiscount = round(goods × 4%)
 *   积分抵扣上限 = floor((goods − memberDiscount) × 5%)
 *   运费 = 自提 0；快递满 50 包邮，否则 8
 *   应付 = goods − memberDiscount − 积分抵扣 + 运费 */
function priceOrder(input) {
  const items = input.items;
  const user = input.user || { points: 0, spent: 0 };
  const delivery = input.delivery === 'pickup' ? 'pickup' : 'express';

  if (delivery === 'express') {
    const a = input.address || {};
    if (!a.name || !a.phone || !a.detail) {
      return { ok: false, msg: '请把收货人、电话和地址填完整' };
    }
    if (!/^1\d{10}$/.test(String(a.phone))) {
      return { ok: false, msg: '手机号看起来不对，检查一下' };
    }
  }

  const goods = items.reduce(function (sum, it) {
    return sum + it.price * it.qty;
  }, 0);

  const memberDiscount = isMember(user) ? Math.round(goods * (1 - MEMBER_RATE)) : 0;
  const maxDiscount = Math.floor((goods - memberDiscount) * MAX_DISCOUNT_RATE);
  const available = Math.max(0, parseInt(user.points, 10) || 0);

  let discount = 0;
  if (input.usePoints) {
    discount = Math.min(maxDiscount, Math.floor(available / POINTS_PER_YUAN));
  }
  const pointsUsed = discount * POINTS_PER_YUAN;
  if (pointsUsed > available) {
    return { ok: false, msg: '积分不够抵扣，少抵一点试试' };
  }

  const shipping = delivery === 'pickup' ? 0 : goods >= FREE_SHIPPING ? 0 : EXPRESS_FEE;
  const amount = Math.max(0, goods - memberDiscount - discount + shipping);

  return {
    ok: true,
    goods: goods,
    shipping: shipping,
    memberDiscount: memberDiscount,
    maxDiscount: maxDiscount,
    discount: discount,
    pointsUsed: pointsUsed,
    amount: amount,
    delivery: delivery
  };
}

/* 确认收货返积分：按实付商品金额（不含运费）取整。 */
function rewardOf(order) {
  const base = order.amount - order.shipping;
  return Math.max(0, Math.floor(base));
}

/* 退货怎么算钱：
 *   退款 = round(实付商品金额 × 退货商品金额 / 商品总金额)，运费不退
 *   这一单用掉的抵扣积分按同一比例退回
 *   已返的购物积分按「留下的金额」重算，多退少补 */
function refundPlan(order, indices) {
  const items = order.items || [];
  const picked = (indices || []).filter(function (i) {
    return i >= 0 && i < items.length && !(order.returnedItems || []).some(function (r) { return r.index === i; });
  });
  if (!picked.length) return { ok: false, msg: '先选要退的商品' };

  const returnedGoods = picked.reduce(function (a, i) {
    return a + items[i].price * items[i].qty;
  }, 0);
  if (returnedGoods <= 0) return { ok: false, msg: '退货金额不对' };

  const paidGoodsAll = order.amount - order.shipping;
  const refund = order.goods > 0 ? Math.round(paidGoodsAll * returnedGoods / order.goods) : 0;
  const pointsBack = order.goods > 0 ? Math.round((order.pointsUsed || 0) * returnedGoods / order.goods) : 0;

  const priorRefund = order.refundedAmount || 0;
  const keptGoods = Math.max(0, paidGoodsAll - priorRefund - refund);
  const newReward = order.rewardGranted ? Math.floor(keptGoods) : 0;
  const rewardDelta = order.rewardGranted ? newReward - (order.reward || 0) : 0;

  const returnedQty = picked.reduce(function (a, i) {
    return a + items[i].qty;
  }, 0);
  const totalQty = items.reduce(function (a, b) {
    return a + b.qty;
  }, 0);
  const afterReturnedQty = (order.returnedItems || []).reduce(function (a, r) {
    return a + r.qty;
  }, 0) + returnedQty;

  return {
    ok: true,
    picked: picked,
    returnedGoods: returnedGoods,
    refund: refund,
    pointsBack: pointsBack,
    newReward: newReward,
    rewardDelta: rewardDelta,
    status: afterReturnedQty >= totalQty ? 'refunded' : (order.status === 'return_pending' ? 'done' : order.status)
  };
}

function canDo(action, order, actor) {
  const rule = ACTIONS[action];
  if (!rule) return { ok: false, msg: '未知操作：' + action };
  if (rule.from.indexOf(order.status) < 0) {
    return { ok: false, msg: '当前状态是「' + (STATUS[order.status] || {}).text + '」，不能' + action };
  }
  if (rule.role === 'admin' && !actor.isAdmin) return { ok: false, msg: '只有店长能做这个操作' };
  if (rule.role === 'buyer' && actor.openid !== order.openid) return { ok: false, msg: '这不是你的订单' };
  return { ok: true };
}

module.exports = {
  POINTS_PER_YUAN: POINTS_PER_YUAN,
  NEW_USER_POINTS: NEW_USER_POINTS,
  MAX_DISCOUNT_RATE: MAX_DISCOUNT_RATE,
  MEMBER_THRESHOLD: MEMBER_THRESHOLD,
  MEMBER_RATE: MEMBER_RATE,
  FREE_SHIPPING: FREE_SHIPPING,
  EXPRESS_FEE: EXPRESS_FEE,
  STATUS: STATUS,
  ACTIONS: ACTIONS,
  isMember: isMember,
  yuan: yuan,
  pickItems: pickItems,
  stockProblem: stockProblem,
  priceOrder: priceOrder,
  rewardOf: rewardOf,
  refundPlan: refundPlan,
  canDo: canDo
};

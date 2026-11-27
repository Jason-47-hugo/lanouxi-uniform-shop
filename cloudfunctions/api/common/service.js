/* 业务层：所有「改数据」的入口都走这里。
 * 调用方（云函数 index.js）负责准备 ctx：
 *   ctx = { db, openid, now, isAdmin }
 * db 是一个极小的适配层（见 cloudfunctions/common/wxdb.js），
 * 这样同一套逻辑既能跑在云开发上，也能在本地用内存库测（tools/cloud-test.js）。
 */

const R = require('./rules');

const COLL = {
  users: 'users',
  products: 'products',
  orders: 'orders',
  admins: 'admins'
};

function orderId(now) {
  return 'o' + now + Math.floor(Math.random() * 1000);
}

function orderNo(now) {
  const d = new Date(now);
  const p = function (n) {
    return n < 10 ? '0' + n : '' + n;
  };
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function timeline(order, label, now) {
  order.timeline = (order.timeline || []).concat([{ label: label, time: now }]);
  order.updatedAt = now;
  return order;
}

function log(user, text, delta, ref, now) {
  user.pointsLog = (user.pointsLog || []).concat([{
    id: 'p' + now + Math.floor(Math.random() * 1000),
    text: text,
    delta: delta,
    ref: ref || '',
    time: now
  }]);
}

async function ensureUser(ctx) {
  const found = await ctx.db.get(COLL.users, ctx.openid);
  if (found) return found;
  const user = {
    _id: ctx.openid,
    nickname: '',
    points: R.NEW_USER_POINTS,
    spent: 0,
    createdAt: ctx.now,
    pointsLog: [{
      id: 'p-init',
      text: '新人见面礼',
      delta: R.NEW_USER_POINTS,
      ref: '',
      time: ctx.now
    }]
  };
  await ctx.db.add(COLL.users, user);
  return user;
}

async function saveUser(ctx, user) {
  const patch = {
    points: user.points,
    spent: user.spent,
    pointsLog: user.pointsLog || [],
    addresses: user.addresses || [],
    updatedAt: ctx.now
  };
  await ctx.db.update(COLL.users, user._id, patch);
  return user;
}

/* 只追加一条积分流水，绝不碰 points / spent 这两个已经被原子改过的字段。
 * 并发下「读用户 → 改 → 整份写回」会把别的请求刚加上的积分覆盖掉。 */
async function appendPointsLog(ctx, openid, text, delta, ref) {
  const u = await ctx.db.get(COLL.users, openid);
  if (!u) return;
  log(u, text, delta, ref, ctx.now);
  await ctx.db.update(COLL.users, openid, { pointsLog: u.pointsLog || [], updatedAt: ctx.now });
}

async function listProducts(ctx) {
  return ctx.db.find(COLL.products, {});
}

/* ---------------- 买家 ---------------- */

async function createOrder(ctx, payload) {
  /* 先把超时没付的单关掉，库存才还回来，不然有人抢到别人放弃的库存 */
  await trySweep(ctx);
  const products = await listProducts(ctx);
  if (!products.length) {
    return { ok: false, msg: '商品表是空的，先在云开发控制台导一份 products' };
  }
  const picked = R.pickItems(payload.items, products);
  if (!picked.ok) return picked;

  const bad = R.stockProblem(picked.items, products);
  if (bad) return { ok: false, msg: bad };

  const user = await ensureUser(ctx);
  const price = R.priceOrder({
    items: picked.items,
    user: user,
    delivery: payload.delivery,
    address: payload.address,
    usePoints: !!payload.usePoints
  });
  if (!price.ok) return price;

  /* 扣积分：交给数据库做「够才减」的原子判断，避免两个人同时抵用把积分抵成负数 */
  if (price.pointsUsed > 0) {
    const okPts = await ctx.db.incField(COLL.users, ctx.openid, 'points', -price.pointsUsed, price.pointsUsed);
    if (!okPts) return { ok: false, msg: '积分不够抵这么多了，稍后重试或关掉积分抵扣' };
  }

  /* 扣库存：同样是「够才减」。中途有一款被抢完，就把前面扣过的加回去。 */
  const need = {};
  picked.items.forEach(function (it) {
    need[it.productId] = (need[it.productId] || 0) + it.qty;
  });
  const took = [];
  for (const id of Object.keys(need)) {
    const okStock = await ctx.db.incField(COLL.products, id, 'stock', -need[id], need[id]);
    if (!okStock) {
      for (const back of took) {
        await ctx.db.incField(COLL.products, back.id, 'stock', back.qty, 0);
      }
      if (price.pointsUsed > 0) {
        await ctx.db.incField(COLL.users, ctx.openid, 'points', price.pointsUsed, 0);
      }
      const name = (products.filter(function (p) { return p.id === id; })[0] || {}).name || id;
      return { ok: false, msg: '「' + name + '」刚好被抢完了，换一款或稍后再试' };
    }
    took.push({ id: id, qty: need[id] });
  }

  const id = orderId(ctx.now);
  const order = {
    _id: id,
    id: id,
    no: orderNo(ctx.now),
    openid: ctx.openid,
    items: picked.items,
    goods: price.goods,
    shipping: price.shipping,
    memberDiscount: price.memberDiscount,
    discount: price.discount,
    pointsUsed: price.pointsUsed,
    amount: price.amount,
    reward: 0,
    rewardGranted: false,
    returnedItems: [],
    refundedAmount: 0,
    delivery: price.delivery,
    address: price.delivery === 'express' ? {
      name: payload.address.name,
      phone: String(payload.address.phone),
      detail: payload.address.detail
    } : null,
    remark: (payload.remark || '').slice(0, 200),
    status: 'pending_pay',
    createdAt: ctx.now,
    updatedAt: ctx.now,
    tracking: null,
    demo: !!payload.demo,
    timeline: [{ label: '订单已提交', time: ctx.now }]
  };
  await ctx.db.add(COLL.orders, order);
  /* 积分流水单独追加：points 已经在前面用原子自增改过了，
     这里只写流水和 spent，绝不能把旧的 points 值一起写回去 */
  const fresh = (await ctx.db.get(COLL.users, ctx.openid)) || user;
  if (price.pointsUsed > 0) {
    log(fresh, '积分抵现 ¥' + R.yuan(price.discount), -price.pointsUsed, id, ctx.now);
  }
  await ctx.db.update(COLL.users, ctx.openid, { pointsLog: fresh.pointsLog || [], updatedAt: ctx.now });
  return { ok: true, order: order };
}

async function getOwnOrder(ctx, orderId) {
  const order = await ctx.db.get(COLL.orders, orderId);
  if (!order) return { ok: false, msg: '订单不存在' };
  if (order.openid !== ctx.openid && !ctx.isAdmin) return { ok: false, msg: '这不是你的订单' };
  return { ok: true, order: order };
}

/* 演示环境：直接把订单置为已付款。
 * 真实环境：这里返回微信支付的统一下单参数，状态等 payNotify 回调来改。 */
async function pay(ctx, payload) {
  const got = await getOwnOrder(ctx, payload.orderId);
  if (!got.ok) return got;
  const order = got.order;
  const guard = R.canDo('pay', order, { openid: ctx.openid, isAdmin: ctx.isAdmin });
  if (!guard.ok) return guard;
  if (payload.mock === false) {
    return { ok: false, msg: '还没接商户号：真实支付要先在云函数里调统一下单' };
  }
  order.status = 'paid';
  timeline(order, '微信支付成功（演示）', ctx.now);
  await ctx.db.update(COLL.orders, order._id, {
    status: order.status,
    updatedAt: order.updatedAt,
    timeline: order.timeline
  });
  return { ok: true, order: order };
}

/* 支付回调（幂等）：只有 pending_pay 才会被改成 paid */
async function payNotify(ctx, payload) {
  const order = await ctx.db.get(COLL.orders, payload.orderId);
  if (!order) return { ok: false, msg: '订单不存在' };
  if (order.status === 'paid') return { ok: true, order: order, duplicate: true };
  if (order.status !== 'pending_pay') return { ok: false, msg: '订单状态不是待付款' };
  order.status = 'paid';
  order.transactionId = payload.transactionId || '';
  timeline(order, '微信支付成功', ctx.now);
  await ctx.db.update(COLL.orders, order._id, {
    status: order.status,
    transactionId: order.transactionId,
    updatedAt: order.updatedAt,
    timeline: order.timeline
  });
  return { ok: true, order: order };
}

/* 真实支付：服务端统一下单。
 * 金额一律用订单里已经算好的 order.amount（前端传什么都不认），
 * 未配置商户号时返回 payReady:false，页面退回「到店付款」提示。 */
async function createPayment(ctx, payload) {
  const got = await getOwnOrder(ctx, payload.orderId);
  if (!got.ok) return got;
  const order = got.order;
  const guard = R.canDo('pay', order, { openid: ctx.openid, isAdmin: ctx.isAdmin });
  if (!guard.ok) return guard;

  const wp = ctx.wxpay || require('./wxpay');
  if (!wp.configured()) {
    return {
      ok: false,
      payReady: false,
      msg: '在线支付还没开通，可以先到店付款或转给店长',
      missing: wp.missing ? wp.missing() : []
    };
  }

  const outTradeNo = order.no || order._id;
  const amountFen = Math.round(Number(order.amount) * 100);
  if (!(amountFen > 0)) return { ok: false, msg: '订单金额不对，先刷新一下' };

  const first = order.items && order.items[0] ? order.items[0].name : '校服';
  const name = String(first).slice(0, 40);
  const r = await wp.jsapi({
    description: '兰欧茜校服·' + name,
    outTradeNo: outTradeNo,
    amountFen: amountFen,
    openid: ctx.openid,
    attach: order._id
  });
  if (!r.ok) return { ok: false, payReady: true, msg: r.msg };

  await ctx.db.update(COLL.orders, order._id, {
    pay: { outTradeNo: outTradeNo, prepayId: r.prepayId, at: ctx.now },
    updatedAt: ctx.now
  });
  return { ok: true, payReady: true, orderId: order._id, outTradeNo: outTradeNo, payParams: r.payParams };
}

/* 前端支付成功后主动查单确认（不依赖公网回调）。
 * 以微信侧的 trade_state 为准，金额必须和订单一致。 */
async function confirmPay(ctx, payload) {
  const got = await getOwnOrder(ctx, payload.orderId);
  if (!got.ok) return got;
  const order = got.order;
  if (order.status === 'paid') return { ok: true, order: order, already: true };

  const wp = ctx.wxpay || require('./wxpay');
  if (!wp.configured()) return { ok: false, payReady: false, msg: '在线支付还没开通' };

  const outTradeNo = (order.pay && order.pay.outTradeNo) || order.no || order._id;
  const q = await wp.query(outTradeNo);
  if (!q.ok) return { ok: false, msg: q.msg };
  if (q.tradeState !== 'SUCCESS') {
    return { ok: false, pending: true, tradeState: q.tradeState, msg: '还没收到付款' };
  }
  const expectFen = Math.round(Number(order.amount) * 100);
  if (q.amountFen && expectFen !== q.amountFen) {
    return { ok: false, msg: '付款金额对不上，请联系店长' };
  }

  order.status = 'paid';
  order.transactionId = q.transactionId || '';
  timeline(order, '微信支付成功', ctx.now);
  const won = await ctx.db.cas(COLL.orders, order._id, { status: 'pending_pay' }, {
    status: 'paid',
    transactionId: order.transactionId,
    updatedAt: order.updatedAt,
    timeline: order.timeline
  });
  if (!won) {
    const fresh = await ctx.db.get(COLL.orders, order._id);
    return { ok: true, order: fresh, already: true };
  }
  return { ok: true, order: order };
}

/* 店长手动标记已收款：家长到店付或微信转帐时用 */
async function markPaid(ctx, payload) {
  if (!ctx.isAdmin) return { ok: false, msg: '只有店长能标记收款' };
  const order = await ctx.db.get(COLL.orders, payload.orderId);
  if (!order) return { ok: false, msg: '订单不存在' };
  if (order.status !== 'pending_pay') return { ok: false, msg: '这单不是待付款状态' };
  order.status = 'paid';
  order.paidBy = 'admin';
  timeline(order, '店长标记已收款（到店付款/转账）', ctx.now);
  const won = await ctx.db.cas(COLL.orders, order._id, { status: 'pending_pay' }, {
    status: 'paid',
    paidBy: 'admin',
    updatedAt: order.updatedAt,
    timeline: order.timeline
  });
  if (!won) return { ok: false, msg: '这单刚被改过，刷新看看' };
  return { ok: true, orderId: order._id, order: order };
}

/* 支付回调路由（可选）：云开发有公网 HTTP 地址时，把微信回调接到这里 */
async function payNotifyV3(ctx, payload) {
  const wp = ctx.wxpay || require('./wxpay');
  const dec = wp.decryptResource ? wp.decryptResource(payload.resource || {}) : { ok: false, msg: '无法解密' };
  if (!dec.ok) return { ok: false, msg: dec.msg };
  const data = dec.data || {};
  const orderId = data.attach || '';
  const order = orderId ? await ctx.db.get(COLL.orders, orderId) : null;
  if (!order) return { ok: false, msg: '订单不存在' };
  if (data.trade_state !== 'SUCCESS') return { ok: true, ignored: true, tradeState: data.trade_state };
  if (order.status === 'paid') return { ok: true, order: order, duplicate: true };
  order.status = 'paid';
  order.transactionId = data.transaction_id || '';
  timeline(order, '微信支付成功（回调）', ctx.now);
  const won = await ctx.db.cas(COLL.orders, order._id, { status: 'pending_pay' }, {
    status: 'paid',
    transactionId: order.transactionId,
    updatedAt: order.updatedAt,
    timeline: order.timeline
  });
  return { ok: true, order: order, duplicate: !won };
}

async function cancel(ctx, payload) {
  const got = await getOwnOrder(ctx, payload.orderId);
  if (!got.ok) return got;
  const order = got.order;
  const guard = R.canDo('cancel', order, { openid: ctx.openid, isAdmin: ctx.isAdmin });
  if (!guard.ok) return { ok: false, msg: '已付款的订单请走退货' };

  /* 先抢状态：只有仍是待付款的这一单才轮到我关，抢不到说明别人已经关/付了 */
  timeline(order, '订单已取消', ctx.now);
  const won = await ctx.db.cas(COLL.orders, order._id, { status: 'pending_pay' }, {
    status: 'cancelled',
    updatedAt: order.updatedAt,
    timeline: order.timeline
  });
  if (!won) return { ok: false, msg: '这单状态刚变过，刷新看看' };

  /* 退回抵扣的积分 + 恢复库存（原子加减，不会和别的请求互相覆盖） */
  if (order.pointsUsed > 0) {
    await ctx.db.incField(COLL.users, order.openid, 'points', order.pointsUsed, 0);
    await appendPointsLog(ctx, order.openid, '积分抵现退回', order.pointsUsed, order._id);
  }
  for (const it of order.items) {
    await ctx.db.incField(COLL.products, it.productId, 'stock', it.qty, 0);
  }
  return { ok: true, order: order };
}

/* 超时未付款自动关单：每 10 分钟由定时触发器跑一次（见 config.json）。
 *
 * 为什么必须做：下单时就扣了库存和积分，如果家长拍下不付，
 * 衣服一直挂在「已占用」状态，别的家长买不到。30 分钟是店里能接受的时限
 * （开学季家长多半当场付，30 分钟够走开一会儿再回来）。
 */
const EXPIRE_MINUTES = 30;

/* 真正的关单逻辑，不带权限判断。
 * 两个入口共用：定时触发器（system）、以及任何一次下单/看订单时顺手扫一遍。
 * 为什么要有「顺手扫」这第二条路：微信云开发控制台没有「新建触发器」的按钮，
 * 触发器只能随 config.json 在开发者工具里上传时创建，cli 部署不会建。
 * 与其让关单靠一个可能没生效的触发器，不如让每次有人用的时候顺带扫一遍。 */
async function sweepExpired(ctx) {
  const list = await ctx.db.find(COLL.orders, { status: 'pending_pay' });
  const closed = [];
  for (const order of list) {
    if (!order.createdAt || ctx.now - order.createdAt < EXPIRE_MINUTES * 60 * 1000) continue;

    /* 两个入口可能同时扫到同一单：动手前重读一次，状态变了就跳过，
     * 免得积分退两遍、库存还两遍。 */
    const fresh = await ctx.db.get(COLL.orders, order._id);
    if (!fresh || fresh.status !== 'pending_pay') continue;

    /* 先抢状态（cas）：两个入口同时扫到同一单时只有一个能关成功，
     * 另一个 updated=0 直接跳过，积分不会退两遍、库存不会还两遍。 */
    order.status = 'cancelled';
    order.cancelReason = '超时未付款';
    timeline(order, '超时未付款，已自动关闭', ctx.now);
    const won = await ctx.db.cas(COLL.orders, order._id, { status: 'pending_pay' }, {
      status: order.status,
      cancelReason: order.cancelReason,
      updatedAt: ctx.now,
      timeline: order.timeline
    });
    if (!won) continue;

    /* 积分退回原主（注意：不是发起人，定时任务里没有 openid），原子加减 */
    if (order.pointsUsed > 0 && order.openid) {
      await ctx.db.incField(COLL.users, order.openid, 'points', order.pointsUsed, 0);
      await appendPointsLog(ctx, order.openid, '超时未付款，积分退回', order.pointsUsed, order._id);
    }

    /* 库存还回去 */
    for (const it of order.items || []) {
      await ctx.db.incField(COLL.products, it.productId, 'stock', it.qty, 0);
    }

    closed.push(order.id || order._id);
  }
  return { ok: true, count: closed.length, ids: closed, expireMinutes: EXPIRE_MINUTES };
}

async function cancelExpired(ctx) {
  if (!ctx.system && !ctx.isAdmin) {
    return { ok: false, msg: '这个动作只能由定时任务或店长触发' };
  }
  return sweepExpired(ctx);
}

/* 顺手关单：吞掉异常，绝不因为它把正常动作带崩 */
async function trySweep(ctx) {
  try {
    return await sweepExpired(ctx);
  } catch (e) {
    return { ok: false, count: 0, ids: [], msg: e && e.message };
  }
}

async function confirm(ctx, payload) {  const got = await getOwnOrder(ctx, payload.orderId);
  if (!got.ok) return got;
  const order = got.order;
  const guard = R.canDo('confirm', order, { openid: ctx.openid, isAdmin: ctx.isAdmin });
  if (!guard.ok) return guard;

  const reward = R.rewardOf(order);
  /* 先抢状态（cas）：连点两下「确认收货」也只会返一次积分 */
  order.status = 'done';
  order.reward = reward;
  order.rewardGranted = true;
  timeline(order, '已确认收货', ctx.now);
  const won = await ctx.db.cas(COLL.orders, order._id, { status: 'shipped' }, {
    status: order.status,
    reward: order.reward,
    rewardGranted: true,
    updatedAt: order.updatedAt,
    timeline: order.timeline
  });
  if (!won) return { ok: false, msg: '这单刚被确认过，刷新看看' };

  await ensureUser(ctx);
  if (reward > 0) {
    await ctx.db.incField(COLL.users, order.openid, 'points', reward, 0);
    await appendPointsLog(ctx, order.openid, '购物返积分', reward, order._id);
  }
  await ctx.db.incField(COLL.users, order.openid, 'spent', order.goods, 0);
  return { ok: true, order: order, reward: reward };
}

async function returnApply(ctx, payload) {
  const got = await getOwnOrder(ctx, payload.orderId);
  if (!got.ok) return got;
  const order = got.order;
  const guard = R.canDo('returnApply', order, { openid: ctx.openid, isAdmin: ctx.isAdmin });
  if (!guard.ok) return { ok: false, msg: '确认收货后才能申请退货' };
  order.status = 'return_pending';
  timeline(order, '买家申请退货', ctx.now);
  const won = await ctx.db.cas(COLL.orders, order._id, { status: 'done' }, {
    status: order.status,
    updatedAt: order.updatedAt,
    timeline: order.timeline
  });
  if (!won) return { ok: false, msg: '这单状态刚变过，刷新看看' };
  return { ok: true, order: order };
}

/* ---------------- 店长 ---------------- */

async function ship(ctx, payload) {
  const got = await getOwnOrder(ctx, payload.orderId);
  if (!got.ok) return got;
  const order = got.order;
  const guard = R.canDo('ship', order, { openid: ctx.openid, isAdmin: ctx.isAdmin });
  if (!guard.ok) return guard;
  const company = String(payload.company || '').slice(0, 20);
  const no = String(payload.no || '').slice(0, 40);
  if (!company) return { ok: false, msg: '填一下快递公司' };
  order.status = 'shipped';
  order.tracking = { company: company, no: no };
  timeline(order, '已发货 · ' + company + (no ? ' ' + no : ''), ctx.now);
  const won = await ctx.db.cas(COLL.orders, order._id, { status: 'paid' }, {
    status: order.status,
    tracking: order.tracking,
    updatedAt: order.updatedAt,
    timeline: order.timeline
  });
  if (!won) return { ok: false, msg: '这单状态刚变过（可能已经发过货），刷新看看' };
  return { ok: true, order: order };
}

/* 补快递单号：批量发货时先不填单号，等快递员揽收后再补。
 * 只能改「已发货」的单，而且只能店长改。 */
async function setTracking(ctx, payload) {
  if (!ctx.isAdmin) return { ok: false, msg: '只有店长能改运单信息' };
  const order = await ctx.db.get(COLL.orders, payload.orderId);
  if (!order) return { ok: false, msg: '订单不存在' };
  if (order.status !== 'shipped') return { ok: false, msg: '只有已发货的订单能补单号' };
  const company = String(payload.company || '').trim();
  const no = String(payload.no || '').trim();
  if (!company) return { ok: false, msg: '先选是哪家快递' };
  if (!no) return { ok: false, msg: '单号还没填' };
  if (!/^[A-Za-z0-9-]{4,32}$/.test(no)) return { ok: false, msg: '单号看着不对，只能有字母、数字和横杠' };
  order.tracking = { company: company, no: no };
  timeline(order, '运单号已补：' + company + ' ' + no, ctx.now);
  await ctx.db.update(COLL.orders, order._id, {
    tracking: order.tracking,
    updatedAt: ctx.now,
    timeline: order.timeline
  });
  return { ok: true, order: order };
}

async function returnHandle(ctx, payload) {
  const order = await ctx.db.get(COLL.orders, payload.orderId);
  if (!order) return { ok: false, msg: '订单不存在' };
  const guard = R.canDo('returnHandle', order, { openid: ctx.openid, isAdmin: ctx.isAdmin });
  if (!guard.ok) return guard;

  const plan = R.refundPlan(order, payload.indices);
  if (!plan.ok) return plan;

  /* 先抢状态：同一单重复点「同意退货」不会退两次钱/积分 */
  const fromStatus = order.status;
  order.returnedItems = (order.returnedItems || []).concat(plan.picked.map(function (i) {
    return { index: i, name: order.items[i].name, qty: order.items[i].qty, price: order.items[i].price };
  }));
  order.refundedAmount = (order.refundedAmount || 0) + plan.refund;
  order.returnReason = String(payload.reason || '').slice(0, 200);
  order.reward = plan.newReward;
  order.status = plan.status;
  timeline(order, '已退货 ' + plan.picked.length + ' 项 · 退款 ¥' + R.yuan(plan.refund), ctx.now);
  const won = await ctx.db.cas(COLL.orders, order._id, { status: fromStatus }, {
    returnedItems: order.returnedItems,
    refundedAmount: order.refundedAmount,
    returnReason: order.returnReason,
    reward: order.reward,
    status: order.status,
    updatedAt: order.updatedAt,
    timeline: order.timeline
  });
  if (!won) return { ok: false, msg: '这单不在「退货处理中」了，刷新看看' };

  await ensureUser(ctx);
  if (plan.pointsBack > 0) {
    await ctx.db.incField(COLL.users, order.openid, 'points', plan.pointsBack, 0);
    await appendPointsLog(ctx, order.openid, '退货退回抵扣积分', plan.pointsBack, order._id);
  }
  if (plan.rewardDelta !== 0) {
    await ctx.db.incField(COLL.users, order.openid, 'points', plan.rewardDelta, 0);
    await appendPointsLog(ctx, order.openid,
      plan.rewardDelta > 0 ? '退货后积分补差' : '退货扣回购物积分', plan.rewardDelta, order._id);
  }
  await ctx.db.incField(COLL.users, order.openid, 'spent', -plan.returnedGoods, 0);
  return { ok: true, order: order, refund: plan.refund, pointsBack: plan.pointsBack };
}

/* 商品图只收两种值：
 *  - cloud://...  店长在手机上传到云存储后的 fileID
 *  - /images/x.png 打包在小程序里的占位图
 * 别的（http 外链、data:base64）一律不收：外链会失效，base64 能把文档撑爆。 */
function imageOk(v) {
  if (typeof v !== 'string' || !v) return false;
  if (v.length > 300) return false;
  if (/^cloud:\/\/[^\s]+$/.test(v)) return true;
  return /^\/images\/[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp)$/.test(v);
}

async function updateProduct(ctx, payload) {
  if (!ctx.isAdmin) return { ok: false, msg: '只有店长能改商品' };
  const patch = {};
  /* 表单里价格/库存都是字符串（input type=number），这里统一转数字再校验 */
  const price = Number(payload.price);
  const stock = Number(payload.stock);
  if (typeof payload.name === 'string' && payload.name.trim()) patch.name = payload.name.trim().slice(0, 40);
  if (isFinite(price) && price > 0) patch.price = Math.round(price * 100) / 100;
  if (isFinite(stock) && stock >= 0) patch.stock = Math.floor(stock);
  if (payload.image !== undefined && payload.image !== null && payload.image !== '') {
    if (!imageOk(payload.image)) return { ok: false, msg: '图片要是云存储里的图，或者小程序自带的图' };
    patch.image = payload.image;
  }
  /* 下架开关：网页版/小程序店长台都靠它，别只改本地 */
  if (typeof payload.onSale === 'boolean') patch.onSale = payload.onSale;
  if (!Object.keys(patch).length) return { ok: false, msg: '没有要改的字段' };
  patch.updatedAt = ctx.now;
  await ctx.db.update(COLL.products, payload.id, patch);
  return { ok: true, patch: patch };
}

/* 把 data/products.json（由 tools/export-products.js 生成、随云函数一起部署）
   一键同步到云数据库：有则更新价格/图片/尺码等，没有则新增；只增改不删。
   这样「改完 data.js → 跑导出 → 重新部署 → 调一次本 action」就能上架新品。 */
async function syncProducts(ctx, payload) {
  if (!ctx.isAdmin) return { ok: false, msg: '只有店长能同步商品表' };
  let list = [];
  try {
    list = require('../data/products.json');
  } catch (e) {
    return { ok: false, msg: '云函数里没有 data/products.json，先跑 node tools/export-products.js 再部署' };
  }
  if (!Array.isArray(list) || !list.length) return { ok: false, msg: '商品表是空的' };
  /* 云函数默认 3 秒超时，30 条一次干不完，所以支持分片：
     {action:'syncProducts', from:0, size:10} 一批，返回值里的 hasMore 为 true 就继续叫。 */
  const from = Math.max(0, parseInt((payload && payload.from) || 0, 10) || 0);
  const size = Math.min(20, Math.max(1, parseInt((payload && payload.size) || 10, 10) || 10));
  const slice = list.slice(from, from + size);
  let added = 0, updated = 0, skipped = 0, failed = 0;
  for (const p of slice) {
    if (!p || !p.id) { skipped++; continue; }
    const exist = await ctx.db.get(COLL.products, p.id);
    const doc = Object.assign({}, p);
    delete doc._id;
    try {
      if (exist) {
        /* 只覆盖「目录信息」，不动店长在后台改过的 stock 和 onSale */
        const patch = {
          name: doc.name, short: doc.short, school: doc.school, schoolShort: doc.schoolShort,
          stage: doc.stage, category: doc.category, price: doc.price, originalPrice: doc.originalPrice,
          image: doc.image, tags: doc.tags, colors: doc.colors, sizes: doc.sizes,
          fabric: doc.fabric, desc: doc.desc, sizeTip: doc.sizeTip,
          updatedAt: ctx.now
        };
        await ctx.db.update(COLL.products, p.id, patch);
        updated++;
      } else {
        await ctx.db.add(COLL.products, Object.assign({ _id: p.id }, doc, { updatedAt: ctx.now }));
        added++;
      }
    } catch (e) {
      failed++;
    }
  }
  const next = from + size;
  return {
    ok: true, total: list.length, from: from, size: size,
    added: added, updated: updated, skipped: skipped, failed: failed,
    hasMore: next < list.length, next: next
  };
}

/* 首次接手的店长：admins 一条记录都没有时，凭一次性口令把自己写进去。
   上线后集合非空，这个 action 就永远失败，等于自动关门。 */
async function claimAdmin(ctx, payload) {
  const token = payload && payload.token;
  const expect = process.env.ADMIN_CLAIM_TOKEN || 'lanouxi-2026';
  if (!token || token !== expect) return { ok: false, msg: '口令不对' };
  const all = await ctx.db.find(COLL.admins, {});
  if (all.length) return { ok: false, msg: '已经有店长账号了，不要重复认领' };
  await ctx.db.add(COLL.admins, { _id: ctx.openid, role: 'owner', createdAt: Date.now() });
  return { ok: true, openid: ctx.openid };
}

async function getOrder(ctx, payload) {
  const id = payload.orderId;
  if (!id) return { ok: false, msg: '缺少订单号' };
  const o = await ctx.db.get(COLL.orders, id);
  if (!o) return { ok: false, msg: '订单不存在' };
  /* 别人的订单不给看，店长除外 */
  if (o.openid !== ctx.openid && !ctx.isAdmin) {
    return { ok: false, msg: '这不是你的订单' };
  }
  return { ok: true, order: o };
}

/* 订单列表：支持分页（默认一页 20 单）。
 * 为什么必须分页：店长台原来一次拉全部，单量上到几百条时页面会卡、
 * 云函数返回值也会顶到 1MB 上限。 */
const PAGE_SIZE = 20;

const TABS = {
  all: null,
  pay: ['pending_pay'],
  ship: ['paid'],
  receive: ['shipped'],
  done: ['done', 'return_pending', 'refunded']
};

async function listOrders(ctx, payload) {
  await trySweep(ctx);
  const tab = payload.tab || 'all';
  if (!(tab in TABS)) return { ok: false, msg: '没有这个筛选：' + tab };
  const where = ctx.isAdmin && payload.all ? {} : { openid: ctx.openid };
  const keep = TABS[tab];
  if (keep) where.status = { in: keep };

  const limit = Math.min(Math.max(Number(payload.limit) || PAGE_SIZE, 1), 50);
  const skip = Math.max(Number(payload.skip) || 0, 0);
  const got = await ctx.db.find(COLL.orders, where, {
    orderBy: { field: 'createdAt', dir: 'desc' },
    skip: skip,
    limit: limit
  });
  const list = got.filter(function (o) { return payload.includeDemo ? true : !o.demo; });
  return { ok: true, list: list, skip: skip, limit: limit, hasMore: got.length === limit };
}

/* 店长台的数据看板：近 7 / 30 天的单量、销售额、客单价、热销款、退货率。
 * 口径写在返回值的 basis 里，免得下次有人把「销售额」当成「已收款」。 */
async function adminStats(ctx) {
  if (!ctx.isAdmin) return { ok: false, msg: '只有店长能看' };
  await trySweep(ctx);
  const orders = await ctx.db.find(COLL.orders, {}, { limit: 100 });
  const PAID = ['paid', 'shipped', 'done', 'return_pending', 'refunded'];
  const paidAmount = function (o) {
    return Math.max(0, o.amount - (o.refundedAmount || 0));
  };
  const pendingShip = orders.filter(function (o) { return o.status === 'paid'; }).length;
  const pendingReturn = orders.filter(function (o) { return o.status === 'return_pending'; }).length;

  const since = function (days) {
    return ctx.now - days * 24 * 60 * 60 * 1000;
  };
  const range = function (days) {
    const from = since(days);
    const rows = orders.filter(function (o) {
      return (o.createdAt || 0) >= from && PAID.indexOf(o.status) >= 0;
    });
    const revenue = rows.reduce(function (a, o) { return a + paidAmount(o); }, 0);
    return {
      days: days,
      orders: rows.length,
      revenue: revenue,
      avg: rows.length ? Math.round(revenue / rows.length) : 0
    };
  };

  /* 近 14 天按天汇总，前端画柱状图用 */
  const byDay = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(ctx.now - i * 24 * 60 * 60 * 1000);
    const key = d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) +
      '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
    const rows = orders.filter(function (o) {
      if (PAID.indexOf(o.status) < 0) return false;
      const t = new Date(o.createdAt || 0);
      const k = t.getFullYear() + '-' + (t.getMonth() + 1 < 10 ? '0' : '') + (t.getMonth() + 1) +
        '-' + (t.getDate() < 10 ? '0' : '') + t.getDate();
      return k === key;
    });
    byDay.push({
      date: key,
      orders: rows.length,
      revenue: rows.reduce(function (a, o) { return a + paidAmount(o); }, 0)
    });
  }

  /* 热销款：按件数排，取前五 */
  const counter = {};
  orders.forEach(function (o) {
    if (PAID.indexOf(o.status) < 0) return;
    (o.items || []).forEach(function (it) {
      const k = it.productId;
      if (!counter[k]) counter[k] = { productId: k, name: it.name, qty: 0, amount: 0 };
      counter[k].qty += it.qty;
      counter[k].amount += it.qty * it.price;
    });
  });
  const topProducts = Object.keys(counter)
    .map(function (k) { return counter[k]; })
    .sort(function (a, b) { return b.qty - a.qty; })
    .slice(0, 5);

  const paidCount = orders.filter(function (o) { return PAID.indexOf(o.status) >= 0; }).length;
  const returnedCount = orders.filter(function (o) {
    return (o.returnedItems || []).length > 0;
  }).length;
  const expired = orders.filter(function (o) {
    return o.status === 'cancelled' && o.cancelReason === '超时未付款';
  }).length;

  return {
    ok: true,
    stats: {
      pendingShip: pendingShip,
      pendingReturn: pendingReturn,
      total: orders.length,
      /* 只算真收过钱的单：取消/超时关掉的不算销售额，
         否则店长台顶上的「已收款」会把没付的钱也算进去 */
      revenue: orders.filter(function (o) {
        return PAID.indexOf(o.status) >= 0;
      }).reduce(function (a, b) { return a + paidAmount(b); }, 0),
      week: range(7),
      month: range(30),
      byDay: byDay,
      topProducts: topProducts,
      returnRate: paidCount ? Math.round((returnedCount / paidCount) * 1000) / 10 : 0,
      expired: expired,
      cancelled: orders.filter(function (o) { return o.status === 'cancelled'; }).length
    },
    basis: '销售额 = 实付金额 − 已退款；退货率 = 有退货记录的单 / 已付款的单；按当前这一页最多 100 单统计'
  };
}

async function me(ctx) {
  const user = await ensureUser(ctx);
  return {
    ok: true,
    user: { points: user.points, spent: user.spent, nickname: user.nickname || '', isMember: R.isMember(user) },
    openid: ctx.openid
  };
}

/* ---------- 收货地址簿 ----------
   地址存在 users 文档的 addresses 数组里，不单独建集合：
   一个人最多十个地址，跟着用户走，删用户就一起没了。
   规则照样放在服务端，前端只传原始字段。 */
const MAX_ADDRESS = 10;

function newAddrId(now) {
  return 'a' + now + Math.floor(Math.random() * 1000);
}

function normAddress(raw) {
  const a = raw || {};
  const name = String(a.name || '').trim();
  const phone = String(a.phone || '').trim();
  const detail = String(a.detail || '').trim();
  const tag = String(a.tag || '').trim().slice(0, 6);
  if (!name) return { ok: false, msg: '收货人姓名还没填' };
  if (name.length > 20) return { ok: false, msg: '姓名太长了吧' };
  if (!/^1\d{10}$/.test(phone)) return { ok: false, msg: '手机号要 11 位、1 开头' };
  if (detail.length < 6) return { ok: false, msg: '地址写详细点，起码到小区或门牌号' };
  if (detail.length > 120) return { ok: false, msg: '地址太长了，挑重点写' };
  return { ok: true, value: { name: name, phone: phone, detail: detail, tag: tag } };
}

function pickDefault(list, id) {
  let has = false;
  list.forEach(function (x) {
    if (x.isDefault) has = true;
  });
  if (!has && list.length) list[0].isDefault = true;
  if (id) list.forEach(function (x) { x.isDefault = x.id === id; });
  return list;
}

async function listAddresses(ctx) {
  const user = await ensureUser(ctx);
  const list = pickDefault((user.addresses || []).slice(), null);
  return { ok: true, addresses: list };
}

async function saveAddress(ctx, payload) {
  const parsed = normAddress(payload && payload.address);
  if (!parsed.ok) return parsed;
  const user = await ensureUser(ctx);
  const list = (user.addresses || []).slice();
  const wantId = payload && payload.address && payload.address.id;
  const makeDefault = !!(payload && payload.address && payload.address.isDefault);

  if (wantId) {
    const at = list.filter(function (x) { return x.id === wantId; })[0];
    if (!at) return { ok: false, msg: '这个地址不在你的地址簿里' };
    at.name = parsed.value.name;
    at.phone = parsed.value.phone;
    at.detail = parsed.value.detail;
    at.tag = parsed.value.tag;
    if (makeDefault) list.forEach(function (x) { x.isDefault = x.id === wantId; });
  } else {
    if (list.length >= MAX_ADDRESS) return { ok: false, msg: '地址最多存 ' + MAX_ADDRESS + ' 个，先删一个' };
    const item = {
      id: newAddrId(ctx.now),
      name: parsed.value.name,
      phone: parsed.value.phone,
      detail: parsed.value.detail,
      tag: parsed.value.tag,
      isDefault: makeDefault || list.length === 0
    };
    if (item.isDefault) list.forEach(function (x) { x.isDefault = false; });
    list.push(item);
  }

  pickDefault(list, null);
  user.addresses = list;
  await saveUser(ctx, user);
  return { ok: true, addresses: list };
}

async function removeAddress(ctx, payload) {
  const id = payload && payload.id;
  if (!id) return { ok: false, msg: '你要删哪个地址？' };
  const user = await ensureUser(ctx);
  const list = (user.addresses || []).filter(function (x) { return x.id !== id; });
  if (list.length === (user.addresses || []).length) return { ok: false, msg: '这个地址已经不在了' };
  pickDefault(list, null);
  user.addresses = list;
  await saveUser(ctx, user);
  return { ok: true, addresses: list };
}

async function setDefaultAddress(ctx, payload) {
  const id = payload && payload.id;
  const user = await ensureUser(ctx);
  const list = (user.addresses || []).slice();
  const at = list.filter(function (x) { return x.id === id; })[0];
  if (!at) return { ok: false, msg: '这个地址不在你的地址簿里' };
  pickDefault(list, id);
  user.addresses = list;
  await saveUser(ctx, user);
  return { ok: true, addresses: list };
}

module.exports = {
  COLL: COLL,
  ensureUser: ensureUser,
  listProducts: listProducts,
  claimAdmin: claimAdmin,
  getOrder: getOrder,
  createOrder: createOrder,
  pay: pay,
  payNotify: payNotify,
  createPayment: createPayment,
  confirmPay: confirmPay,
  markPaid: markPaid,
  payNotifyV3: payNotifyV3,
  cancel: cancel,
  confirm: confirm,
  returnApply: returnApply,
  ship: ship,
  setTracking: setTracking,
  returnHandle: returnHandle,
  updateProduct: updateProduct,
  syncProducts: syncProducts,
  listOrders: listOrders,
  adminStats: adminStats,
  me: me,
  cancelExpired: cancelExpired,
  EXPIRE_MINUTES: EXPIRE_MINUTES,
  listAddresses: listAddresses,
  saveAddress: saveAddress,
  removeAddress: removeAddress,
  setDefaultAddress: setDefaultAddress
};

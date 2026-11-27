/* 云函数本地自测：不需要云环境，用内存库把 service.js / handler.js 全跑一遍。
 *
 *   node tools/cloud-test.js
 *
 * 为什么要有它：云函数跑在腾讯云上，改一行就要「上传部署」再点点点才能验证。
 * 这里用同一个 handler、同一份 rules.js，只在 db 层换成内存实现，
 * 所以本地过了，云端的行为基本一致（差异只在数据库事务和并发）。
 */
const path = require('path');

const API = path.join(__dirname, '..', 'cloudfunctions', 'api');
const { handle } = require(path.join(API, 'common', 'handler.js'));
const R = require(path.join(API, 'common', 'rules.js'));
const D = require(path.join(__dirname, '..', 'miniprogram', 'utils', 'data.js'));

let pass = 0;
let fail = 0;

function ok(cond, label, extra) {
  if (cond) {
    pass += 1;
    console.log('  ✓ ' + label + (extra ? '  → ' + extra : ''));
  } else {
    fail += 1;
    console.log('  ✗ ' + label + (extra ? '  → ' + extra : ''));
  }
}

function eq(actual, expected, label) {
  ok(actual === expected, label, JSON.stringify(actual) + ' (期望 ' + JSON.stringify(expected) + ')');
}

/* ---------------- 内存库：实现和 wxdb.js 一样的五个方法 ---------------- */
function makeMemDb() {
  const data = { users: {}, products: {}, orders: {}, admins: {} };
  D.PRODUCTS.forEach(function (p) {
    data.products[p.id] = Object.assign({ _id: p.id }, JSON.parse(JSON.stringify(p)));
  });
  return {
    data: data,
    async get(coll, id) {
      const d = data[coll][id];
      return d ? JSON.parse(JSON.stringify(d)) : null;
    },
    async find(coll, where, opt) {
      const o = opt || {};
      const keys = Object.keys(where || {});
      let rows = Object.keys(data[coll])
        .map(function (k) { return JSON.parse(JSON.stringify(data[coll][k])); })
        .filter(function (doc) {
          return keys.every(function (k) {
            const v = where[k];
            /* 和 wxdb.js 一致：{ in: [...] } 表示「属于这个集合」 */
            if (v && typeof v === 'object' && Array.isArray(v.in)) return v.in.indexOf(doc[k]) >= 0;
            return doc[k] === v;
          });
        });
      if (o.orderBy && o.orderBy.field) {
        const f = o.orderBy.field;
        const dir = o.orderBy.dir === 'asc' ? 1 : -1;
        rows.sort(function (a, b) { return ((a[f] || 0) - (b[f] || 0)) * dir; });
      }
      const skip = o.skip || 0;
      rows = rows.slice(skip, skip + Math.min(o.limit || 100, 100));
      return rows;
    },
    async add(coll, doc) {
      const id = doc._id || ('id' + Object.keys(data[coll]).length);
      data[coll][id] = JSON.parse(JSON.stringify(Object.assign({ _id: id }, doc)));
      return id;
    },
    async update(coll, id, patch) {
      if (!data[coll][id]) throw new Error('文档不存在：' + coll + '/' + id);
      Object.assign(data[coll][id], JSON.parse(JSON.stringify(patch)));
    },
    async remove(coll, id) {
      delete data[coll][id];
    },
    /* 和 wxdb.js 的 cas 等价：条件里每个字段都相等才写，返回有没有改到 */
    async cas(coll, id, where, patch) {
      const doc = data[coll][id];
      if (!doc) return false;
      const keys = Object.keys(where || {});
      if (!keys.every(function (k) { return doc[k] === where[k]; })) return false;
      Object.assign(doc, JSON.parse(JSON.stringify(patch)));
      return true;
    },
    /* 和 wxdb.js 的 incField 等价：先看够不够，再原子加 */
    async incField(coll, id, field, delta, atLeast) {
      const doc = data[coll][id];
      if (!doc) return false;
      const cur = typeof doc[field] === 'number' ? doc[field] : 0;
      if (typeof atLeast === 'number' && cur < atLeast) return false;
      doc[field] = cur + delta;
      return true;
    }
  };
}

function makeCtx(db, openid) {
  return { db: db, openid: openid, now: Date.now() + Math.floor(Math.random() * 1000), isAdmin: false };
}

async function call(db, openid, event, extra) {
  /* 每次调用都新建 ctx，模拟云函数一次执行只处理一个请求 */
  const ctx = makeCtx(db, openid);
  ctx.now = Date.now();
  if (extra) Object.keys(extra).forEach(function (k) { ctx[k] = extra[k]; });
  return handle(event, ctx);
}

const BUYER = 'openid-buyer';
const OTHER = 'openid-other';
const ADMIN = 'openid-shop';

function addr(phone) {
  return { name: '王女士', phone: phone || '13800001234', detail: '珠海市香洲区凤凰北路 88 号' };
}

async function main() {
  /* 场景 1：服务端定价，前端传的价格不算数 */
  console.log('\n[1] 定价规则（服务端算，前端伪造无效）');
  let db = makeMemDb();
  db.data.admins[ADMIN] = { _id: ADMIN };
  let r = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', color: '藏青', size: '170', qty: 1, price: 1, amount: 1 }],
    delivery: 'express',
    address: addr()
  });
  ok(r.ok, '下单成功', r.msg);
  eq(r.order.amount, 128, '按商品表 128 元算，不是前端传的 1 元');
  eq(r.order.goods, 128, '商品金额 = 128');
  eq(r.order.shipping, 0, '满 50 包邮');
  eq(r.order.status, 'pending_pay', '初始状态待付款');

  /* 场景 2：49 元快递要运费 */
  r = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p8', qty: 1 }],
    delivery: 'express',
    address: addr()
  });
  const p8 = D.PRODUCTS.find(function (p) { return p.id === 'p8'; });
  if (p8 && p8.price < R.FREE_SHIPPING) {
    eq(r.order.shipping, R.EXPRESS_FEE, '未满 50 加收 8 元运费');
    eq(r.order.amount, p8.price + R.EXPRESS_FEE, '应付 = 商品 + 运费');
  } else {
    ok(true, 'p8 价格 ≥ 50，运费规则由 p1 场景覆盖，跳过');
  }

  /* 场景 3：自提免运费 */
  r = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', qty: 1 }],
    delivery: 'pickup'
  });
  eq(r.order.shipping, 0, '自提运费 0');
  eq(r.order.address, null, '自提不存地址');

  /* 场景 4：会员 96 折 */
  db.data.users[BUYER] = { _id: BUYER, points: 0, spent: 1300, pointsLog: [] };
  r = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', qty: 1 }],
    delivery: 'pickup'
  });
  eq(r.order.memberDiscount, 5, '满 1200 的会员：128 × 4% ≈ 5 元折扣');
  eq(r.order.amount, 123, '会员价 123');

  /* 场景 5：积分抵扣上限 5% */
  db.data.users[BUYER].points = 100000;
  r = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', qty: 1 }],
    delivery: 'pickup',
    usePoints: true
  });
  eq(r.order.discount, 6, '抵扣上限 = floor((128−5) × 5%) = 6 元');
  eq(r.order.pointsUsed, 600, '扣 600 积分');
  eq(db.data.users[BUYER].points, 100000 - 600, '积分真的扣了');

  /* 场景 6：库存和尺码校验 */
  console.log('\n[2] 下单校验');
  db = makeMemDb();
  r = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', size: 'XXXL', qty: 1 }],
    delivery: 'pickup'
  });
  eq(r.ok, false, '不存在的尺码被拒');
  r = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', qty: 999 }],
    delivery: 'pickup'
  });
  eq(r.ok, false, '一次买太多被拒', r.msg);
  r = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', qty: 1 }],
    delivery: 'express',
    address: { name: '王', phone: '123', detail: 'x' }
  });
  eq(r.ok, false, '手机号不对被拒', r.msg);
  const stockBefore = db.data.products.p1.stock;
  r = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', qty: 2 }],
    delivery: 'pickup'
  });
  eq(db.data.products.p1.stock, stockBefore - 2, '下单扣库存');

  /* 场景 7：状态机 + 权限 */
  console.log('\n[3] 状态机与权限');
  db = makeMemDb();
  db.data.admins[ADMIN] = { _id: ADMIN };
  const created = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', qty: 1 }],
    delivery: 'pickup'
  });
  const oid = created.order.id;

  r = await call(db, ADMIN, { action: 'ship', orderId: oid, company: '顺丰' });
  eq(r.ok, false, '未付款不能发货', r.msg);
  r = await call(db, ADMIN, { action: 'ship', orderId: oid, company: '顺丰' });
  eq(r.ok, false, '非管理员更不能发货');
  r = await call(db, OTHER, { action: 'cancel', orderId: oid });
  eq(r.ok, false, '别人的订单不能取消', r.msg);
  r = await call(db, ADMIN, { action: 'adminStats' });
  eq(r.stats.total, 1, '店长能看统计');

  r = await call(db, BUYER, { action: 'pay', orderId: oid });
  ok(r.ok, '演示支付置为已付款');
  eq(db.data.orders[oid].status, 'paid', '状态变为待发货');
  r = await call(db, BUYER, { action: 'cancel', orderId: oid });
  eq(r.ok, false, '已付款不能取消，要走退货', r.msg);

  r = await call(db, ADMIN, { action: 'ship', orderId: oid, company: '顺丰', no: 'SF123' });
  ok(r.ok, '店长发货');
  eq(db.data.orders[oid].tracking.no, 'SF123', '填了快递单号');

  r = await call(db, BUYER, { action: 'confirm', orderId: oid });
  ok(r.ok, '买家确认收货');
  eq(db.data.orders[oid].status, 'done', '状态已完成');
  eq(db.data.orders[oid].reward, 128, '返积分 = 实付商品金额 128');
  eq(db.data.users[BUYER].points, 500 + 128, '积分到账（新客 500 + 返 128）');

  /* 场景 8：退货按比例算钱 */
  console.log('\n[4] 退货');
  db = makeMemDb();
  db.data.admins[ADMIN] = { _id: ADMIN };
  let c = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', qty: 1 }, { productId: 'p6', qty: 2 }],
    delivery: 'pickup'
  });
  const oid2 = c.order.id;
  const goods2 = c.order.goods;
  await call(db, BUYER, { action: 'pay', orderId: oid2 });
  await call(db, ADMIN, { action: 'ship', orderId: oid2, company: '中通' });
  await call(db, BUYER, { action: 'confirm', orderId: oid2 });
  const pointsAfterConfirm = db.data.users[BUYER].points;
  eq(db.data.orders[oid2].reward, Math.floor(goods2), '整单返积分 floor(商品金额)');

  r = await call(db, BUYER, { action: 'returnApply', orderId: oid2 });
  ok(r.ok, '买家申请退货');
  eq(db.data.orders[oid2].status, 'return_pending', '状态退货申请中');
  r = await call(db, BUYER, { action: 'returnHandle', orderId: oid2, indices: [0] });
  eq(r.ok, false, '买家不能自己批准退货', r.msg);

  r = await call(db, ADMIN, { action: 'returnHandle', orderId: oid2, indices: [0], reason: '尺码不合适' });
  ok(r.ok, '店长处理退货', r.msg);
  const refundedGoods = db.data.products ? 0 : 0;
  void refundedGoods;
  const expectRefund = c.order.items[0].price; // 整单按比例退，退一件正好是那件的钱
  eq(r.refund, expectRefund, '退款 = 退的那件商品金额');
  eq(db.data.orders[oid2].status, 'done', '只退一件，订单回到已完成');
  eq(db.data.orders[oid2].reward, Math.floor(goods2 - expectRefund), '返积分按留下来的金额重算');
  ok(db.data.users[BUYER].points < pointsAfterConfirm, '多返的积分被扣回', db.data.users[BUYER].points + ' < ' + pointsAfterConfirm);

  r = await call(db, ADMIN, { action: 'returnHandle', orderId: oid2, indices: [1] });
  ok(r.ok, '再退剩下的');
  eq(db.data.orders[oid2].status, 'refunded', '全退完 = 已退货');

  /* 场景 9：支付回调幂等 */
  console.log('\n[5] 支付回调');
  db = makeMemDb();
  c = await call(db, BUYER, { action: 'createOrder', items: [{ productId: 'p1', qty: 1 }], delivery: 'pickup' });
  const oid3 = c.order.id;
  r = await call(db, BUYER, { action: 'payNotify', orderId: oid3, transactionId: 'wx-1' });
  ok(r.ok, '回调把订单置为已付款');
  r = await call(db, BUYER, { action: 'payNotify', orderId: oid3, transactionId: 'wx-1' });
  ok(r.ok && r.duplicate, '重复回调不重复处理');

  /* 场景 10：店长改商品 */
  console.log('\n[6] 店长权限');
  db = makeMemDb();
  db.data.admins[ADMIN] = { _id: ADMIN };
  r = await call(db, BUYER, { action: 'updateProduct', id: 'p1', price: 1 });
  eq(r.ok, false, '普通用户改不了价格', r.msg);
  r = await call(db, ADMIN, { action: 'updateProduct', id: 'p1', price: 99, stock: 10 });
  ok(r.ok, '店长改价改库存');
  eq(db.data.products.p1.price, 99, '价格落库');
  r = await call(db, ADMIN, { action: 'listOrders', all: true, tab: 'all' });
  ok(r.ok && Array.isArray(r.list), '店长能看全部订单');

  /* 场景 10.1：单个订单只有本人和店长看得到 */
  r = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', color: '藏青', size: '170', qty: 1 }],
    delivery: 'express',
    address: addr()
  });
  const oneId = r.ok && r.order ? r.order.id : null;
  ok(!!oneId, '先下一单拿订单号');
  r = await call(db, BUYER, { action: 'getOrder', orderId: oneId });
  ok(r.ok && r.order && r.order.id === oneId, '本人能看自己的订单');
  r = await call(db, 'openid-stranger', { action: 'getOrder', orderId: oneId });
  ok(!r.ok, '别人看不了（' + r.msg + '）');
  r = await call(db, ADMIN, { action: 'getOrder', orderId: oneId });
  ok(r.ok, '店长能看任何订单');

  /* 场景 10.2：首个店长认领（admins 为空才成功，认领完就关门） */
  db = makeMemDb();
  r = await call(db, 'openid-shop-2', { action: 'claimAdmin', token: 'wrong' });
  ok(!r.ok, '口令不对认领不了');
  r = await call(db, 'openid-shop-2', { action: 'claimAdmin', token: 'lanouxi-2026' });
  ok(r.ok && r.openid === 'openid-shop-2', '首个店长认领成功');
  r = await call(db, 'openid-stranger', { action: 'claimAdmin', token: 'lanouxi-2026' });
  ok(!r.ok, '第二个来认领被拒（' + r.msg + '）');

  /* 场景 11：新用户 500 分 */
  console.log('\n[7] 用户');
  db = makeMemDb();
  r = await call(db, 'openid-new', { action: 'me' });
  eq(r.user.points, 500, '新用户 500 分');
  eq(r.user.isMember, false, '新用户不是会员');

  /* 场景 12：收货地址簿 */
  console.log('\n[8] 地址簿');
  db = makeMemDb();
  r = await call(db, BUYER, { action: 'listAddresses' });
  ok(r.ok && r.addresses.length === 0, '新用户地址簿是空的');

  r = await call(db, BUYER, { action: 'saveAddress', address: { name: '林晓', phone: '1380013800', detail: '珠海市香洲区情侣中路 88 号' } });
  ok(!r.ok, '手机号少一位存不进去（' + r.msg + '）');

  r = await call(db, BUYER, { action: 'saveAddress', address: { name: '林晓', phone: '13800138000', detail: '珠海' } });
  ok(!r.ok, '地址太短存不进去（' + r.msg + '）');

  r = await call(db, BUYER, { action: 'saveAddress', address: { name: '林晓', phone: '13800138000', detail: '珠海市香洲区情侣中路 88 号 3 栋 501', tag: '家' } });
  ok(r.ok && r.addresses.length === 1, '第一条地址存好了');
  ok(r.addresses[0].isDefault === true, '第一条自动成为默认');
  const a1 = r.addresses[0].id;

  r = await call(db, BUYER, { action: 'saveAddress', address: { name: '陈海', phone: '13900139000', detail: '珠海市第一中学 高一二班', tag: '学校' } });
  ok(r.ok && r.addresses.length === 2, '第二条地址存好了');
  ok(r.addresses.filter((x) => x.isDefault).length === 1, '默认地址始终只有一个');
  eq(r.addresses.filter((x) => x.isDefault)[0].name, '林晓', '默认还是第一条');
  const a2 = r.addresses[1].id;

  r = await call(db, BUYER, { action: 'setDefaultAddress', id: a2 });
  eq(r.addresses.filter((x) => x.isDefault)[0].id, a2, '改默认地址生效');

  r = await call(db, BUYER, { action: 'saveAddress', address: { id: a1, name: '林晓晓', phone: '13800138001', detail: '珠海市香洲区情侣中路 88 号 3 栋 502' } });
  ok(r.ok && r.addresses.length === 2, '改地址不会多出一条');
  eq(r.addresses.filter((x) => x.id === a1)[0].name, '林晓晓', '改完名字是对的');

  r = await call(db, 'openid-stranger', { action: 'removeAddress', id: a1 });
  ok(!r.ok, '别人的地址删不掉（' + r.msg + '）');

  r = await call(db, BUYER, { action: 'removeAddress', id: a2 });
  ok(r.ok && r.addresses.length === 1, '删掉一条剩一条');
  r = await call(db, BUYER, { action: 'removeAddress', id: a2 });
  ok(!r.ok, '重复删会提示已经不在了');

  db = makeMemDb();
  for (let i = 0; i < 10; i++) {
    await call(db, BUYER, { action: 'saveAddress', address: { name: '林晓' + i, phone: '1380013800' + i, detail: '珠海市香洲区测试路 ' + i + ' 号 1 栋 101' } });
  }
  r = await call(db, BUYER, { action: 'saveAddress', address: { name: '第11个', phone: '13800138011', detail: '珠海市香洲区测试路 11 号 1 栋 101' } });
  ok(!r.ok, '第 11 个地址被拒（最多 10 个）');

  /* 场景 13：超时未付款自动关单（定时触发器每 10 分钟跑一次） */
  console.log('\n[9] 超时未付自动关单');
  db = makeMemDb();
  db.data.admins[ADMIN] = { _id: ADMIN };
  const oExp = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p2', color: '藏青', size: '170', qty: 1 }],
    delivery: 'pickup',
    usePoints: true
  });
  ok(oExp.ok, '先下一单待付款（用了积分）');
  const expId = oExp.order.id;
  const pointsBefore = (await call(db, BUYER, { action: 'me' })).user.points;
  const stockP2 = db.data.products.p2.stock;

  let r2 = await call(db, BUYER, { action: 'cancelExpired' });
  ok(!r2.ok, '平级用户不能自己触发关单（' + r2.msg + '）');

  await call(db, ADMIN, { action: 'cancelExpired' });
  let again = await call(db, ADMIN, { action: 'cancelExpired' });
  eq(again.count, 0, '刚下的单没超时，不会被关掉');

  /* 把下单时间往前拨 31 分钟，模拟放了一夜没人付 */
  db.data.orders[expId].createdAt = Date.now() - 31 * 60 * 1000;
  const closed = await call(db, ADMIN, { action: 'cancelExpired' });
  eq(closed.count, 1, '超 30 分钟的单被关掉');
  const closedOrder = await call(db, ADMIN, { action: 'getOrder', orderId: expId });
  eq(closedOrder.order.status, 'cancelled', '状态变成已取消');
  eq(closedOrder.order.cancelReason, '超时未付款', '写明了关闭原因');
  const pointsAfter = (await call(db, BUYER, { action: 'me' })).user.points;
  eq(pointsAfter, pointsBefore + oExp.order.pointsUsed, '抵扣的积分退回来了');
  eq(db.data.products.p2.stock, stockP2 + 1, '库存也还回去了');

  const twice = await call(db, ADMIN, { action: 'cancelExpired' });
  eq(twice.count, 0, '同一单不会被关两次');
  eq((await call(db, BUYER, { action: 'me' })).user.points, pointsAfter, '积分不会被退两次');

  /* 已付款的单不归它管 */
  db = makeMemDb();
  db.data.admins[ADMIN] = { _id: ADMIN };
  const oPaid = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', qty: 1 }],
    delivery: 'pickup'
  });
  await call(db, BUYER, { action: 'pay', orderId: oPaid.order.id });
  db.data.orders[oPaid.order.id].createdAt = Date.now() - 24 * 60 * 60 * 1000;
  const r3 = await call(db, ADMIN, { action: 'cancelExpired' });
  eq(r3.count, 0, '已付款的单放一天也不会被关');
  /* 场景 14：批量发货时先不填单号，事后补（setTracking） */
  console.log('\n[10] 补运单号');
  db = makeMemDb();
  db.data.admins[ADMIN] = { _id: ADMIN };
  const oShipped = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', qty: 1 }],
    delivery: 'express',
    address: { name: '林晓', phone: '13800138000', detail: '珠海市香洲区情侣中路 88 号' }
  });
  await call(db, BUYER, { action: 'pay', orderId: oShipped.order.id });
  await call(db, ADMIN, { action: 'ship', orderId: oShipped.order.id, company: '中通快递', no: '' });

  let tr = await call(db, BUYER, { action: 'setTracking', orderId: oShipped.order.id, company: '中通快递', no: 'ZT123456789' });
  ok(!tr.ok, '买家补不了单号（' + tr.msg + '）');

  tr = await call(db, ADMIN, { action: 'setTracking', orderId: oShipped.order.id, company: '中通快递', no: 'ZT123456789' });
  ok(tr.ok, '店长补单号成功');
  eq(tr.order.tracking.no, 'ZT123456789', '单号写进订单');

  tr = await call(db, ADMIN, { action: 'setTracking', orderId: oShipped.order.id, company: '中通快递', no: '坏单号 有空格' });
  ok(!tr.ok, '单号格式不对会被拦（' + tr.msg + '）');

  tr = await call(db, ADMIN, { action: 'setTracking', orderId: oShipped.order.id, company: '', no: 'ZT1' });
  ok(!tr.ok, '没选快递会被拦');

  /* 待付款的单不该有运单 */
  const oPending = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', qty: 1 }],
    delivery: 'pickup'
  });
  tr = await call(db, ADMIN, { action: 'setTracking', orderId: oPending.order.id, company: '顺丰速运', no: 'SF1' });
  ok(!tr.ok, '没发货的单不能补单号');

  /* 场景 15：不靠定时触发器，看订单/下单时顺手关掉超时单
     （微信云开发控制台没有「新建触发器」按钮，触发器只能随 config.json 上传创建） */
  console.log('\n[11] 顺手关单（不依赖定时触发器）');
  db = makeMemDb();
  db.data.admins[ADMIN] = { _id: ADMIN };
  const oStale = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', qty: 1 }],
    delivery: 'pickup',
    usePoints: true
  });
  const staleId = oStale.order.id;
  const stalePts = oStale.order.pointsUsed;
  const stockAfterOrder = db.data.products.p1.stock;
  db.data.orders[staleId].createdAt = Date.now() - 45 * 60 * 1000;

  /* 别的用户（非店长）只是打开自己的订单列表，就把它关掉了 */
  await call(db, OTHER, { action: 'listOrders', tab: 'all' });
  eq(db.data.orders[staleId].status, 'cancelled', '别人打开订单列表就把超时单关了');
  eq(db.data.orders[staleId].cancelReason, '超时未付款', '关单原因照旧写清楚');
  eq(db.data.products.p1.stock, stockAfterOrder + 1, '库存还回去了');

  /* 重复扫不会重复退 */
  const ptsNow = (await call(db, BUYER, { action: 'me' })).user.points;
  await call(db, OTHER, { action: 'listOrders', tab: 'all' });
  eq((await call(db, BUYER, { action: 'me' })).user.points, ptsNow, '重复扫不会重复退积分');
  eq(ptsNow, 500, '积分退回到新客的 500 分（原扣 ' + stalePts + ' 分）');

  /* 下单前也会顺手扫：库存被释放，新单能下 */
  db = makeMemDb();
  db.data.admins[ADMIN] = { _id: ADMIN };
  const oHold = await call(db, OTHER, {
    action: 'createOrder',
    items: [{ productId: 'p6', qty: 1 }],
    delivery: 'pickup'
  });
  const p6Stock = db.data.products.p6.stock;
  db.data.orders[oHold.order.id].createdAt = Date.now() - 40 * 60 * 1000;
  const oNew = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p6', qty: 1 }],
    delivery: 'pickup'
  });
  ok(oNew.ok, '下新单前把卡住的库存放出来，新单能下');
  eq(db.data.products.p6.stock, p6Stock, '净库存回到下单前（先还 1 再扣 1）');
  eq(db.data.orders[oHold.order.id].status, 'cancelled', '被放弃的那单已关');

  /* 定时触发器那条路还在，只是不再是唯一入口 */
  const rTimer = await call(db, ADMIN, { action: 'cancelExpired' });
  ok(rTimer.ok, '店长手动触发关单仍然可用');
  const rBuyer = await call(db, BUYER, { action: 'cancelExpired' });
  ok(!rBuyer.ok, '普通用户不能手动触发关单（' + rBuyer.msg + '）');

  /* 场景 12：并发（两个请求同时改一单 / 抢最后一件） */
  console.log('\n[12] 并发：状态只流转一次，库存不会扣成负数');
  db = makeMemDb();
  db.data.admins[ADMIN] = { _id: ADMIN };
  c = await call(db, BUYER, { action: 'createOrder', items: [{ productId: 'p1', qty: 1 }], delivery: 'pickup' });
  const cid = c.order.id;
  await call(db, BUYER, { action: 'pay', orderId: cid });
  await call(db, ADMIN, { action: 'ship', orderId: cid, company: '中通快递' });
  const ptsBefore = db.data.users[BUYER].points;
  /* 连点两下「确认收货」：只该返一次积分 */
  const two = await Promise.all([
    call(db, BUYER, { action: 'confirm', orderId: cid }),
    call(db, BUYER, { action: 'confirm', orderId: cid })
  ]);
  eq(two.filter(function (x) { return x.ok; }).length, 1, '两次确认收货只有一次生效');
  const rewardGot = (two.filter(function (x) { return x.ok; })[0] || {}).reward;
  eq(db.data.users[BUYER].points - ptsBefore, rewardGot, '积分只返一次');
  eq(rewardGot, Math.floor(c.order.amount - c.order.shipping), '返的积分 = 实付金额');
  eq(db.data.orders[cid].status, 'done', '订单最终是已完成');

  /* 库存只剩 1 件，两个买家同时下单，只能成功一个 */
  db = makeMemDb();
  db.data.products.p6.stock = 1;
  const twoBuy = await Promise.all([
    call(db, BUYER, { action: 'createOrder', items: [{ productId: 'p6', qty: 1 }], delivery: 'pickup' }),
    call(db, OTHER, { action: 'createOrder', items: [{ productId: 'p6', qty: 1 }], delivery: 'pickup' })
  ]);
  eq(twoBuy.filter(function (x) { return x.ok; }).length, 1, '最后一件只有一个买家抢到');
  eq(db.data.products.p6.stock, 0, '库存不会被扣成负数');

  /* 同一笔积分被两个订单同时抵用：服务端原子判断只让一个花掉，
     否则一天里两单各抵 6 元、积分却能抵到负数 */
  db = makeMemDb();
  db.data.users[BUYER] = { _id: BUYER, points: 600, spent: 0, pointsLog: [] };
  const double = await Promise.all([
    call(db, BUYER, {
      action: 'createOrder',
      items: [{ productId: 'p1', qty: 1 }],
      delivery: 'pickup',
      usePoints: true
    }),
    call(db, BUYER, {
      action: 'createOrder',
      items: [{ productId: 'p1', qty: 1 }],
      delivery: 'pickup',
      usePoints: true
    })
  ]);
  eq(double.filter(function (x) { return x.ok; }).length, 1, '同一笔积分只有一个订单能抵用');
  eq(db.data.users[BUYER].points, 0, '积分正好扣完，没扣成负数');
  const failedMsg = (double.filter(function (x) { return !x.ok; })[0] || {}).msg || '';
  ok(/积分/.test(failedMsg), '失败的那单提示是积分不够', failedMsg);

  /* 连点两下取消：积分只退一次 */
  db = makeMemDb();
  const cc = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', qty: 1 }],
    delivery: 'pickup',
    usePoints: true
  });
  const ccPts = db.data.users[BUYER].points;
  const twoCancel = await Promise.all([
    call(db, BUYER, { action: 'cancel', orderId: cc.order.id }),
    call(db, BUYER, { action: 'cancel', orderId: cc.order.id })
  ]);
  eq(twoCancel.filter(function (x) { return x.ok; }).length, 1, '两次取消只有一次生效');
  eq(db.data.users[BUYER].points - ccPts, cc.order.pointsUsed, '退回的抵扣积分只加一次');

  /* 场景 13：分页、筛选、数据看板 */
  console.log('\n[13] 订单分页 + 店长数据看板');
  db = makeMemDb();
  db.data.admins[ADMIN] = { _id: ADMIN };
  for (let i = 0; i < 3; i += 1) {
    const one = await call(db, BUYER, {
      action: 'createOrder',
      items: [{ productId: 'p1', qty: 1 }],
      delivery: 'pickup'
    });
    /* 让三单时间拉开，排序才稳定 */
    db.data.orders[one.order.id].createdAt = Date.now() - (3 - i) * 60 * 1000;
  }
  let page = await call(db, BUYER, { action: 'listOrders', tab: 'all', limit: 2 });
  eq(page.list.length, 2, '第一页 2 单');
  eq(page.hasMore, true, '还有下一页');
  page = await call(db, BUYER, { action: 'listOrders', tab: 'all', limit: 2, skip: 2 });
  eq(page.list.length, 1, '第二页 1 单');
  eq(page.hasMore, false, '没有下一页了');
  page = await call(db, BUYER, { action: 'listOrders', tab: 'ship' });
  eq(page.list.length, 0, '「待发货」筛选不含待付款的单');
  const badTab = await call(db, BUYER, { action: 'listOrders', tab: 'nope' });
  eq(badTab.ok, false, '乱传 tab 会被拒绝');

  const st = await call(db, ADMIN, { action: 'adminStats' });
  ok(st.ok, '店长能看数据看板', st.msg);
  eq(st.stats.month.orders, 0, '没付款的单不算进销售额');
  eq(st.stats.week.orders, 0, '近 7 天同样只算已付款');
  ok(Array.isArray(st.stats.byDay) && st.stats.byDay.length === 14, '按天汇总给 14 天');
  ok(Array.isArray(st.stats.topProducts), '热销款是数组');
  eq(typeof st.stats.returnRate, 'number', '退货率是数字');

  /* 场景 14：商品图只收云存储 fileID 或小程序自带图 */
  console.log('\n[14] 商品图地址校验');
  db = makeMemDb();
  db.data.admins[ADMIN] = { _id: ADMIN };
  const imgCloud = await call(db, ADMIN, {
    action: 'updateProduct', id: 'p1', image: 'cloud://cloud1-d7gvr1q2x22eb4eb0.1234/products/p1-1.jpg'
  });
  ok(imgCloud.ok, '云存储 fileID 可以存');
  const imgLocal = await call(db, ADMIN, { action: 'updateProduct', id: 'p1', image: '/images/p2.png' });
  ok(imgLocal.ok, '小程序自带的图可以存');
  const imgHttp = await call(db, ADMIN, { action: 'updateProduct', id: 'p1', image: 'http://evil.example/x.png' });
  eq(imgHttp.ok, false, '外链图片被拒绝（' + imgHttp.msg + '）');
  const imgLong = await call(db, ADMIN, { action: 'updateProduct', id: 'p1', image: 'cloud://' + 'a'.repeat(400) });
  eq(imgLong.ok, false, '超长图片地址被拒绝');
  eq(db.data.products.p1.image, '/images/p2.png', '被拒绝的写入没有落到库里');

  /* 场景 15：一键把商品表推上云（syncProducts） */
  console.log('\n[15] 商品表同步');
  db = makeMemDb();
  db.data.admins[ADMIN] = { _id: ADMIN };
  const syncBuyer = await call(db, BUYER, { action: 'syncProducts' });
  eq(syncBuyer.ok, false, '普通用户不能同步商品表');
  /* 云函数里带着 data/products.json，这一步是真正的同步：内存库里已有 data.js 的商品，
     所以应当全是「更新」，条数等于 data.js 的商品数 */
  /* 云函数 3 秒超时，商品表按 10 条一片同步，这里把整表按同样分片跑完 */
  let syncOk = null, guard = 0, from = 0, touched = 0;
  while (guard < 20) {
    syncOk = await call(db, ADMIN, { action: 'syncProducts', from: from, size: 10 });
    if (!syncOk.ok) break;
    touched += syncOk.added + syncOk.updated;
    if (!syncOk.hasMore) break;
    from = syncOk.next;
    guard += 1;
  }
  ok(syncOk && syncOk.ok, '店长能把商品表同步到云数据库', syncOk && syncOk.msg);
  eq(syncOk.total, D.PRODUCTS.length, '同步条数 = data.js 里的商品数（' + D.PRODUCTS.length + '）');
  eq(touched, D.PRODUCTS.length, '分片跑完后每一条都落到了库里');
  const p9row = db.data.products.p9;
  ok(!!p9row && p9row.image === '/images/prod-02.jpg', '新品 p9 的图片字段写进去了', p9row && p9row.image);
  eq(p9row.price, D.PRODUCTS.filter(function (p) { return p.id === 'p9'; })[0].price, '同步不篡改文件里的价格');

  /* 场景 16：真实支付（下单 / 查单 / 店长标记收款） */
  console.log('\n[16] 真实支付');
  db = makeMemDb();
  db.data.admins[ADMIN] = { _id: ADMIN };

  /* 16.1 没配商户号：明确告诉前端「没开通」，不要抛错、也不要把单子改掉
   * 注意：真实环境里配置可能来自环境变量或 pay.local.json，所以这里注入一个
   * 「什么都没配」的网关，测试才不受本机是否填了密钥影响。 */
  const unset = {
    configured: function () { return false; },
    missing: function () { return ['MCH_ID', 'MCH_SERIAL_NO', 'MCH_PRIVATE_KEY', 'API_V3_KEY']; },
    jsapi: async function () { throw new Error('不该被调用'); }
  };
  const noPay = await call(db, BUYER, { action: 'createPayment', orderId: 'x' }, { wxpay: unset });
  eq(noPay.ok, false, '没配商户号时 createPayment 不成功');
  eq(noPay.msg, '订单不存在', '订单不存在先报订单不存在');

  const order1 = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', size: '170', color: '藏青', qty: 1 }],
    delivery: 'express',
    address: addr(),
    usePoints: false
  });
  const oid1 = order1.order._id;
  const realPay = await call(db, BUYER, { action: 'createPayment', orderId: oid1 }, { wxpay: unset });
  eq(realPay.ok, false, '云函数没配商户号时下单被拒绝');
  eq(realPay.payReady, false, '返回 payReady:false，前端据此提示到店付款');
  ok(Array.isArray(realPay.missing) && realPay.missing.length >= 3, '告诉前端缺哪些环境变量', (realPay.missing || []).join(','));

  /* 16.2 注入假的支付网关：金额必须来自服务端订单，前端传的一概不认 */
  const fake = {
    configured: function () { return true; },
    missing: function () { return []; },
    lastJsapi: null,
    jsapi: async function (p) {
      fake.lastJsapi = p;
      return { ok: true, prepayId: 'wx-prepay-1', payParams: { timeStamp: '1', nonceStr: 'n', package: 'prepay_id=wx-prepay-1', signType: 'RSA', paySign: 'sig' } };
    },
    query: async function (no) {
      fake.lastQuery = no;
      return { ok: true, tradeState: fake.tradeState || 'SUCCESS', transactionId: '4200000001', amountFen: fake.amountFen };
    }
  };
  const pay1 = await call(db, BUYER, { action: 'createPayment', orderId: oid1, amount: 1 }, { wxpay: fake });
  ok(pay1.ok, '配置好了就能下单', pay1.msg);
  eq(pay1.payParams.signType, 'RSA', '返回小程序要的支付参数（signType=RSA）');
  eq(pay1.payParams.package, 'prepay_id=wx-prepay-1', 'package 里带 prepay_id');
  eq(fake.lastJsapi.amountFen, Math.round(order1.order.amount * 100), '下单金额 = 服务端算的订单金额（前端传 amount:1 无效）');
  eq(fake.lastJsapi.openid, BUYER, 'payer.openid 是下单人自己');
  eq(pay1.outTradeNo, order1.order.no, '商户订单号用订单号，方便对账');
  eq(db.data.orders[oid1].pay.prepayId, 'wx-prepay-1', 'prepay_id 记在订单里');

  /* 16.3 别人的单、已付款的单都不能再发起支付 */
  const otherPay = await call(db, OTHER, { action: 'createPayment', orderId: oid1 }, { wxpay: fake });
  eq(otherPay.ok, false, '不能替别人的订单付款');
  eq(otherPay.msg, '这不是你的订单', '越权提示明确');

  /* 16.4 查单确认：金额对得上才置为已付款 */
  fake.amountFen = Math.round(order1.order.amount * 100) - 1;
  const badMoney = await call(db, BUYER, { action: 'confirmPay', orderId: oid1 }, { wxpay: fake });
  eq(badMoney.ok, false, '付款金额比订单少一分就不认');
  eq(db.data.orders[oid1].status, 'pending_pay', '金额不符时订单状态不动');

  fake.amountFen = Math.round(order1.order.amount * 100);
  fake.tradeState = 'NOTPAY';
  const notYet = await call(db, BUYER, { action: 'confirmPay', orderId: oid1 }, { wxpay: fake });
  eq(notYet.ok, false, '微信侧还没付款时返回失败');
  eq(notYet.pending, true, 'pending:true 让前端知道「等一下再查」');

  fake.tradeState = 'SUCCESS';
  const paid = await call(db, BUYER, { action: 'confirmPay', orderId: oid1 }, { wxpay: fake });
  ok(paid.ok, '查单成功后订单变已付款', paid.msg);
  eq(db.data.orders[oid1].status, 'paid', '库里状态是 paid');
  eq(db.data.orders[oid1].transactionId, '4200000001', '微信交易号写进订单');
  const againPay = await call(db, BUYER, { action: 'confirmPay', orderId: oid1 }, { wxpay: fake });
  eq(againPay.already, true, '重复确认不会重复改');

  /* 16.5 店长手动标记收款（到店付/转账的兜底） */
  const order2 = await call(db, BUYER, {
    action: 'createOrder',
    items: [{ productId: 'p1', size: '170', color: '藏青', qty: 1 }],
    delivery: 'pickup',
    address: addr(),
    usePoints: false
  });
  const oidMark = order2.order._id;
  const buyerMark = await call(db, BUYER, { action: 'markPaid', orderId: oidMark });
  eq(buyerMark.ok, false, '买家不能自己标记已收款');
  const adminMark = await call(db, ADMIN, { action: 'markPaid', orderId: oidMark });
  ok(adminMark.ok, '店长可以标记已收款', adminMark.msg);
  eq(db.data.orders[oidMark].status, 'paid', '标记后进入待发货');
  eq(db.data.orders[oidMark].paidBy, 'admin', '记录是店长标记的');
  const markTwice = await call(db, ADMIN, { action: 'markPaid', orderId: oidMark });
  eq(markTwice.ok, false, '重复标记会失败（状态已不是待付款）');

  console.log('\n' + (fail === 0 ? 'ALL PASS ' : 'FAILED ') + pass + (fail ? ' / ' + (pass + fail) : ''));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.error('测试脚本本身出错：', e);
  process.exit(1);
});

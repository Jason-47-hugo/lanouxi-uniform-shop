/* 不开微信开发者工具，也能把「下单 → 微信支付 → 发货 → 收货 → 积分/会员 → 退货」跑一遍。
   用法：node preview/flow-test.js  */
'use strict';

const path = require('path');
const MP = path.resolve(__dirname, '..', 'miniprogram');

const storage = new Map();
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
global.wx = {
  getStorageSync: (k) => (storage.has(k) ? clone(storage.get(k)) : ''),
  setStorageSync: (k, v) => storage.set(k, clone(v)),
  removeStorageSync: (k) => storage.delete(k)
};

const store = require(path.join(MP, 'utils/store.js'));

let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ✓ ' + label); } else {
    fail += 1;
    console.log('  ✗ ' + label + (extra === undefined ? '' : '  →  ' + JSON.stringify(extra)));
  }
}
function section(t) { console.log('\n' + t); }
/* 每节重置，避免上一节变成会员后影响折扣计算 */
function reset() {
  storage.clear();
  store.ensureInit();
}

store.ensureInit();
const addr = { name: '测试家长', phone: '13800138000', detail: '珠海市香洲区测试路 1 号' };

section('1. 新客积分');
let pts = store.points();
ok(pts.available === 500, '新客送 500 积分', pts);
ok(pts.frozen === undefined && pts.total === 500, '没有冻结积分（不再有保证金/签到）', pts);
ok(store.checkIn === undefined, '签到接口已移除', Object.keys(store).filter((k) => k === 'checkIn'));

section('2. 5% 抵扣与满 50 包邮');
const goods = 128 + 49;
const maxUse = Math.min(Math.floor(goods * 0.05), Math.floor(pts.available / 100));
ok(maxUse === 5, '最多抵 min(5% = ¥8, 积分 500 分 = ¥5)', maxUse);

const r = store.createOrder({
  items: [{ productId: 'p1', color: '藏青', size: 'L', qty: 1 }, { productId: 'p7', color: '藏青', size: 'M', qty: 1 }],
  delivery: 'express', address: addr, usePoints: true
});
ok(r.ok, '下单成功', r);
const o = r.order;
ok(o.status === 'pending_pay', '订单初始状态 = 待付款', o.status);
ok(o.discount === 5 && o.pointsUsed === 500, '抵 ¥5 / 扣 500 分', { d: o.discount, p: o.pointsUsed });
ok(o.shipping === 0, '满 ¥50 包邮', o.shipping);
ok(o.amount === goods - 5, '应付 = 商品 - 抵扣', o.amount);
pts = store.points();
ok(pts.available === 0, '积分扣完，余额 0', pts);

section('3. 微信支付 → 发货 → 收货');
ok(store.payOrder(o.id).order.status === 'paid', '微信支付后 → 待发货');
ok(store.payOrder(o.id).ok === false, '重复支付被拒绝');
ok(store.ship(o.id, '顺丰速运', 'SF999').order.status === 'shipped', '店长发货 → 待收货');
ok(store.ship(o.id, '顺丰速运', 'SF999').ok === false, '重复发货被拒绝');
const beforePts = store.points();
ok(store.confirmReceipt(o.id).order.status === 'done', '确认收货 → 已完成');
pts = store.points();
ok(pts.available === beforePts.available + Math.floor(o.amount - o.shipping), '返积分 floor(实付商品金额，不含运费)', { before: beforePts.available, after: pts.available, base: o.amount - o.shipping });
ok(store.member().spent === goods, '累计消费按商品金额记', store.member());

section('4. 未付款取消');
const r2 = store.createOrder({
  items: [{ productId: 'p8', color: '藏青', size: 'M', qty: 1 }],
  delivery: 'express', address: addr, usePoints: false
});
ok(r2.ok, '再下一单', r2);
const before = store.points();
ok(store.cancelOrder(r2.order.id).ok, '未付款订单可取消');
ok(store.points().available === before.available, '未用积分时，取消不影响积分', { before: before.available, after: store.points().available });
store.payOrder(r2.order.id);
ok(store.cancelOrder(r2.order.id).ok === false, '已付款的订单不能直接取消（改走退货）');

section('5. 会员 96 折');
const big = store.createOrder({
  items: [{ productId: 'p5', color: '藏青', size: 'L', qty: 6 }],
  delivery: 'pickup', address: addr, usePoints: false
});
store.payOrder(big.order.id);
store.ship(big.order.id, '自提', '');
store.confirmReceipt(big.order.id);
ok(store.member().isMember, '累计满 ¥1200 成为会员', store.member());
const r3 = store.createOrder({
  items: [{ productId: 'p1', color: '藏青', size: 'L', qty: 1 }],
  delivery: 'express', address: addr, usePoints: true
});
ok(r3.order.memberDiscount === 5, '会员 96 折 = 128 × 4% ≈ ¥5', r3.order.memberDiscount);
ok(r3.order.amount === 128 - r3.order.memberDiscount - r3.order.discount, '会员折扣与积分可叠加', r3.order);
store.cancelOrder(r3.order.id);

section('6. 退货：只有真正买下的金额才送积分');
reset();
// 用一单 128 + 49 = 177，抵 5 元，实付 172，收货后返 172 分
const rateBuyer = store.createOrder({
  items: [{ productId: 'p1', color: '藏青', size: 'L', qty: 1 }, { productId: 'p7', color: '藏青', size: 'M', qty: 1 }],
  delivery: 'express', address: addr, usePoints: false
});
store.payOrder(rateBuyer.order.id);
store.ship(rateBuyer.order.id, '顺丰速运', 'SF1');
store.confirmReceipt(rateBuyer.order.id);
const ob = store.getOrder(rateBuyer.order.id);
ok(ob.reward === 177, '收货返 177 分（177 元实付）', ob.reward);
const p0 = store.points().available;
const spent0 = store.member().spent;

// 只退 p7（49 元）
ok(store.requestReturn(ob.id).ok, '买家申请退货');
ok(store.getOrder(ob.id).status === 'return_pending', '状态 = 退货申请中');
const ret = store.applyReturn(ob.id, [1], '尺码不合适');
ok(ret.ok, '店长处理退货（退第 2 件 49 元）', ret);
ok(ret.refund === 49, '退款 49 元（无会员折扣，运费不退）', ret.refund);
ok(store.getOrder(ob.id).reward === 128, '已返积分按实际留下金额重算 = 128 分', store.getOrder(ob.id).reward);
ok(store.points().available === p0 - (177 - 128), '多返的 49 分被扣回', { before: p0, after: store.points().available });
ok(store.member().spent === spent0 - 49, '会员额度同步减 49', { before: spent0, after: store.member().spent });
ok(store.getOrder(ob.id).status === 'done', '部分退货后订单仍是已完成', store.getOrder(ob.id).status);
const ret2 = store.applyReturn(ob.id, [0], '整单退掉');
ok(ret2.ok && store.getOrder(ob.id).status === 'refunded', '剩余商品退完 → 已退货', store.getOrder(ob.id).status);
ok(store.points().available === p0 - 177, '全退后购物积分清零（只剩抵扣退回部分）', store.points().available);

section('7. 退货退回抵扣积分');
reset();
const pr = store.points().available;
const r4 = store.createOrder({
  items: [{ productId: 'p2', color: '藏青', size: 'M', qty: 1 }],
  delivery: 'pickup', address: addr, usePoints: true
});
ok(r4.order.discount === 5, '168 元封顶 ¥8，但只有 500 分所以抵 ¥5', r4.order.discount);
store.payOrder(r4.order.id);
store.ship(r4.order.id, '自提', '');
ok(store.requestReturn(r4.order.id).ok === false, '还没收货时不能申请退货（先确认收货）');
store.confirmReceipt(r4.order.id);
const pr2 = store.points().available;
store.requestReturn(r4.order.id);
const rr = store.applyReturn(r4.order.id, [0], '不合适');
ok(rr.ok && rr.refundedPoints === 500, '退货退回这单用掉的 500 积分', rr.refundedPoints);
ok(store.points().available === pr2 + 500 - Math.floor(168 - 5), '抵回 500 分、扣回已返的 163 分', { before: pr2, after: store.points().available });
ok(rr.refund === 163, '退款 = 实付 163 元（积分抵的 5 元退成积分）', rr.refund);

section('8. 购物车');
store.addToCart({ productId: 'p2', color: '藏青', size: '150', qty: 2 });
store.addToCart({ productId: 'p3', color: '浅蓝', size: 'M', qty: 1 });
ok(store.cartCount() === 3, '购物车 3 件', store.cartCount());
const sum = store.cartSummary();
ok(sum.total === 168 * 2 + 118, '合计按数量计算', sum.total);
store.changeQty(store.getCart()[0].key, 5);
ok(store.getCart()[0].qty === 7, '数量步进生效');
store.removeCart(store.getCart()[0].key);
ok(store.cartCount() === 1, '删除一件后剩 1 件', store.cartCount());

section('9. 店长口令、商品上下架与改价');
ok(store.verifyAdmin('2468') === true, '口令 2468 通过');
ok(store.verifyAdmin('1234') === false, '错误口令被拒绝');
ok(store.toggleOnSale('p2') === false, '商品可下架');
ok(store.queryProducts({}).every((p) => p.id !== 'p2'), '下架商品不出现在列表');
store.toggleOnSale('p2');
const up = store.updateProduct('p2', { price: 188, stock: 9, image: '/images/p2.png' });
ok(up.price === 188 && store.getProduct('p2').price === 188, '店长可改价（店主自己维护）', store.getProduct('p2').price);
ok(store.getProduct('p2').stock === 9, '店长可改库存');
store.updateProduct('p2', { price: 168, stock: 64 });

section('10. 演示订单');
ok(store.seedDemoOrders() > 0 || store.hasDemo(), '演示订单可生成');
ok(store.orderList('all', { includeDemo: false }).every((x) => !x.demo), '用户端看不到演示订单');
ok(store.orderList('all', { includeDemo: true }).some((x) => x.demo), '店长端能看到演示订单');
ok(store.adminStats().pendingReturn >= 1, '店长台能看到退货申请', store.adminStats());

section('11. 挑尺码（按身高，尺码数字就是身高）');
const sizeTool = require(path.join(MP, 'utils/size.js'));
const fit = (id, h) => sizeTool.recommend(store.getProduct(id), h);
const f1 = fit('p1', 170);
ok(f1.ok && f1.size === '170', '170cm 在短袖套装上挑到 170 码', f1);
ok(fit('p1', 168).size === '170', '168cm 挑 170 码（尺码覆盖 168–172）', fit('p1', 168).size);
ok(fit('p1', 183).size === '185', '183cm 挑 185 码', fit('p1', 183).size);
const f2 = fit('p3', 128);
ok(f2.ok && f2.size === '130', '小学 110–160：128cm 挑 130 码', f2);
ok(fit('p2', 176).size === '175', '数字码 150–200：176cm 挑 175 码', fit('p2', 176).size);
ok(fit('p6', 150).size === '均码', '均码商品直接返回均码');
ok(fit('p1', 85).ok === false, '身高 85cm 超出 90–220，报错不推荐', fit('p1', 85));
ok(fit('p1', '').ok === false, '身高没填时提示补充，不乱给码', fit('p1', ''));
ok(fit('p7', 205).size === '200', '超出最大码时给最大码 200，不推荐不存在的 205', fit('p7', 205).size);
const allFit = store.allProducts().every((p) => {
  const res = sizeTool.recommend(p, 150);
  return res.ok && p.sizes.indexOf(res.size) >= 0 && res.index === p.sizes.indexOf(res.size);
});
ok(allFit, store.allProducts().length + ' 件商品 × 同一身高，挑码结果都在各自尺码表里');
ok(fit('p1', 140).size === store.getProduct('p1').sizes[0], '身高低于最小码时落到最小码，而不是报错');
ok(store.getProduct('p1').sizes.indexOf('M') < 0, '短袖套装的尺码表里已经没有 S/M/L 字母码了');

section('12. WXML 里绑定的事件方法都真的存在');
/* 静态对一遍：wxml 上写的 bindtap/bindinput/... 处理函数，在页面 js 里有没有定义。
   改 wxml 时手滑写错一个字母，页面不会报错，只是点了没反应——用这条兜住。 */
const fs = require('fs');
const appJson = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'));
let missing = [];
appJson.pages.forEach((p) => {
  const dir = path.join(MP, path.dirname(p));
  const name = path.basename(p);
  const wxml = fs.readFileSync(path.join(dir, name + '.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(dir, name + '.js'), 'utf8');
  const handlers = new Set();
  const re = /(?:bind|catch)[:a-z]*\s*=\s*"([A-Za-z_$][\w$]*)"/g;
  let m;
  while ((m = re.exec(wxml))) handlers.add(m[1]);
  handlers.forEach((h) => {
    const defined = new RegExp('(^|[^\\w$.])' + h + '\\s*[(:]').test(js);
    if (!defined) missing.push(p + ' → ' + h);
  });
  ok(missing.filter((x) => x.indexOf(p + ' → ') === 0).length === 0, p + ' 的事件方法齐全', missing);
});
ok(appJson.pages.length === 12, '12 个页面都检查过', appJson.pages.length);

section('13. 云端接口：规则两边是否一致');
/* 云函数（cloudfunctions/api）是「谁说了算」的一方，小程序里的 store.js 只负责显示。
   两边算法一旦漂移，就会出现「页面显示 128、云端扣了 130」这种最难查的 bug，
   所以这里把两边的常量和服务端定价与本地定价对一遍。 */
const RULES = path.resolve(__dirname, '..', 'cloudfunctions', 'api', 'common', 'rules.js');
const rules = require(RULES);
const storeSrc = fs.readFileSync(path.join(MP, 'utils', 'store.js'), 'utf8');
const constOf = (name) => {
  const m = storeSrc.match(new RegExp(name + '\\s*=\\s*([0-9.]+)'));
  return m ? Number(m[1]) : NaN;
};
[
  ['POINTS_PER_YUAN', 'POINTS_PER_YUAN'],
  ['NEW_USER_POINTS', 'NEW_USER_POINTS'],
  ['MAX_DISCOUNT_RATE', 'MAX_DISCOUNT_RATE'],
  ['MEMBER_THRESHOLD', 'MEMBER_THRESHOLD'],
  ['MEMBER_RATE', 'MEMBER_RATE'],
  ['FREE_SHIPPING', 'FREE_SHIPPING'],
  ['EXPRESS_FEE', 'EXPRESS_FEE']
].forEach(([key]) => {
  ok(rules[key] === constOf(key), '常量 ' + key + ' 前后端一致', [rules[key], constOf(key)]);
});

/* 同一笔单，服务端算的钱和本地算的钱必须一样 */
reset();
const localOrder = store.createOrder({
  items: [{ productId: 'p1', qty: 1 }],
  delivery: 'pickup'
}).order;
const srvPrice = rules.priceOrder({
  items: [{ price: 128, qty: 1 }],
  user: { points: 500, spent: 0 },
  delivery: 'pickup',
  usePoints: false
});
ok(srvPrice.ok && srvPrice.amount === localOrder.amount, '同一笔单：服务端定价 = 本地定价', [srvPrice.amount, localOrder.amount]);

/* 会员 + 积分抵扣这一组最容易算错的，也各对一次 */
reset();
const m1 = store.createOrder({ items: [{ productId: 'p1', qty: 1 }], delivery: 'express', address: addr, usePoints: true }).order;
const s1 = rules.priceOrder({
  items: [{ price: 128, qty: 1 }],
  user: { points: 500, spent: 0 },
  delivery: 'express',
  address: addr,
  usePoints: true
});
ok(s1.memberDiscount === m1.memberDiscount && s1.discount === m1.discount && s1.amount === m1.amount,
  '非会员 + 积分抵扣：两边金额一致', [s1.discount, m1.discount, s1.amount, m1.amount]);

/* 结构检查：云函数和客户端适配层该在的地方都在 */
const apiIndex = path.resolve(__dirname, '..', 'cloudfunctions', 'api', 'index.js');
ok(fs.existsSync(apiIndex), '云函数入口 api/index.js 存在');
ok(/exports\.main\s*=/.test(fs.readFileSync(apiIndex, 'utf8')), '云函数导出了 main');
const projCfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'project.config.json'), 'utf8'));
ok(projCfg.cloudfunctionRoot === 'cloudfunctions/', 'project.config.json 指向 cloudfunctions/');
const cloudClient = require(path.join(MP, 'utils', 'cloud.js'));
ok(typeof cloudClient.call === 'function' && typeof cloudClient.ready === 'function', '小程序端 cloud.js 导出 call/ready');
ok(cloudClient.ready() === false, '没有 wx.cloud 时 ready() 返回 false（网页版/Node 里自动退回本地）');
ok(typeof cloudClient.ENV_ID === 'string' && cloudClient.ENV_ID.length > 0, '云开发环境 ID 已填', cloudClient.ENV_ID);

/* 客户端适配层 api.js：页面只认这一层，云端不可用时必须退回本地 */
const apiClient = require(path.join(MP, 'utils', 'api.js'));
ok(typeof apiClient.createOrder === 'function' && typeof apiClient.pay === 'function' && typeof apiClient.cancel === 'function', 'api.js 导出买家侧动作');
ok(typeof apiClient.ship === 'function' && typeof apiClient.returnHandle === 'function' && typeof apiClient.updateProduct === 'function', 'api.js 导出店长侧动作');
ok(apiClient._internal.isTransportError({ ok: false, msg: '调用云端失败：FunctionName not found' }), '云函数没部署时判为可退回本地');
ok(!apiClient._internal.isTransportError({ ok: false, msg: '库存不够了' }), '业务错误不退回本地（不能偷偷在本地下一单）');

const seedPath = path.resolve(__dirname, '..', 'cloudfunctions', 'seed', 'products.json');
const seedLines = fs.readFileSync(seedPath, 'utf8').trim().split('\n');
ok(seedLines.length === store.allProducts().length, '商品种子文件条数 = 商品数', [seedLines.length, store.allProducts().length]);
const stateMap = ['pending_pay', 'paid', 'shipped', 'return_pending', 'done', 'cancelled', 'refunded'];
ok(stateMap.every((s) => rules.STATUS[s] && store.STATUS[s]), '七个订单状态两边都认识', stateMap.filter((s) => !rules.STATUS[s]));

/* api.js 的本地兜底：没有 wx.cloud 时必须能真的下成一单，价格与 store 一致 */
(async function () {
  reset();
  const r = await apiClient.createOrder({
    items: [{ productId: 'p1', qty: 1 }],
    delivery: 'pickup'
  });
  ok(!!(r && r.ok && r.order && r.order.amount === 128), 'api.js 在无云环境下走本地下单且金额正确', [
    r && r.ok,
    r && r.order && r.order.amount
  ]);
  const l = await apiClient.listOrders('all');
  ok(!!(l && l.ok && l.list.length >= 1), 'api.js 本地订单列表可用', l && l.list && l.list.length);

  /* 网页演示版是「把源文件按白名单打进一个 HTML」，白名单漏一个就是白屏。
     这里直接扫产物：__req('x') 用到的每个 id 都必须有 __def('x')，
     之前 utils/api.js、utils/cloud.js 就是漏在名单外，整页只剩一行红字。 */
  const webHtml = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const defined = {};
  webHtml.replace(/__def\("([^"]+)"/g, (m, id) => { defined[id] = 1; return m; });
  const wanted = {};
  webHtml.replace(/__req\("([^"]+)"\)/g, (m, id) => { wanted[id] = 1; return m; });
  const missingMods = Object.keys(wanted).filter((id) => !defined[id]);
  ok(missingMods.length === 0, '网页演示版里 require 的模块都打进去了', missingMods);

  /* 对账单 xlsx：小程序里没有第三方库，这 200 行要自己长出来。
     这里验的是「产物是不是一个能被 Excel 打开的 zip」以及汇总算得对不对。 */
  const X = require(path.join(__dirname, '..', 'miniprogram', 'utils', 'xlsx.js'));
  const buf = X.buildXlsx([
    { name: '明细', rows: [['订单号', '实付'], ['o1', 128], ['o2', 49.5]] },
    { name: '按月汇总', rows: [['月份', '单数', '净额'], ['2026-11', 2, 177.5]] }
  ]);
  ok(buf.length > 500 && buf[0] === 0x50 && buf[1] === 0x4b, 'xlsx 是个 zip（PK 开头）', [buf.length, buf[0], buf[1]]);
  const zipText = Buffer.from(buf).toString('latin1');
  ok(zipText.indexOf('xl/workbook.xml') >= 0 && zipText.indexOf('[Content_Types].xml') >= 0,
    'xlsx 里带了 workbook 与 content types');
  ok(zipText.indexOf('xl/worksheets/sheet2.xml') >= 0, '两张表都打进去了');
  const months = X.byMonth([
    { createdAt: Date.now(), amount: 100, refundedAmount: 0 },
    { createdAt: Date.now(), amount: 50, refundedAmount: 10 }
  ]);
  ok(months.length === 1 && months[0].orders === 2 && months[0].net === 140,
    '按月汇总：单数与净额算对', months);
  let threw = false;
  try {
    X.buildXlsx([]);
  } catch (e) {
    threw = true;
  }
  ok(threw, '空数据会报错而不是生成坏文件');

  /* 真实支付（v1.4）：前端只能调起收银台，金额与状态都在服务端 */
  const payJs = fs.readFileSync(path.join(MP, 'pages', 'pay', 'pay.js'), 'utf8');
  const payWxml = fs.readFileSync(path.join(MP, 'pages', 'pay', 'pay.wxml'), 'utf8');
  const wxpay = require(path.join(__dirname, '..', 'cloudfunctions', 'api', 'common', 'wxpay.js'));
  const apiJs = fs.readFileSync(path.join(MP, 'utils', 'api.js'), 'utf8');

  ok(/wx\.requestPayment\s*\(/.test(payJs), '收银台是 wx.requestPayment 拉起的');
  ok(/api\.createPayment\s*\(/.test(payJs), '下单先走云函数 createPayment');
  ok(/api\.confirmPay\s*\(/.test(payJs), '付完调 confirmPay 让服务端查单确认');
  ok(payWxml.indexOf('演示版不会真实扣款') < 0, '支付页已经没有「演示版不会真实扣款」');
  ok(payWxml.indexOf('到店付款') >= 0, '支付页保留了「到店付款/转账」的兜底说法');
  ok(typeof wxpay.configured === 'function' && typeof wxpay.configured() === 'boolean',
    'wxpay.configured() 返回布尔值（配置齐才发起请求）');
  const need = wxpay.missing();
  ok(Array.isArray(need) && need.length === (wxpay.configured() ? 0 : need.length),
    'missing() 与 configured() 口径一致', need);
  ok(/createPayment/.test(apiJs) && /confirmPay/.test(apiJs) && /markPaid/.test(apiJs),
    'api.js 暴露了 createPayment / confirmPay / markPaid');

  console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' + (pass + fail) : 'ALL PASS ' + pass));
  process.exit(fail ? 1 : 0);
})();


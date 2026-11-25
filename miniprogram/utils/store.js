const D = require('./data');
const F = require('./format');

const KEY = 'lanshi_state_v4';
const VERSION = 4;

const POINTS_PER_YUAN = 100; // 100 积分 = 1 元
const NEW_USER_POINTS = 500; // 新客礼
const MAX_DISCOUNT_RATE = 0.05; // 每单最多抵商品金额的 5%
const MEMBER_THRESHOLD = 1200; // 累计消费满 1200 元成为会员
const MEMBER_RATE = 0.96; // 会员 96 折
const FREE_SHIPPING = 50;
const EXPRESS_FEE = 8;

const STATUS = {
  pending_pay: { text: '待付款', hint: '微信支付，付完就安排' },
  paid: { text: '待发货', hint: '已付款，正在打包' },
  shipped: { text: '待收货', hint: '已发出，注意查收' },
  return_pending: { text: '退货申请中', hint: '店长正在处理，稍等一下' },
  done: { text: '已完成', hint: '感谢支持，欢迎再来' },
  cancelled: { text: '已取消', hint: '订单已取消' },
  refunded: { text: '已退货', hint: '货款已原路退回' }
};

const TABS = [
  { key: 'all', text: '全部', statuses: null },
  { key: 'pay', text: '待付款', statuses: ['pending_pay'] },
  { key: 'ship', text: '待发货', statuses: ['paid'] },
  { key: 'receive', text: '待收货', statuses: ['shipped'] },
  { key: 'done', text: '已完成', statuses: ['done', 'return_pending', 'refunded'] }
];

function now() {
  return Date.now();
}

function defaultState() {
  return {
    v: VERSION,
    user: { nickname: '', points: NEW_USER_POINTS, spent: 0 },
    pointsLog: [{ id: 'p-init', text: '新人见面礼', delta: NEW_USER_POINTS, time: now() }],
    cart: [],
    orders: [],
    address: null,
    addresses: [],
    overrides: {}
  };
}

function write(state) {
  try {
    wx.setStorageSync(KEY, state);
  } catch (e) {
    // 存储不可用时静默失败，页面仍可浏览
  }
}

function read() {
  try {
    const s = wx.getStorageSync(KEY);
    if (s && s.user && s.v === VERSION) return s;
  } catch (e) {}
  const s = defaultState();
  write(s);
  return s;
}

function ensureInit() {
  read();
}

/* ---------------- 商品 ---------------- */

function getProduct(id) {
  const p = D.PRODUCTS.find(function (x) {
    return x.id === id;
  });
  if (!p) return null;
  const s = read();
  const o = s.overrides[id] || {};
  return Object.assign({}, p, o);
}

function isOnSale(id) {
  const s = read();
  const o = s.overrides[id];
  return !(o && o.onSale === false);
}

function toggleOnSale(id) {
  const s = read();
  const cur = s.overrides[id] || {};
  const onSale = !(cur.onSale !== false);
  s.overrides[id] = Object.assign({}, cur, { onSale: onSale });
  write(s);
  return onSale;
}

/* 店长自己改价格 / 库存 / 图片 / 名称，改完只影响本机演示；
   接云开发后这里换成写数据库，图片换成云存储 fileID。 */
function updateProduct(id, patch) {
  const s = read();
  const cur = s.overrides[id] || {};
  const next = Object.assign({}, cur);
  if (patch.price !== undefined && patch.price !== '') next.price = Math.max(0, Math.round(Number(patch.price) || 0));
  if (patch.stock !== undefined && patch.stock !== '') next.stock = Math.max(0, parseInt(patch.stock, 10) || 0);
  if (patch.image) next.image = patch.image;
  if (patch.name) next.name = patch.name;
  s.overrides[id] = next;
  write(s);
  return Object.assign({}, D.PRODUCTS.find(function (p) { return p.id === id; }), next);
}

function allProducts() {
  const s = read();
  return D.PRODUCTS.map(function (p) {
    const o = s.overrides[p.id] || {};
    return Object.assign({}, p, o, { onSale: o.onSale !== false });
  });
}

function queryProducts(f) {
  f = f || {};
  let list = allProducts().filter(function (p) {
    return p.onSale;
  });
  if (f.school && f.school !== '全部') {
    list = list.filter(function (p) {
      return p.school === f.school;
    });
  }
  if (f.stage && f.stage !== '全部') {
    list = list.filter(function (p) {
      return p.stage === f.stage || p.stage === '通用';
    });
  }
  if (f.category && f.category !== '全部') {
    list = list.filter(function (p) {
      return p.category === f.category;
    });
  }
  if (f.keyword) {
    const k = String(f.keyword).trim();
    if (k) {
      list = list.filter(function (p) {
        return (p.name + p.school + p.schoolShort + p.tags.join('')).indexOf(k) >= 0;
      });
    }
  }
  if (f.sort === 'price') {
    list = list.slice().sort(function (a, b) {
      return a.price - b.price;
    });
  }
  return list;
}

function featuredProducts() {
  return D.FEATURED_IDS.map(getProduct).filter(function (p) {
    return p && isOnSale(p.id);
  });
}

/* ---------------- 积分 ---------------- */

function points() {
  const s = read();
  return {
    available: s.user.points,
    total: s.user.points
  };
}

/* 会员：累计消费满 1200 元，之后所有订单 96 折 */
function member() {
  const s = read();
  const spent = s.user.spent || 0;
  return {
    spent: spent,
    threshold: MEMBER_THRESHOLD,
    isMember: spent >= MEMBER_THRESHOLD,
    remain: Math.max(0, MEMBER_THRESHOLD - spent),
    rate: MEMBER_RATE,
    percent: Math.min(100, Math.round(spent / MEMBER_THRESHOLD * 100))
  };
}

function pointsLog() {
  return read().pointsLog;
}

function getAddress() {
  /* 老版本只存一个地址（state.address）。现在有地址簿了，
     没云的时候本地也存一份，取默认那条给结算页用。 */
  const s = read();
  const list = s.addresses || [];
  if (list.length) {
    const def = list.filter(function (a) { return a.isDefault; })[0] || list[0];
    return { name: def.name, phone: def.phone, detail: def.detail };
  }
  return s.address;
}

/* ---------------- 地址簿（本地兜底） ---------------- */

const MAX_ADDRESS = 10;

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

function ensureDefault(list) {
  let has = false;
  list.forEach(function (x) { if (x.isDefault) has = true; });
  if (!has && list.length) list[0].isDefault = true;
  return list;
}

function getAddresses() {
  const s = read();
  return ensureDefault((s.addresses || []).slice());
}

function saveAddress(raw) {
  const parsed = normAddress(raw);
  if (!parsed.ok) return parsed;
  const s = read();
  const list = (s.addresses || []).slice();
  const wantId = raw && raw.id;
  const makeDefault = !!(raw && raw.isDefault);
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
      id: 'a' + now() + Math.floor(Math.random() * 1000),
      name: parsed.value.name,
      phone: parsed.value.phone,
      detail: parsed.value.detail,
      tag: parsed.value.tag,
      isDefault: makeDefault || list.length === 0
    };
    if (item.isDefault) list.forEach(function (x) { x.isDefault = false; });
    list.push(item);
  }
  s.addresses = ensureDefault(list);
  s.address = { name: s.addresses[0].name, phone: s.addresses[0].phone, detail: s.addresses[0].detail };
  write(s);
  return { ok: true, addresses: s.addresses };
}

function removeAddress(id) {
  const s = read();
  const list = (s.addresses || []).filter(function (x) { return x.id !== id; });
  if (list.length === (s.addresses || []).length) return { ok: false, msg: '这个地址已经不在了' };
  s.addresses = ensureDefault(list);
  write(s);
  return { ok: true, addresses: s.addresses };
}

function setDefaultAddress(id) {
  const s = read();
  const list = (s.addresses || []).slice();
  const at = list.filter(function (x) { return x.id === id; })[0];
  if (!at) return { ok: false, msg: '这个地址不在你的地址簿里' };
  list.forEach(function (x) { x.isDefault = x.id === id; });
  s.addresses = list;
  write(s);
  return { ok: true, addresses: list };
}

function pushLog(s, text, delta, orderId) {
  s.pointsLog.unshift({
    id: 'p' + now() + Math.floor(Math.random() * 1000),
    text: text,
    delta: delta,
    time: now(),
    orderId: orderId || ''
  });
  if (s.pointsLog.length > 60) s.pointsLog = s.pointsLog.slice(0, 60);
}

/* ---------------- 购物车 ---------------- */

function cartKey(productId, color, size) {
  return productId + '|' + color + '|' + size;
}

function cartCount() {
  const s = read();
  return s.cart.reduce(function (a, b) {
    return a + b.qty;
  }, 0);
}

function getCart() {
  const s = read();
  return s.cart.map(function (it) {
    const p = getProduct(it.productId);
    return p ? Object.assign({}, it, { product: p }) : null;
  }).filter(Boolean);
}

function addToCart(payload) {
  const s = read();
  const p = getProduct(payload.productId);
  if (!p) return { ok: false, msg: '商品不存在' };
  const key = cartKey(p.id, payload.color, payload.size);
  const qty = Math.max(1, parseInt(payload.qty, 10) || 1);
  const found = s.cart.find(function (i) {
    return i.key === key;
  });
  if (found) {
    found.qty = Math.min(99, found.qty + qty);
  } else {
    s.cart.push({
      key: key,
      productId: p.id,
      color: payload.color,
      size: payload.size,
      qty: qty,
      selected: true
    });
  }
  write(s);
  return { ok: true, count: cartCount() };
}

function changeQty(key, delta) {
  const s = read();
  const it = s.cart.find(function (i) {
    return i.key === key;
  });
  if (!it) return;
  it.qty = Math.max(1, Math.min(99, it.qty + delta));
  write(s);
}

function removeCart(key) {
  const s = read();
  s.cart = s.cart.filter(function (i) {
    return i.key !== key;
  });
  write(s);
}

function toggleSelect(key) {
  const s = read();
  const it = s.cart.find(function (i) {
    return i.key === key;
  });
  if (it) it.selected = !it.selected;
  write(s);
}

function selectAll(flag) {
  const s = read();
  s.cart.forEach(function (i) {
    i.selected = !!flag;
  });
  write(s);
}

function selectedCart() {
  return getCart().filter(function (i) {
    return i.selected;
  });
}

function cartSummary() {
  const list = getCart();
  let total = 0;
  let count = 0;
  list.forEach(function (i) {
    if (i.selected) {
      total += i.product.price * i.qty;
      count += i.qty;
    }
  });
  return { total: total, count: count, allSelected: list.length > 0 && list.every(function (i) { return i.selected; }) };
}

function removeCartKeys(keys) {
  const s = read();
  s.cart = s.cart.filter(function (i) {
    return keys.indexOf(i.key) < 0;
  });
  write(s);
}

/* ---------------- 订单 ---------------- */

function createOrder(payload) {
  const s = read();
  const items = (payload.items || []).map(function (it) {
    const p = getProduct(it.productId);
    if (!p) return null;
    return {
      productId: p.id,
      name: p.name,
      image: p.image,
      color: it.color,
      size: it.size,
      price: p.price,
      qty: Math.max(1, parseInt(it.qty, 10) || 1)
    };
  }).filter(Boolean);

  if (!items.length) return { ok: false, msg: '没有可以结算的商品' };

  const goods = items.reduce(function (a, b) {
    return a + b.price * b.qty;
  }, 0);

  const delivery = payload.delivery === 'pickup' ? 'pickup' : 'express';
  const address = payload.address || {};
  if (delivery === 'express') {
    if (!address.name || !address.phone || !address.detail) {
      return { ok: false, msg: '请把收货人、电话和地址填完整' };
    }
    if (!/^1\d{10}$/.test(address.phone)) {
      return { ok: false, msg: '手机号看起来不对，检查一下' };
    }
  }

  const shipping = delivery === 'pickup' ? 0 : goods >= FREE_SHIPPING ? 0 : EXPRESS_FEE;
  const available = s.user.points;
  const m = member();
  /* 会员 96 折，先减会员折扣，再按折后金额的 5% 算积分抵扣上限 */
  const memberDiscount = m.isMember ? Math.round(goods * (1 - MEMBER_RATE)) : 0;
  const maxDiscount = Math.floor((goods - memberDiscount) * MAX_DISCOUNT_RATE);
  let discount = 0;
  if (payload.usePoints) {
    discount = Math.min(maxDiscount, Math.floor(available / POINTS_PER_YUAN));
  }
  const pointsUsed = discount * POINTS_PER_YUAN;

  if (pointsUsed > available) {
    return { ok: false, msg: '积分不够抵扣，少抵一点试试' };
  }

  const amount = Math.max(0, goods - memberDiscount - discount + shipping);
  const ts = now();

  s.user.points = available - pointsUsed;
  if (pointsUsed > 0) pushLog(s, '积分抵现 ¥' + F.yuan(discount), -pointsUsed);

  const order = {
    id: 'o' + ts + Math.floor(Math.random() * 1000),
    no: F.orderNo(),
    items: items,
    goods: goods,
    shipping: shipping,
    memberDiscount: memberDiscount,
    discount: discount,
    pointsUsed: pointsUsed,
    amount: amount,
    reward: 0,
    rewardGranted: false,
    returnedItems: [],
    refundedAmount: 0,
    delivery: delivery,
    address: delivery === 'express' ? {
      name: address.name,
      phone: address.phone,
      detail: address.detail
    } : null,
    remark: payload.remark || '',
    status: 'pending_pay',
    createdAt: ts,
    updatedAt: ts,
    tracking: null,
    demo: false,
    timeline: [{ label: '订单已提交', time: ts }]
  };

  s.orders.unshift(order);
  if (delivery === 'express') {
    s.address = order.address;
  }
  write(s);

  if (payload.cartKeys && payload.cartKeys.length) {
    removeCartKeys(payload.cartKeys);
  }
  return { ok: true, order: order };
}

/* 微信支付：真实环境由云函数统一下单 + wx.requestPayment，
   支付结果以微信回调为准（前端只负责展示）。演示环境直接置为已付款。 */
function payOrder(id) {
  const s = read();
  const o = s.orders.find(function (x) {
    return x.id === id;
  });
  if (!o || o.status !== 'pending_pay') return { ok: false };
  o.status = 'paid';
  o.updatedAt = now();
  o.timeline.push({ label: '微信支付成功', time: now() });
  write(s);
  return { ok: true, order: o };
}

function getOrder(id) {
  return read().orders.find(function (o) {
    return o.id === id;
  }) || null;
}

function orderList(filter, opts) {
  opts = opts || {};
  const s = read();
  let list = s.orders.filter(function (o) {
    return opts.includeDemo ? true : !o.demo;
  });
  if (filter && filter !== 'all') {
    const tab = TABS.find(function (t) {
      return t.key === filter;
    });
    if (tab && tab.statuses) {
      list = list.filter(function (o) {
        return tab.statuses.indexOf(o.status) >= 0;
      });
    }
  }
  return list.slice().sort(function (a, b) {
    return b.createdAt - a.createdAt;
  });
}

function ship(id, company, no) {
  const s = read();
  const o = s.orders.find(function (x) {
    return x.id === id;
  });
  if (!o || o.status !== 'paid') return { ok: false };
  o.status = 'shipped';
  o.updatedAt = now();
  o.tracking = { company: company, no: no || '' };
  o.timeline.push({ label: '已发货 · ' + company + (no ? ' ' + no : ''), time: now() });
  write(s);
  return { ok: true, order: o };
}

function confirmReceipt(id) {
  const s = read();
  const o = s.orders.find(function (x) {
    return x.id === id;
  });
  if (!o || o.status !== 'shipped') return { ok: false };
  o.status = 'done';
  o.updatedAt = now();
  o.timeline.push({ label: '已确认收货', time: now() });
  /* 返积分按实付商品金额算（不含运费），取整舍去小数 */
  const base = o.amount - o.shipping;
  o.reward = Math.floor(base);
  o.rewardGranted = true;
  /* 累计消费（商品金额，不含运费）决定会员等级 */
  s.user.spent = (s.user.spent || 0) + o.goods;
  if (o.reward > 0) {
    s.user.points += o.reward;
    pushLog(s, '购物返积分', o.reward, o.id);
  }
  write(s);
  return { ok: true, order: o };
}

function cancelOrder(id) {
  const s = read();
  const o = s.orders.find(function (x) {
    return x.id === id;
  });
  if (!o || o.status !== 'pending_pay') {
    return { ok: false, msg: '已付款的订单请走退货' };
  }
  o.status = 'cancelled';
  o.updatedAt = now();
  o.timeline.push({ label: '订单已取消', time: now() });
  if (o.pointsUsed > 0) {
    s.user.points += o.pointsUsed;
    pushLog(s, '积分抵现退回', o.pointsUsed, o.id);
  }
  write(s);
  return { ok: true, order: o };
}

/* 买家申请退货（整单），等店长确认收到货后再算钱和积分 */
function requestReturn(id) {
  const s = read();
  const o = s.orders.find(function (x) {
    return x.id === id;
  });
  if (!o || o.status !== 'done') return { ok: false, msg: '确认收货后才能申请退货' };
  o.status = 'return_pending';
  o.updatedAt = now();
  o.timeline.push({ label: '买家申请退货', time: now() });
  write(s);
  return { ok: true, order: o };
}

/* 店长处理退货。indices 是要退的商品下标（可以只退其中几件）。
   规则：
   - 退的货款 = 退货商品金额 - 该部分分摊的会员折扣（运费不退）
   - 这一单用掉的积分，按退货比例退回
   - 已经返给买家的购物积分，按「实际留下金额」重算，多返的要扣回
   - 累计消费（会员额度）同步减去退货商品金额
   这样「退货的那部分不产生积分，只有真正买下的金额才送积分」。 */
function applyReturn(id, indices, reason) {
  const s = read();
  const o = s.orders.find(function (x) {
    return x.id === id;
  });
  if (!o) return { ok: false, msg: '订单不存在' };
  if (['cancelled', 'refunded'].indexOf(o.status) >= 0) return { ok: false, msg: '这单已经结束了' };

  const picked = (indices || []).filter(function (i) {
    return i >= 0 && i < o.items.length && !(o.returnedItems || []).some(function (r) { return r.index === i; });
  });
  if (!picked.length) return { ok: false, msg: '先选要退的商品' };

  const returnedGoods = picked.reduce(function (a, i) {
    return a + o.items[i].price * o.items[i].qty;
  }, 0);
  if (returnedGoods <= 0) return { ok: false, msg: '退货金额不对' };

  /* 退款按「实付商品金额」的比例退：会员折扣、积分抵扣都算进去了，运费不退 */
  const paidGoodsAll = o.amount - o.shipping;
  const refund = o.goods > 0 ? Math.round(paidGoodsAll * returnedGoods / o.goods) : 0;

  /* 这一单用掉的积分按比例退回 */
  const pointsBack = o.goods > 0 ? Math.round(o.pointsUsed * returnedGoods / o.goods) : 0;
  if (pointsBack > 0) {
    s.user.points += pointsBack;
    pushLog(s, '退货退回抵扣积分', pointsBack, o.id);
  }

  /* 已返的购物积分按实际留下的金额重算（扣掉之前已退过的部分） */
  const priorRefund = o.refundedAmount || 0;
  const paidGoods = o.amount - o.shipping; // 实付商品金额（不含运费）
  const keptGoods = Math.max(0, paidGoods - priorRefund - refund);
  if (o.rewardGranted) {
    const newReward = Math.floor(keptGoods);
    const delta = newReward - o.reward;
    if (delta !== 0) {
      s.user.points += delta;
      pushLog(s, delta > 0 ? '退货后积分补差' : '退货扣回购物积分', delta, o.id);
      o.reward = newReward;
    }
  }

  /* 会员额度同步扣减 */
  s.user.spent = Math.max(0, (s.user.spent || 0) - returnedGoods);

  picked.forEach(function (i) {
    o.returnedItems = o.returnedItems || [];
    o.returnedItems.push({ index: i, name: o.items[i].name, qty: o.items[i].qty, price: o.items[i].price });
  });

  const totalQty = o.items.reduce(function (a, b) { return a + b.qty; }, 0);
  const returnedQty = o.returnedItems.reduce(function (a, b) { return a + b.qty; }, 0);

  o.refundedAmount = (o.refundedAmount || 0) + refund;
  o.updatedAt = now();
  o.returnReason = reason || '';
  o.status = returnedQty >= totalQty ? 'refunded' : 'done';
  o.timeline.push({
    label: '已退货 ' + picked.length + ' 项 · 退款 ¥' + F.yuan(refund),
    time: now()
  });
  write(s);
  return { ok: true, order: o, refund: refund, refundedPoints: pointsBack };
}

/* ---------------- 店长端 ---------------- */

function verifyAdmin(pwd) {
  return String(pwd) === '2468';
}

function adminStats() {
  const s = read();
  const orders = s.orders;
  const pendingShip = orders.filter(function (o) { return o.status === 'paid'; }).length;
  const pendingReturn = orders.filter(function (o) { return o.status === 'return_pending'; }).length;
  const revenue = orders.filter(function (o) {
    return ['paid', 'shipped', 'done', 'return_pending', 'refunded'].indexOf(o.status) >= 0;
  }).reduce(function (a, b) {
    return a + b.amount - (b.refundedAmount || 0);
  }, 0);
  return {
    pendingShip: pendingShip,
    pendingReturn: pendingReturn,
    total: orders.length,
    revenue: revenue
  };
}

function hasDemo() {
  return read().orders.some(function (o) {
    return o.demo;
  });
}

function seedDemoOrders() {
  const s = read();
  if (hasDemo()) return 0;

  const base = now();
  const hour = 3600 * 1000;
  const specs = [
    {
      buyer: { name: '王女士', phone: '13800001234', detail: '珠海市香洲区凤凰北路 88 号 3 栋 502' },
      status: 'paid',
      ago: 2,
      items: [{ productId: 'p1', color: '藏青', size: 'L', qty: 1 }, { productId: 'p6', color: '砖红', size: '均码', qty: 2 }]
    },
    {
      buyer: { name: '陈先生', phone: '13900005678', detail: '珠海市金湾区红旗镇金海岸花园 12 栋 801' },
      status: 'shipped',
      ago: 26,
      items: [{ productId: 'p3', color: '浅蓝', size: '130', qty: 1 }]
    },
    {
      buyer: { name: '林女士', phone: '13700009012', detail: '珠海市斗门区井岸镇中兴南路 21 号' },
      status: 'return_pending',
      ago: 50,
      items: [{ productId: 'p8', color: '藏青', size: 'M', qty: 1 }, { productId: 'p7', color: '藏青', size: 'M', qty: 1 }]
    }
  ];

  specs.forEach(function (spec, idx) {
    const items = spec.items.map(function (it) {
      const p = getProduct(it.productId);
      return {
        productId: p.id,
        name: p.name,
        image: p.image,
        color: it.color,
        size: it.size,
        price: p.price,
        qty: it.qty
      };
    });
    const goods = items.reduce(function (a, b) {
      return a + b.price * b.qty;
    }, 0);
    const ts = base - spec.ago * hour;
    const shipping = goods >= FREE_SHIPPING ? 0 : EXPRESS_FEE;
    const order = {
      id: 'od' + ts + idx,
      no: 'LX' + (2026111200 + idx),
      items: items,
      goods: goods,
      shipping: shipping,
      memberDiscount: 0,
      discount: 0,
      pointsUsed: 0,
      amount: goods + shipping,
      reward: 0,
      rewardGranted: false,
      returnedItems: [],
      refundedAmount: 0,
      delivery: 'express',
      address: spec.buyer,
      remark: '',
      status: spec.status,
      createdAt: ts,
      updatedAt: ts,
      tracking: spec.status === 'shipped' || spec.status === 'return_pending' ? { company: '顺丰速运', no: 'SF' + (1000000000 + idx * 777) } : null,
      demo: true,
      timeline: [{ label: '订单已提交', time: ts }, { label: '微信支付成功', time: ts + 60 * 1000 }]
    };
    if (order.tracking) {
      order.timeline.push({ label: '已发货 · 顺丰速运 ' + order.tracking.no, time: ts + 3 * hour });
    }
    if (spec.status === 'return_pending') {
      order.timeline.push({ label: '买家申请退货', time: ts + 20 * hour });
    }
    s.orders.push(order);
  });
  write(s);
  return specs.length;
}

function clearDemoOrders() {
  const s = read();
  s.orders = s.orders.filter(function (o) {
    return !o.demo;
  });
  write(s);
}

module.exports = {
  STATUS: STATUS,
  TABS: TABS,
  POINTS_PER_YUAN: POINTS_PER_YUAN,
  NEW_USER_POINTS: NEW_USER_POINTS,
  MAX_DISCOUNT_RATE: MAX_DISCOUNT_RATE,
  MEMBER_THRESHOLD: MEMBER_THRESHOLD,
  FREE_SHIPPING: FREE_SHIPPING,
  EXPRESS_FEE: EXPRESS_FEE,
  ensureInit: ensureInit,
  getProduct: getProduct,
  allProducts: allProducts,
  queryProducts: queryProducts,
  featuredProducts: featuredProducts,
  isOnSale: isOnSale,
  toggleOnSale: toggleOnSale,
  updateProduct: updateProduct,
  points: points,
  member: member,
  pointsLog: pointsLog,
  getAddress: getAddress,
  getAddresses: getAddresses,
  saveAddress: saveAddress,
  removeAddress: removeAddress,
  setDefaultAddress: setDefaultAddress,
  MAX_ADDRESS: MAX_ADDRESS,
  cartCount: cartCount,
  getCart: getCart,
  addToCart: addToCart,
  changeQty: changeQty,
  removeCart: removeCart,
  removeCartKeys: removeCartKeys,
  toggleSelect: toggleSelect,
  selectAll: selectAll,
  selectedCart: selectedCart,
  cartSummary: cartSummary,
  createOrder: createOrder,
  payOrder: payOrder,
  getOrder: getOrder,
  orderList: orderList,
  ship: ship,
  confirmReceipt: confirmReceipt,
  cancelOrder: cancelOrder,
  requestReturn: requestReturn,
  applyReturn: applyReturn,
  verifyAdmin: verifyAdmin,
  adminStats: adminStats,
  hasDemo: hasDemo,
  seedDemoOrders: seedDemoOrders,
  clearDemoOrders: clearDemoOrders
};

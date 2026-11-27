const store = require('../../utils/store');
const api = require('../../utils/api');
const F = require('../../utils/format');
const D = require('../../utils/data');
const X = require('../../utils/xlsx');

const FILTERS = [
  { key: 'todo', text: '待处理', statuses: ['paid', 'return_pending'] },
  { key: 'ship', text: '待发货', statuses: ['paid'] },
  { key: 'return', text: '退货', statuses: ['return_pending'] },
  { key: 'shipped', text: '已发货', statuses: ['shipped'] },
  { key: 'all', text: '全部', statuses: null }
];

/* 库存低于这个数就在商品卡上标红，提示店长该补货了 */
const LOW_STOCK = 5;
/* 订单列表一页 20 单，和云函数的 PAGE_SIZE 对齐 */
const PAGE = 20;

function mapProduct(p) {
  const stock = Number(p.stock) || 0;
  return {
    id: p.id || p._id,
    name: p.name,
    image: p.image,
    price: p.price,
    stock: stock,
    sales: p.sales,
    /* 云端老数据没有 onSale 字段，缺省当在售，别把开关显示成关的 */
    onSale: p.onSale !== false,
    stockLow: stock <= LOW_STOCK,
    soldOut: stock <= 0,
    stockText: stock <= 0 ? '已售罄' : (stock <= LOW_STOCK ? '仅剩 ' + stock + ' 件' : '')
  };
}

/* 商品卡和「低库存」计数一起换，免得两处各写一遍 */
function applyGoods(page, rawList) {
  const mapped = (rawList || []).map(mapProduct);
  page.setData({
    products: mapped,
    lowCount: mapped.filter(function (p) { return p.stockLow; }).length
  });
  return mapped;
}

Page({
  data: {
    today: '',
    stats: { pendingShip: 0, pendingReturn: 0, total: 0, revenue: 0 },
    tab: 'orders',
    filters: FILTERS,
    filter: 'todo',
    orders: [],
    products: [],
    lowCount: 0,
    hasDemo: false,
    keyword: '',
    picked: {},
    pickedCount: 0,
    pickedPaid: 0,
    batchOpen: false,
    trackTarget: null,
    trackCompany: '顺丰速运',
    trackNo: '',
    batchCompany: '顺丰速运',
    exporting: false,
    /* 分页：店长台订单一次拉 20 单，往下翻再拉 */
    hasMore: false,
    loadingMore: false,
    /* 数据看板 */
    dashboard: null,
    basis: '',
    companies: ['顺丰速运', '中通快递', '圆通速递', '到店自提'],
    shipTarget: null,
    shipCompany: '顺丰速运',
    shipNo: '',
    /* 退货处理 */
    returnTarget: null,
    returnItems: [],
    returnReason: '',
    /* 商品编辑 */
    editTarget: null,
    editName: '',
    editPrice: '',
    editStock: '',
    editImage: ''
  },

  onLoad() {
    const d = new Date();
    this.setData({ today: d.getMonth() + 1 + ' 月 ' + d.getDate() + ' 日' });
  },

  onShow() {
    const app = getApp();
    if (!app.globalData.adminUnlocked) {
      /* 有云时不看口令，看服务端认不认你这个 openid */
      if (api.ready()) {
        const that = this;
        api.adminStats().then(function (r) {
          if (r && r.ok) {
            app.globalData.adminUnlocked = true;
            that.load();
            app.updateCartBadge();
            return;
          }
          wx.showToast({ title: (r && r.msg) || '还不是店长账号', icon: 'none' });
          setTimeout(function () { wx.navigateBack(); }, 800);
        });
        return;
      }
      wx.showToast({ title: '先输入店长口令', icon: 'none' });
      setTimeout(function () { wx.navigateBack(); }, 600);
      return;
    }
    this.load();
    app.updateCartBadge();
  },

  load() {
    /* 先用手上的数据渲染，店长台不至于白屏；有云再把服务端的单盖上来 */
    const local = store.orderList('all', { includeDemo: true });
    this.renderOrders(store.adminStats(), local, null, false);
    if (!api.ready()) return;
    const that = this;
    const filter = this.data.filter;
    Promise.all([
      api.adminStats(),
      api.listOrders('all', { all: true, includeDemo: true, limit: PAGE, skip: 0 }),
      api.products()
    ]).then(function (res) {
      const stats = res[0] && res[0].ok ? res[0].stats : null;
      const list = res[1] && res[1].ok ? res[1].list : null;
      const goods = res[2] && res[2].ok ? (res[2].list || res[2].products) : null;
      if (!list) {
        /* 单没回来也要把商品换成云端的（价格/库存以服务端为准） */
        if (goods && goods.length) applyGoods(that, goods);
        return;
      }
      if (that.data.filter !== filter) return;
      that.skip = list.length;
      that.renderOrders(stats || that.data.stats, list, goods, !!(res[1] && res[1].hasMore));
    });
  },

  /* 往下翻一页。云端订单多的店（开学季一天几十单）不翻页会卡 */
  loadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return;
    const that = this;
    const skip = this.skip || this.data.orders.length;
    this.setData({ loadingMore: true });
    api.listOrders('all', { all: true, includeDemo: true, limit: PAGE, skip: skip }).then(function (r) {
      if (!r || !r.ok) {
        that.setData({ loadingMore: false });
        wx.showToast({ title: (r && r.msg) || '加载失败', icon: 'none' });
        return;
      }
      that.skip = skip + r.list.length;
      /* 往下翻不再重排整屏，直接把新单接在后面 */
      const merged = (that.rawOrders || []).concat(r.list);
      that.setData({ loadingMore: false });
      that.renderOrders(that.data.stats, merged, null, !!r.hasMore);
    });
  },

  /* 数据看板：近 7/30 天、14 天柱状、热销款、退货率。
     口径写在页脚，免得把「销售额」当成「已收款」 */
  loadDashboard() {
    const that = this;
    if (!api.ready()) {
      wx.showToast({ title: '联网后才能看数据', icon: 'none' });
      return;
    }
    api.adminStats().then(function (r) {
      if (!r || !r.ok) {
        wx.showToast({ title: (r && r.msg) || '取不到数据', icon: 'none' });
        return;
      }
      that.renderDashboard(r.stats, r.basis);
    });
  },

  renderDashboard(s, basis) {
    const stats = s || {};
    const byDay = stats.byDay || [];
    const maxDay = byDay.reduce(function (a, b) { return Math.max(a, b.revenue || 0); }, 0);
    const days = byDay.map(function (d) {
      return {
        date: d.date,
        day: Number(d.date.slice(8)) + '日',
        revenue: d.revenue,
        orders: d.orders,
        /* 柱子高度按当期最大值归一，最小 4% 免得全空看起来像坏了 */
        h: maxDay ? Math.max(4, Math.round((d.revenue / maxDay) * 100)) : 4
      };
    });
    const tops = (stats.topProducts || []).map(function (t, i, arr) {
      const max = arr[0].qty || 1;
      return Object.assign({}, t, { w: Math.max(6, Math.round((t.qty / max) * 100)) });
    });
    this.setData({
      dashboard: {
        week: stats.week || { revenue: 0, orders: 0, avg: 0 },
        month: stats.month || { revenue: 0, orders: 0, avg: 0 },
        byDay: days,
        topProducts: tops,
        returnRate: stats.returnRate || 0,
        expired: stats.expired || 0,
        total: stats.total || 0,
        revenue: stats.revenue || 0
      },
      basis: basis || ''
    });
  },

  /* 搜索：姓名 / 电话 / 订单号 / 商品名 / 地址，全在本地过滤——
     店长台一次最多几十单，不必为搜索再跑一趟云端 */
  matchKeyword(o, kw) {
    if (!kw) return true;
    const hay = [
      o.buyer, o.phone, o.no, o.address, o.itemsText, o.remark
    ].join(' ').toLowerCase();
    return hay.indexOf(kw.toLowerCase()) >= 0;
  },

  onKeyword(e) {
    const kw = e.detail.value;
    this.setData({ keyword: kw }, () => this.applyKeyword());
  },

  clearKeyword() {
    this.setData({ keyword: '' }, () => this.applyKeyword());
  },

  /* 只重算关键字，不动底层列表（避免每敲一个字就打一次云） */
  applyKeyword() {
    const kw = this.data.keyword;
    const list = (this.baseOrders || []).filter(function (o) {
      return this.matchKeyword(o, kw);
    }.bind(this));
    this.setData({ orders: list, picked: {}, pickedCount: 0, pickedPaid: 0 });
  },

  renderOrders(s, rawList, cloudGoods, hasMore) {
    const filter = FILTERS.filter(function (f) {
      return f.key === this.data.filter;
    }.bind(this))[0];

    let list = rawList || [];
    this.rawOrders = list;
    this.rawMap = {};
    list.forEach(function (o) {
      this.rawMap[o.id || o._id] = o;
    }.bind(this));
    if (filter && filter.statuses) {
      list = list.filter(function (o) {
        return filter.statuses.indexOf(o.status) >= 0;
      });
    }

    const orders = list.map(function (o) {
      const items = o.items || [];
      const qty = items.reduce(function (a, b) { return a + b.qty; }, 0);
      return {
        id: o.id || o._id,
        no: o.no,
        status: o.status,
        statusText: (store.STATUS[o.status] || {}).text || '',
        tone: o.status === 'return_pending' ? 'warm' : o.status === 'paid' ? 'green' : 'muted',
        timeText: F.shortDate(o.createdAt),
        buyer: o.address ? o.address.name : '到店自提',
        phone: o.address ? o.address.phone : D.STORE.phone,
        address: o.address ? o.address.detail : D.STORE.address,
        itemsText: items.map(function (it) {
          return it.name + ' ' + it.color + '/' + it.size + ' ×' + it.qty;
        }).join('；'),
        qty: qty,
        amountText: F.yuan(o.amount),
        demo: o.demo,
        remark: o.remark,
        trackText: o.tracking ? o.tracking.company + ' ' + o.tracking.no : '',
        refundText: o.refundedAmount ? '已退 ¥' + F.yuan(o.refundedAmount) : ''
      };
    });

    /* 有云端商品就用云端的（价格/库存以服务端为准），否则退回首屏的本地数据 */
    const products = (cloudGoods && cloudGoods.length) ? cloudGoods.map(mapProduct) : store.allProducts().map(mapProduct);

    /* 关键字只作用在已经算好的这一屏上，切 tab / 刷新时自动重算 */
    this.baseOrders = orders;
    const shown = orders.filter(function (o) {
      return this.matchKeyword(o, this.data.keyword);
    }.bind(this));

    this.setData({
      stats: s,
      orders: shown,
      products: products,
      lowCount: products.filter(function (p) { return p.stockLow; }).length,
      hasDemo: store.hasDemo(),
      hasMore: !!hasMore,
      picked: {},
      pickedCount: 0,
      pickedPaid: 0
    });
  },

  switchTab(e) {
    const t = e.currentTarget.dataset.t;
    this.setData({ tab: t });
    if (t === 'data') this.loadDashboard();
  },

  setFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.k }, this.load);
  },

  jumpFilter(e) {
    this.setData({ tab: 'orders', filter: e.currentTarget.dataset.k }, this.load);
  },

  /* ---------- 发货 ---------- */
  openShip(e) {
    this.setData({
      shipTarget: e.currentTarget.dataset.id,
      shipCompany: '顺丰速运',
      shipNo: ''
    });
  },

  closeShip() {
    this.setData({ shipTarget: null });
  },

  pickCompany(e) {
    this.setData({ shipCompany: e.currentTarget.dataset.c });
  },

  onShipNo(e) {
    this.setData({ shipNo: e.detail.value });
  },

  /* ---------- 标记收款（家长到店付/转账，线上支付没开通时的兜底） ---------- */
  doMarkPaid(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    const o = (this.rawMap || {})[id] || {};
    wx.showModal({
      title: '标记已收款',
      content: '确认收到这单 ¥' + (o.amountText || o.amount || '') + ' 的钱？标记后订单进入「待发货」。',
      confirmText: '收到了',
      cancelText: '还没收',
      success(res) {
        if (!res.confirm) return;
        api.markPaid(id).then(function (r) {
          if (!r || !r.ok) {
            wx.showToast({ title: (r && r.msg) || '标记失败', icon: 'none' });
            that.load();
            return;
          }
          wx.showToast({ title: '已标记收款' });
          that.load();
        });
      }
    });
  },

  doShip() {
    const id = this.data.shipTarget;
    const company = this.data.shipCompany;
    const no = this.data.shipNo.trim();
    const that = this;
    api.ship(id, company, no).then(function (r) {
      if (!r || !r.ok) {
        wx.showToast({ title: (r && r.msg) || '订单状态已变化', icon: 'none' });
        that.closeShip();
        that.load();
        return;
      }
      wx.showToast({ title: '已发货' });
      that.closeShip();
      that.load();
    });
  },

  /* ---------- 补单号 ---------- */
  openTrack(e) {
    const id = e.currentTarget.dataset.id;
    const o = (this.rawMap || {})[id] || {};
    this.setData({
      trackTarget: id,
      trackCompany: (o.tracking && o.tracking.company) || '顺丰速运',
      trackNo: ''
    });
  },

  closeTrack() {
    this.setData({ trackTarget: null });
  },

  pickTrackCompany(e) {
    this.setData({ trackCompany: e.currentTarget.dataset.c });
  },

  onTrackNo(e) {
    this.setData({ trackNo: e.detail.value });
  },

  doTrack() {
    const that = this;
    api.setTracking(this.data.trackTarget, this.data.trackCompany, this.data.trackNo.trim()).then(function (r) {
      if (!r || !r.ok) {
        wx.showToast({ title: (r && r.msg) || '保存失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: '单号记上了', icon: 'none' });
      that.closeTrack();
      that.load();
    });
  },

  /* ---------- 勾选 / 批量发货 ---------- */
  togglePick(e) {
    const id = e.currentTarget.dataset.id;
    const picked = Object.assign({}, this.data.picked);
    if (picked[id]) delete picked[id];
    else picked[id] = true;
    this.refreshPicked(picked);
  },

  clearPick() {
    this.refreshPicked({});
  },

  pickAllPaid() {
    const picked = {};
    this.data.orders.forEach(function (o) {
      if (o.status === 'paid') picked[o.id] = true;
    });
    if (!Object.keys(picked).length) {
      wx.showToast({ title: '这一屏没有待发货的单', icon: 'none' });
      return;
    }
    this.refreshPicked(picked);
  },

  refreshPicked(picked) {
    const ids = Object.keys(picked);
    let paid = 0;
    const orders = this.data.orders.map(function (o) {
      const on = !!picked[o.id];
      if (on && o.status === 'paid') paid++;
      return Object.assign({}, o, { picked: on });
    });
    this.setData({ picked: picked, pickedCount: ids.length, pickedPaid: paid, orders: orders });
  },

  openBatch() {
    if (!this.data.pickedPaid) {
      wx.showToast({ title: '勾选里没有待发货的单', icon: 'none' });
      return;
    }
    this.setData({ batchOpen: true, batchCompany: '顺丰速运' });
  },

  closeBatch() {
    this.setData({ batchOpen: false });
  },

  pickBatchCompany(e) {
    this.setData({ batchCompany: e.currentTarget.dataset.c });
  },

  /* 一次发一批：同一家快递、单号可以后补（校服店常见：先打包，单号等快递员揽收才有） */
  doBatchShip() {
    const that = this;
    const picked = this.data.picked;
    const ids = Object.keys(picked).filter(function (id) {
      const raw = (that.rawMap || {})[id];
      return raw && raw.status === 'paid';
    });
    if (!ids.length) {
      wx.showToast({ title: '没有可发货的单', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '批量发货 ' + ids.length + ' 单',
      content: '快递：' + this.data.batchCompany + '。单号可以稍后在订单里补。',
      success(res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '发货中' });
        let done = 0;
        let failed = 0;
        const step = function (i) {
          if (i >= ids.length) {
            wx.hideLoading();
            that.setData({ batchOpen: false, picked: {}, pickedCount: 0, pickedPaid: 0 });
            wx.showToast({ title: '发了 ' + done + ' 单' + (failed ? '，' + failed + ' 单失败' : ''), icon: 'none' });
            that.load();
            return;
          }
          api.ship(ids[i], that.data.batchCompany, '').then(function (r) {
            if (r && r.ok) done++;
            else failed++;
            step(i + 1);
          }).catch(function () {
            failed++;
            step(i + 1);
          });
        };
        step(0);
      }
    });
  },

  /* ---------- 导出对账单 ---------- */
  /* 生成真的 .xlsx：两张表（明细 + 按月汇总）。
     为什么不再复制 CSV：CSV 进 Excel 会丢手机号前导零，中文有时乱码，
     而且做不了第二张汇总表。
     小程序里写文件用 wx.getFileSystemManager，写进 USER_DATA_PATH 再打开/转发。 */
  exportXlsx() {
    const raw = this.rawOrders || [];
    if (!raw.length) {
      wx.showToast({ title: '这一屏没有订单可导出', icon: 'none' });
      return;
    }
    const that = this;
    const head = ['订单号', '下单时间', '状态', '买家', '电话', '地址', '商品', '件数', '实付', '已退', '运单号'];
    const rows = [head];
    raw.forEach(function (o) {
      const d = new Date(o.createdAt || 0);
      const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      rows.push([
        o.no || '',
        d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
          pad(d.getHours()) + ':' + pad(d.getMinutes()),
        (store.STATUS[o.status] || {}).text || o.status,
        o.address ? o.address.name : '到店自提',
        o.address ? String(o.address.phone) : '',
        o.address ? o.address.detail : '',
        (o.items || []).map(function (it) {
          return it.name + ' ' + it.color + '/' + it.size + '×' + it.qty;
        }).join('；'),
        (o.items || []).reduce(function (a, b) { return a + b.qty; }, 0),
        Number(o.amount) || 0,
        Number(o.refundedAmount) || 0,
        o.tracking ? o.tracking.company + ' ' + o.tracking.no : ''
      ]);
    });

    /* 汇总只算真付过钱的：取消/超时关掉的单不该进「实付合计」 */
    const months = X.byMonth(raw.filter(function (o) {
      return o.status !== 'cancelled';
    }));
    const sumRows = [['月份', '单数', '实付合计', '退款合计', '净额']];
    months.forEach(function (m) {
      sumRows.push([m.month, m.orders, Math.round(m.amount * 100) / 100, Math.round(m.refund * 100) / 100, Math.round(m.net * 100) / 100]);
    });

    let buf;
    try {
      buf = X.buildXlsx([
        { name: '明细', rows: rows },
        { name: '按月汇总', rows: sumRows }
      ]);
    } catch (e) {
      wx.showToast({ title: '生成表格失败', icon: 'none' });
      return;
    }

    const fs = wx.getFileSystemManager && wx.getFileSystemManager();
    if (!fs || !wx.env || !wx.env.USER_DATA_PATH) {
      /* 网页演示版没有文件系统，退回复制 CSV，至少能看 */
      that.exportCsv();
      return;
    }
    const d = new Date();
    const name = '对账单-' + d.getFullYear() + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) +
      (d.getDate() < 10 ? '0' : '') + d.getDate() + '.xlsx';
    const filePath = wx.env.USER_DATA_PATH + '/' + name;
    fs.writeFile({
      filePath: filePath,
      data: buf.buffer,
      success() {
        wx.showToast({ title: '已生成 ' + rows.length - 1 + ' 行', icon: 'none' });
        if (wx.openDocument) {
          wx.openDocument({
            filePath: filePath,
            fileType: 'xlsx',
            showMenu: true,
            fail() {
              wx.showToast({ title: '文件在 ' + filePath, icon: 'none' });
            }
          });
        }
      },
      fail() {
        wx.showToast({ title: '写文件失败', icon: 'none' });
      }
    });
  },

  /* 复制成 CSV（网页演示版兜底；小程序里用不上） */
  exportCsv() {
    const rows = this.data.orders;
    if (!rows.length) {
      wx.showToast({ title: '这一屏没有订单可导出', icon: 'none' });
      return;
    }
    const esc = function (v) {
      const s = String(v === undefined || v === null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const head = ['订单号', '时间', '状态', '买家', '电话', '地址', '商品', '件数', '金额', '运单'];
    const lines = [head.join(',')];
    rows.forEach(function (o) {
      lines.push([
        o.no, o.timeText, o.statusText, o.buyer, o.phone, o.address,
        o.itemsText, o.qty, o.amountText, o.trackText
      ].map(esc).join(','));
    });
    wx.setClipboardData({
      data: lines.join('\n'),
      success() {
        wx.showToast({ title: '已复制 ' + rows.length + ' 行，粘到表格里就行', icon: 'none' });
      }
    });
  },

  /* ---------- 退货 ---------- */
  openReturn(e) {
    const id = e.currentTarget.dataset.id;
    /* 云端订单不在本地 store 里，优先用列表里带回来的原始对象 */
    const o = (this.rawMap || {})[id] || store.getOrder(id);
    if (!o) return;
    const doneIdx = (o.returnedItems || []).map(function (r) { return r.index; });
    const items = o.items.map(function (it, i) {
      return {
        index: i,
        name: it.name,
        spec: it.color + ' / ' + it.size,
        qty: it.qty,
        price: it.price,
        priceText: F.yuan(it.price * it.qty),
        returned: doneIdx.indexOf(i) >= 0,
        picked: doneIdx.indexOf(i) < 0
      };
    });
    this.setData({
      returnTarget: id,
      returnItems: items,
      returnReason: ''
    });
  },

  closeReturn() {
    this.setData({ returnTarget: null, returnItems: [] });
  },

  toggleReturnItem(e) {
    const i = Number(e.currentTarget.dataset.i);
    const items = this.data.returnItems.map(function (it, k) {
      if (k !== i || it.returned) return it;
      return Object.assign({}, it, { picked: !it.picked });
    });
    this.setData({ returnItems: items });
  },

  onReturnReason(e) {
    this.setData({ returnReason: e.detail.value });
  },

  doReturn() {
    const idx = this.data.returnItems.filter(function (it) {
      return it.picked && !it.returned;
    }).map(function (it) { return it.index; });
    if (!idx.length) {
      wx.showToast({ title: '先勾选要退的商品', icon: 'none' });
      return;
    }
    const that = this;
    api.returnHandle(this.data.returnTarget, idx, this.data.returnReason).then(function (r) {
      if (!r || !r.ok) {
        wx.showToast({ title: (r && r.msg) || '处理失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: '已退 ¥' + F.yuan(r.refund), icon: 'none' });
      that.closeReturn();
      that.load();
    });
  },

  /* ---------- 商品维护 ---------- */
  toggleSale(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    /* 直接信开关的新状态：云端商品不一定在本地 store 里，别拿本地当准 */
    const next = e.detail && typeof e.detail.value === 'boolean'
      ? e.detail.value
      : !(this.findProduct(id).onSale === false);
    api.updateProduct(id, { onSale: next }).then(function (r) {
      if (!r || !r.ok) {
        wx.showToast({ title: (r && r.msg) || '改不动', icon: 'none' });
        that.load();
        return;
      }
      wx.showToast({ title: next ? '已上架' : '已下架', icon: 'none' });
      that.load();
    });
  },

  /* 商品优先从当前这一屏（可能是云端的）里找，找不到再看本地 */
  findProduct(id) {
    const hit = (this.data.products || []).filter(function (p) {
      return p.id === id;
    })[0];
    return hit || store.getProduct(id) || {};
  },

  openEdit(e) {
    const id = e.currentTarget.dataset.id;
    const p = this.findProduct(id);
    if (!p) return;
    this.setData({
      editTarget: id,
      editName: p.name,
      editPrice: String(p.price),
      editStock: String(p.stock),
      editImage: p.image
    });
  },

  closeEdit() {
    this.setData({ editTarget: null });
  },

  onEditName(e) {
    this.setData({ editName: e.detail.value });
  },

  onEditPrice(e) {
    this.setData({ editPrice: e.detail.value });
  },

  onEditStock(e) {
    this.setData({ editStock: e.detail.value });
  },

  /* 店主自己拍实物图：拍完直接传到云存储，商品里存 fileID。
     为什么不存本地临时路径：tempFilePath 关掉小程序就失效，换台手机更看不到。 */
  uploadPhoto(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    if (!wx.chooseMedia) {
      wx.showToast({ title: '演示版不支持选图，正式版可拍照上传', icon: 'none' });
      return;
    }
    if (!api.ready()) {
      wx.showToast({ title: '联网后才能换图（现在换只在当前手机有效）', icon: 'none' });
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success(res) {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        that.markUploading(id, true);
        api.uploadImage(f.tempFilePath, id).then(function (r) {
          if (!r || !r.ok) {
            that.markUploading(id, false);
            wx.showToast({ title: (r && r.msg) || '上传失败', icon: 'none' });
            return;
          }
          api.updateProduct(id, { image: r.fileID }).then(function (w) {
            that.markUploading(id, false);
            if (!w || !w.ok) {
              wx.showToast({ title: (w && w.msg) || '保存失败', icon: 'none' });
              return;
            }
            wx.showToast({ title: '图已换好', icon: 'none' });
            that.load();
          });
        });
      }
    });
  },

  markUploading(id, on) {
    const products = (this.data.products || []).map(function (p) {
      if (p.id !== id) return p;
      return Object.assign({}, p, { uploading: !!on });
    });
    this.setData({ products: products });
  },

  /* 店主自己拍实物图：接云开发后换成上传云存储拿 fileID */
  pickImage() {
    const that = this;
    if (!wx.chooseMedia) {
      wx.showToast({ title: '演示版不支持选图，正式版可拍照上传', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success(res) {
        const f = res.tempFiles && res.tempFiles[0];
        if (f) that.setData({ editImage: f.tempFilePath });
      }
    });
  },

  doEdit() {
    const that = this;
    const id = this.data.editTarget;
    const patch = {
      name: this.data.editName,
      price: this.data.editPrice,
      stock: this.data.editStock
    };
    /* 只有云存储 fileID / 小程序自带图才回写；本地临时路径存进去是死链 */
    const img = this.data.editImage || '';
    if (/^cloud:\/\//.test(img) || /^\/images\//.test(img)) patch.image = img;
    api.updateProduct(id, patch).then(function (r) {
      if (!r || !r.ok) {
        wx.showToast({ title: (r && r.msg) || '保存失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: '已保存' });
      that.closeEdit();
      that.load();
    });
  },

  /* ---------- 其它 ---------- */
  copyPhone(e) {
    wx.setClipboardData({ data: e.currentTarget.dataset.phone });
  },

  copyTrack(e) {
    const o = this.data.orders.filter(function (x) {
      return x.id === e.currentTarget.dataset.id;
    })[0];
    if (o) wx.setClipboardData({ data: o.trackText });
  },

  copyNo(e) {
    const o = this.data.orders.filter(function (x) {
      return x.id === e.currentTarget.dataset.id;
    })[0];
    if (o) wx.setClipboardData({ data: o.no });
  },

  demoAction() {
    if (this.data.hasDemo) {
      const that = this;
      wx.showModal({
        title: '清掉演示订单？',
        content: '只删除标了「演示」的订单，真实下单不受影响。',
        success(res) {
          if (!res.confirm) return;
          store.clearDemoOrders();
          that.load();
        }
      });
      return;
    }
    const n = store.seedDemoOrders();
    wx.showToast({ title: '已生成 ' + n + ' 笔演示订单', icon: 'none' });
    this.load();
  },

  exit() {
    getApp().globalData.adminUnlocked = false;
    wx.navigateBack();
  }
});

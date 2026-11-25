const store = require('../../utils/store');
const F = require('../../utils/format');
const api = require('../../utils/api');

const TONE = {
  pending_pay: 'warm',
  paid: 'green',
  shipped: 'green',
  return_pending: 'warm',
  done: 'muted',
  cancelled: 'muted',
  refunded: 'muted'
};

/* 一页 20 单，滑到底再拉下一页（和云函数的 PAGE_SIZE 对齐） */
const PAGE = 20;

Page({
  data: {
    tabs: store.TABS,
    tab: 'all',
    list: [],
    keyword: '',
    hasMore: false,
    loadingMore: false,
    loading: false
  },

  onLoad(query) {
    if (query && query.tab) this.setData({ tab: query.tab });
  },

  onShow() {
    this.load();
    getApp().updateCartBadge();
  },

  /* 微信原生列表的分页钩子：滑到底自动拉下一页 */
  onReachBottom() {
    this.loadMore();
  },

  load() {
    /* 先用手上的本地数据立刻渲染（网页演示版、没开云时就是这个），
       有云再把服务端的订单列表盖上来——服务端那份才是真的。 */
    this.render(store.orderList(this.data.tab));
    if (!api.ready()) return;
    const that = this;
    const tab = this.data.tab;
    this.skip = 0;
    this.setData({ loading: true });
    api.listOrders(tab, { limit: PAGE, skip: 0 }).then(function (r) {
      that.setData({ loading: false });
      if (!r || !r.ok || !r.list) return;
      if (that.data.tab !== tab) return;
      that.skip = r.list.length;
      that.render(r.list);
      that.setData({ hasMore: !!r.hasMore });
    });
  },

  loadMore() {
    if (!api.ready() || !this.data.hasMore || this.data.loadingMore) return;
    const that = this;
    const tab = this.data.tab;
    const skip = this.skip || 0;
    this.setData({ loadingMore: true });
    api.listOrders(tab, { limit: PAGE, skip: skip }).then(function (r) {
      that.setData({ loadingMore: false });
      if (!r || !r.ok || !r.list) return;
      if (that.data.tab !== tab) return;
      that.skip = skip + r.list.length;
      that.render((that.rawList || []).concat(r.list));
      that.setData({ hasMore: !!r.hasMore });
    });
  },

  onKeyword(e) {
    const kw = e.detail.value;
    const list = (this.baseList || []).filter(function (o) {
      if (!kw) return true;
      return String([o.name, o.no, o.statusText, o.spec].join(' ')).toLowerCase()
        .indexOf(kw.toLowerCase()) >= 0;
    });
    this.setData({ keyword: kw, list: list });
  },

  clearKeyword() {
    this.setData({ keyword: '', list: this.baseList || [] });
  },

  render(list) {
    this.rawList = list || [];
    const rows = this.rawList.map(function (o) {
      const items = o.items || [];
      const first = items[0] || {};
      const count = items.reduce(function (a, b) { return a + b.qty; }, 0);
      return {
        id: o.id || o._id,
        no: o.no,
        status: o.status,
        statusText: (store.STATUS[o.status] || {}).text || '',
        tone: TONE[o.status] || 'muted',
        image: first.image,
        name: first.name + (items.length > 1 ? ' 等 ' + items.length + ' 种' : ''),
        spec: first.color + ' · ' + first.size,
        count: count,
        amountText: F.yuan(o.amount),
        timeText: F.shortDate(o.createdAt),
        tracking: o.tracking ? o.tracking.company + ' ' + o.tracking.no : ''
      };
    });
    this.baseList = rows;
    const kw = this.data.keyword;
    const shown = kw ? rows.filter(function (r) {
      return String([r.name, r.no, r.statusText, r.spec].join(' ')).toLowerCase()
        .indexOf(kw.toLowerCase()) >= 0;
    }) : rows;
    this.setData({ list: shown });
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.key, keyword: '' }, this.load);
  },

  goOrder(e) {
    wx.navigateTo({ url: '/pages/order/order?id=' + e.currentTarget.dataset.id });
  },

  goPay(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/pay/pay?id=' + id });
  },

  confirmReceive(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    wx.showModal({
      title: '收到货了吗？',
      content: '确认后积分到账，累计消费也会记入会员额度。',
      confirmText: '确认收货',
      success(res) {
        if (!res.confirm) return;
        api.confirm(id).then(function (r) {
          wx.showToast({ title: (r && r.ok) ? '已确认，积分已到账' : ((r && r.msg) || '操作失败'), icon: 'none' });
          that.load();
        });
      }
    });
  },

  goShop() {
    wx.switchTab({ url: '/pages/home/home' });
  }
});

const D = require('../../utils/data');
const store = require('../../utils/store');
const api = require('../../utils/api');

Page({
  data: {
    items: [],
    goods: 0,
    shipping: 0,
    memberDiscount: 0,
    discount: 0,
    amount: 0,
    delivery: 'express',
    address: { name: '', phone: '', detail: '' },
    usePoints: false,
    available: 0,
    availableYuan: 0,
    maxDiscount: 0,
    maxUse: 0,
    remark: '',
    member: null,
    store: D.STORE,
    addresses: [],
    submitting: false
  },

  onLoad() {
    const app = getApp();
    const draft = app.globalData.checkoutDraft;
    if (!draft || !draft.items || !draft.items.length) {
      wx.showToast({ title: '没有待结算的商品', icon: 'none' });
      setTimeout(function () { wx.navigateBack(); }, 700);
      return;
    }
    this.draft = draft;
    const items = draft.items.map(function (it) {
      const p = store.getProduct(it.productId);
      if (!p) return null;
      return {
        productId: p.id,
        name: p.name,
        image: p.image,
        color: it.color,
        size: it.size,
        qty: it.qty,
        price: p.price
      };
    }).filter(Boolean);
    const goods = items.reduce(function (a, b) { return a + b.price * b.qty; }, 0);
    const pts = store.points();
    const m = store.member();
    /* 会员先 96 折，积分再按折后价的 5% 封顶抵扣 */
    const memberDiscount = m.isMember ? Math.round(goods * (1 - m.rate)) : 0;
    const maxDiscount = Math.floor((goods - memberDiscount) * store.MAX_DISCOUNT_RATE);
    const maxUse = Math.min(maxDiscount, Math.floor(pts.available / store.POINTS_PER_YUAN));
    const saved = store.getAddress();
    this.setData({
      items: items,
      goods: goods,
      available: pts.available,
      availableYuan: Math.floor(pts.available / store.POINTS_PER_YUAN),
      member: m,
      memberDiscount: memberDiscount,
      maxDiscount: maxDiscount,
      maxUse: maxUse,
      usePoints: maxUse > 0,
      address: saved ? { name: saved.name, phone: saved.phone, detail: saved.detail } : this.data.address
    }, this.calc);

    /* 地址簿可能在云端（换手机也有），本地只是兜底：
       有地址就把默认那条填上，用户也可以点「地址簿」换 */
    this.loadAddresses();
  },

  loadAddresses() {
    const that = this;
    api.listAddresses().then(function (r) {
      const list = (r && r.ok && r.addresses) || [];
      const patch = { addresses: list };
      const cur = that.data.address;
      const def = list.filter(function (a) { return a.isDefault; })[0] || list[0];
      /* 用户已经手填过就别覆盖 */
      if (def && !cur.name && !cur.phone && !cur.detail) {
        patch.address = { name: def.name, phone: def.phone, detail: def.detail };
      }
      that.setData(patch);
    });
  },

  openAddressBook() {
    wx.navigateTo({ url: '/pages/address/address?select=1' });
  },

  onShow() {
    const app = getApp();
    const picked = app.globalData.pickedAddress;
    if (picked) {
      app.globalData.pickedAddress = null;
      this.setData({
        address: { name: picked.name, phone: picked.phone, detail: picked.detail }
      });
    }
    const pts = store.points();
    if (pts.available !== this.data.available) {
      const maxUse = Math.min(this.data.maxDiscount, Math.floor(pts.available / store.POINTS_PER_YUAN));
      this.setData({
        available: pts.available,
        availableYuan: Math.floor(pts.available / store.POINTS_PER_YUAN),
        maxUse: maxUse,
        usePoints: this.data.usePoints && maxUse > 0
      }, this.calc);
    }
  },

  calc() {
    const d = this.data;
    const shipping = d.delivery === 'pickup' ? 0 : d.goods >= store.FREE_SHIPPING ? 0 : store.EXPRESS_FEE;
    const discount = d.usePoints ? Math.min(d.maxDiscount, d.maxUse) : 0;
    const amount = Math.max(0, d.goods - d.memberDiscount - discount + shipping);
    this.setData({ shipping: shipping, discount: discount, amount: amount });
  },

  setDelivery(e) {
    this.setData({ delivery: e.currentTarget.dataset.d }, this.calc);
  },

  onAddrInput(e) {
    const field = e.currentTarget.dataset.field;
    const patch = {};
    patch['address.' + field] = e.detail.value;
    this.setData(patch);
  },

  togglePoints(e) {
    this.setData({ usePoints: e.detail.value }, this.calc);
  },

  onRemark(e) {
    this.setData({ remark: e.detail.value });
  },

  submit() {
    if (this.data.submitting) return;
    const that = this;
    const d = this.data;
    if (d.delivery === 'express') {
      if (!d.address.name || !d.address.phone || !d.address.detail) {
        wx.showToast({ title: '收货信息还没填完', icon: 'none' });
        return;
      }
      if (!/^1\d{10}$/.test(d.address.phone)) {
        wx.showToast({ title: '手机号好像少了一位', icon: 'none' });
        return;
      }
    }
    this.setData({ submitting: true });
    /* 下单走 api：有云时由云函数算价、扣积分、扣库存；没云时退回本地 store。
       价格一律以返回的订单为准——页面上的数字只是给用户看的预估。 */
    api.createOrder({
      items: this.draft.items,
      delivery: d.delivery,
      address: d.address,
      usePoints: d.usePoints,
      remark: d.remark,
      cartKeys: this.draft.cartKeys || []
    }).then(function (res) {
      that.setData({ submitting: false });
      if (!res || !res.ok) {
        wx.showToast({ title: (res && res.msg) || '下单失败', icon: 'none' });
        return;
      }
      const order = res.order || {};
      getApp().globalData.checkoutDraft = null;
      wx.redirectTo({ url: '/pages/pay/pay?id=' + (order.id || order._id) });
    }).catch(function () {
      that.setData({ submitting: false });
      wx.showToast({ title: '下单失败，请重试', icon: 'none' });
    });
  }
});

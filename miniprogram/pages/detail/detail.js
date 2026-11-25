const D = require('../../utils/data');
const store = require('../../utils/store');
const sizeTool = require('../../utils/size');

Page({
  data: {
    p: null,
    colorIndex: 0,
    sizeIndex: -1,
    qty: 1,
    cartCount: 0,
    sizeOpen: false,
    guideTab: 'adult',
    guide: D.SIZE_GUIDE,
    fitH: '',
    fitResult: null,
    fitError: '',
    maxDiscount: 0,
    canUse: 0,
    related: []
  },

  onLoad(query) {
    const p = store.getProduct(query.id);
    if (!p) {
      wx.showToast({ title: '商品不见了', icon: 'none' });
      setTimeout(function () { wx.navigateBack(); }, 800);
      return;
    }
    wx.setNavigationBarTitle({ title: p.short });
    const maxDiscount = Math.floor(p.price * store.MAX_DISCOUNT_RATE);
    const pts = store.points();
    const related = store.queryProducts({ school: p.school }).filter(function (x) {
      return x.id !== p.id;
    }).slice(0, 4);
    this.setData({
      p: p,
      maxDiscount: maxDiscount,
      canUse: Math.min(maxDiscount, Math.floor(pts.available / 100)),
      guideTab: p.stage === '小学' ? 'kid' : 'adult',
      sizeIndex: p.sizes.length === 1 ? 0 : -1,
      related: related
    });
  },

  onShow() {
    this.setData({ cartCount: store.cartCount() });
    getApp().updateCartBadge();
  },

  preview() {
    wx.previewImage({ urls: [this.data.p.image], current: this.data.p.image });
  },

  pickColor(e) {
    this.setData({ colorIndex: Number(e.currentTarget.dataset.i) });
  },

  pickSize(e) {
    this.setData({ sizeIndex: Number(e.currentTarget.dataset.i) });
  },

  minus() {
    this.setData({ qty: Math.max(1, this.data.qty - 1) });
  },

  plus() {
    this.setData({ qty: Math.min(20, this.data.qty + 1) });
  },

  openSize() {
    this.setData({ sizeOpen: true });
  },

  closeSize() {
    this.setData({ sizeOpen: false });
  },

  switchGuide(e) {
    this.setData({ guideTab: e.currentTarget.dataset.tab });
  },

  onFitInput(e) {
    this.setData({ fitH: e.detail.value, fitError: '', fitResult: null });
  },

  doFit() {
    const res = sizeTool.recommend(this.data.p, this.data.fitH);
    if (!res.ok) {
      this.setData({ fitError: res.msg, fitResult: null });
      return;
    }
    this.setData({ fitResult: res, fitError: '' });
  },

  applyFit() {
    const r = this.data.fitResult;
    if (!r) return;
    this.setData({ sizeIndex: r.index, sizeOpen: false });
    wx.showToast({ title: '已选 ' + r.size + ' 码', icon: 'none' });
  },

  buildItem() {
    const d = this.data;
    const p = d.p;
    if (d.sizeIndex < 0) {
      this.setData({ sizeOpen: true });
      wx.showToast({ title: '先选一个尺码', icon: 'none' });
      return null;
    }
    return {
      productId: p.id,
      color: p.colors[d.colorIndex].name,
      size: p.sizes[d.sizeIndex],
      qty: d.qty
    };
  },

  addCart() {
    const item = this.buildItem();
    if (!item) return;
    const res = store.addToCart(item);
    if (res.ok) {
      this.setData({ cartCount: store.cartCount() });
      getApp().updateCartBadge();
      wx.showToast({ title: '已放进购物车', icon: 'none' });
    } else {
      wx.showToast({ title: res.msg || '加购失败', icon: 'none' });
    }
  },

  buyNow() {
    const item = this.buildItem();
    if (!item) return;
    getApp().globalData.checkoutDraft = {
      from: 'buy',
      items: [item]
    };
    wx.navigateTo({ url: '/pages/checkout/checkout' });
  },

  goCart() {
    wx.switchTab({ url: '/pages/cart/cart' });
  },

  goPoints() {
    wx.navigateTo({ url: '/pages/points/points' });
  },

  contact() {
    const s = D.STORE;
    wx.showModal({
      title: '问店长',
      content: '电话：' + s.phone + '\n微信：' + s.wechat + '\n\n报上学校和身高，店长会帮你选码。',
      confirmText: '复制微信',
      cancelText: '知道了',
      success(res) {
        if (res.confirm) wx.setClipboardData({ data: s.wechat });
      }
    });
  },

  onShareAppMessage() {
    const p = this.data.p;
    return {
      title: p ? p.name : '兰欧茜校服',
      path: p ? '/pages/detail/detail?id=' + p.id : '/pages/home/home',
      imageUrl: p ? p.image : '/images/share.png'
    };
  }
});

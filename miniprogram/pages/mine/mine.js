const store = require('../../utils/store');
const api = require('../../utils/api');
const D = require('../../utils/data');

Page({
  data: {
    points: 0,
    member: null,
    counts: { pay: 0, ship: 0, receive: 0, done: 0 },
    adminUnlocked: false,
    isAdmin: false,
    canAdmin: false,
    store: D.STORE,
    version: 'v0.5'
  },

  onShow() {
    this.load();
    getApp().updateCartBadge();
  },

  load() {
    const pts = store.points();
    const all = store.orderList('all');
    const count = function (keys) {
      return all.filter(function (o) {
        return keys.indexOf(o.status) >= 0;
      }).length;
    };
    this.setData({
      points: pts.available,
      member: store.member(),
      counts: {
        pay: count(['pending_pay']),
        ship: count(['paid']),
        receive: count(['shipped']),
        done: count(['done', 'return_pending', 'refunded'])
      },
      adminUnlocked: !!getApp().globalData.adminUnlocked
    });
    /* 有云时用服务端的积分和会员状态刷新一次：积分是钱，不能只信本地 */
    if (!api.ready()) return;
    const that = this;
    api.me().then(function (r) {
      if (!r || !r.ok || !r.user) return;
      const patch = { points: r.user.points };
      if (r.user.isMember !== undefined) {
        patch.member = Object.assign({}, that.data.member, { isMember: !!r.user.isMember });
      }
      that.setData(patch);
    });
    /* 店长入口只给店长看：admins 里有这个 openid 才出现。
       家长端不该看到「店长入口」四个字，也不该有口令这道门。 */
    api.adminStats().then(function (r) {
      const isAdmin = !!(r && r.ok);
      that.setData({ isAdmin: isAdmin, canAdmin: isAdmin });
    });
  },

  goOrders(e) {
    const tab = e.currentTarget.dataset.tab || 'all';
    wx.navigateTo({ url: '/pages/orders/orders?tab=' + tab });
  },

  goPoints() {
    wx.navigateTo({ url: '/pages/points/points' });
  },

  address() {
    const a = store.getAddress();
    if (!a) {
      wx.showToast({ title: '下单时填写，会自动记住', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '默认收货地址',
      content: a.name + ' ' + a.phone + '\n' + a.detail,
      confirmText: '知道了',
      showCancel: false
    });
  },

  contact() {
    wx.showModal({
      title: '联系店长',
      content: D.STORE.name + '\n微信：' + D.STORE.wechat + '\n电话：' + D.STORE.phone + '\n' + D.STORE.hours,
      confirmText: '复制微信',
      success(res) {
        if (res.confirm) wx.setClipboardData({ data: D.STORE.wechat });
      }
    });
  },

  goAdmin() {
    if (this.data.isAdmin || getApp().globalData.adminUnlocked) {
      wx.navigateTo({ url: '/pages/admin/admin' });
      return;
    }
    wx.showModal({
      title: '店长入口',
      editable: true,
      placeholderText: '请输入店长口令',
      confirmText: '进入',
      success(res) {
        if (!res.confirm) return;
        if (!store.verifyAdmin(res.content)) {
          wx.showToast({ title: '口令不对', icon: 'none' });
          return;
        }
        getApp().globalData.adminUnlocked = true;
        wx.navigateTo({ url: '/pages/admin/admin' });
      }
    });
  },

  about() {
    wx.showModal({
      title: '关于兰欧茜',
      content: D.STORE.name + '\n' + D.STORE.slogan + '\n\n演示版 v0.5 · 2026.11\n商品图现由店长在后台自行更换为实物照片。',
      confirmText: '知道了',
      showCancel: false
    });
  },

  goShop() {
    wx.switchTab({ url: '/pages/home/home' });
  }
});

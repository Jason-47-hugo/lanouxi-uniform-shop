const store = require('../../utils/store');
const F = require('../../utils/format');
const api = require('../../utils/api');

Page({
  data: {
    order: null,
    amountText: '0',
    goodsText: '0',
    memberText: '0',
    discountText: '0',
    shippingText: '0',
    paying: false
  },

  onLoad(query) {
    this.id = query.id;
    this.load();
  },

  onShow() {
    this.load();
  },

  load() {
    /* 订单可能只存在于云端（本地没有缓存），所以问 api 要，本地只是兜底。
       之前这里直接读 store，云上下单后进来就报「订单不见了」。 */
    const that = this;
    const local = store.getOrder(this.id);
    if (local) {
      this.render(local);
      return;
    }
    api.getOrder(this.id).then(function (r) {
      if (!r || !r.ok || !r.order) {
        wx.showToast({ title: (r && r.msg) || '订单不见了', icon: 'none' });
        setTimeout(function () { wx.redirectTo({ url: '/pages/orders/orders' }); }, 700);
        return;
      }
      that.render(r.order);
    });
  },

  render(o) {
    if (o.status !== 'pending_pay') {
      wx.redirectTo({ url: '/pages/order/order?id=' + (o.id || o._id) });
      return;
    }
    this.setData({
      order: o,
      amountText: F.yuan(o.amount),
      goodsText: F.yuan(o.goods),
      memberText: F.yuan(o.memberDiscount || 0),
      discountText: F.yuan(o.discount || 0),
      shippingText: F.yuan(o.shipping || 0)
    });
  },

  copyNo() {
    if (!this.data.order) return;
    wx.setClipboardData({ data: this.data.order.no });
  },

  /* 真实上线时这里调用云函数统一下单拿 payment 参数，
     再 wx.requestPayment() 唤起微信收银台；演示版直接标记支付成功。 */
  pay() {
    if (this.data.paying) return;
    const that = this;
    const amount = this.data.amountText;
    wx.showModal({
      title: '微信支付',
      content: '演示版不会真实扣款。确认后模拟支付 ¥' + amount + '，订单直接进入待发货。',
      confirmText: '确认支付',
      cancelText: '再想想',
      success(res) {
        if (!res.confirm) return;
        that.setData({ paying: true });
        setTimeout(function () {
          /* 支付走 api：接真商户号后这里换成 wx.requestPayment，
             订单状态只认云函数返回，前端改不动 */
          api.pay(that.id).then(function (r) {
            that.setData({ paying: false });
            if (!r || !r.ok) {
              wx.showToast({ title: (r && r.msg) || '订单状态已变化', icon: 'none' });
              return;
            }
            wx.showToast({ title: '支付成功', icon: 'success' });
            setTimeout(function () {
              wx.redirectTo({ url: '/pages/order/order?id=' + that.id });
            }, 700);
          }).catch(function () {
            that.setData({ paying: false });
            wx.showToast({ title: '支付失败，请重试', icon: 'none' });
          });
        }, 500);
      }
    });
  },

  later() {
    wx.redirectTo({ url: '/pages/orders/orders' });
  }
});

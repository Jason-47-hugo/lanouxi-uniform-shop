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

  /* 真实支付：先让云函数统一下单拿支付参数，再 wx.requestPayment；
     付完调 confirmPay 让服务端查单确认（不依赖公网回调）。
     云函数没配商户号时，createPayment 返回 payReady:false，退回「到店付款」提示。 */
  pay() {
    if (this.data.paying) return;
    const that = this;
    this.setData({ paying: true });

    api.createPayment(this.id).then(function (r) {
      if (!r || !r.ok) {
        that.setData({ paying: false });
        if (r && r.payReady === false) {
          wx.showModal({
            title: '在线支付还没开通',
            content: '可以到店付款，或微信转账给店长，付款后店长会把这单标成已付款。',
            showCancel: false,
            confirmText: '知道了'
          });
          return;
        }
        wx.showToast({ title: (r && r.msg) || '下单失败，请重试', icon: 'none' });
        return;
      }
      if (!r.payParams) {
        that.finalize();
        return;
      }
      that.requestPay(r);
    }).catch(function () {
      that.setData({ paying: false });
      wx.showToast({ title: '网络不太好，请重试', icon: 'none' });
    });
  },

  /* 付完了（或演示版直接成功）：让服务端查单确认，再跳订单详情 */
  finalize() {
    const that = this;
    api.confirmPay(this.id).then(function (c) {
      that.setData({ paying: false });
      if (c && c.ok) {
        wx.showToast({ title: '支付成功', icon: 'success' });
        setTimeout(function () {
          wx.redirectTo({ url: '/pages/order/order?id=' + that.id });
        }, 700);
        return;
      }
      wx.showToast({ title: (c && c.msg) || '正在确认付款…', icon: 'none' });
      setTimeout(function () { that.load(); }, 1500);
    }).catch(function () {
      that.setData({ paying: false });
      wx.showToast({ title: '正在确认付款…', icon: 'none' });
    });
  },

  requestPay(r) {
    const that = this;
    const p = r.payParams || {};
    wx.requestPayment({
      timeStamp: p.timeStamp,
      nonceStr: p.nonceStr,
      package: p.package,
      signType: p.signType || 'RSA',
      paySign: p.paySign,
      success() {
        that.finalize();
      },
      fail(err) {
        that.setData({ paying: false });
        const msg = err && err.errMsg ? err.errMsg : '';
        if (msg.indexOf('cancel') >= 0) {
          wx.showToast({ title: '已取消支付', icon: 'none' });
          return;
        }
        wx.showToast({ title: '支付没成功，可以再试一次', icon: 'none' });
      }
    });
  },

  later() {
    wx.redirectTo({ url: '/pages/orders/orders' });
  }
});

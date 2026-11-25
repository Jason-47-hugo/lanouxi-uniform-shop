const store = require('../../utils/store');
const api = require('../../utils/api');
const F = require('../../utils/format');
const D = require('../../utils/data');

const STEPS = ['下单', '付款', '发货', '收货'];
const STEP_INDEX = {
  pending_pay: 1,
  paid: 2,
  shipped: 3,
  return_pending: 4,
  done: 4,
  refunded: 4
};

Page({
  data: {
    order: null,
    steps: STEPS,
    activeStep: 0,
    cancelled: false,
    statusText: '',
    statusHint: '',
    trackingText: '',
    goodsText: '0',
    shippingText: '',
    discountText: '',
    amountText: '0',
    timeText: '',
    updatedText: '',
    timeline: [],
    items: [],
    store: D.STORE
  },

  onLoad(query) {
    this.id = query.id;
  },

  onShow() {
    this.load();
    getApp().updateCartBadge();
  },

  load() {
    /* 先用手上的数据渲染；云端有记录就以云端为准（别人改不了你的单） */
    const local = store.getOrder(this.id);
    if (local) this.render(local);
    const that = this;
    api.getOrder(this.id).then(function (r) {
      if (r && r.ok && r.order) {
        that.render(r.order);
        return;
      }
      if (!local) {
        wx.showToast({ title: (r && r.msg) || '订单不见了', icon: 'none' });
        setTimeout(function () { wx.navigateBack(); }, 700);
      }
    });
  },

  render(o) {
    const st = store.STATUS[o.status] || {};
    const active = STEP_INDEX[o.status] || 0;
    const timeline = (o.timeline || []).slice().reverse().map(function (t, i) {
      return { label: t.label, timeText: F.dateTime(t.time), latest: i === 0 };
    });
    const steps = STEPS.map(function (label, i) {
      return {
        label: label,
        cls: i < active ? 'done' : i === active && active < 4 ? 'now' : '',
        lineOn: i < active
      };
    });
    this.setData({
      order: o,
      cancelled: o.status === 'cancelled',
      steps: steps,
      statusText: st.text || '',
      statusHint: st.hint || '',
      trackingText: o.tracking ? o.tracking.company + ' ' + o.tracking.no : '',
      goodsText: F.yuan(o.goods),
      shippingText: o.shipping > 0 ? '¥' + F.yuan(o.shipping) : '包邮',
      discountText: o.discount > 0 ? '-¥' + F.yuan(o.discount) : '',
      amountText: F.yuan(o.amount),
      timeText: F.dateTime(o.createdAt),
      updatedText: F.dateTime(o.updatedAt),
      timeline: timeline,
      items: (o.items || []).map(function (it) {
        return Object.assign({}, it, { priceText: F.yuan(it.price) });
      })
    });
  },

  copyNo() {
    if (!this.data.order) return;
    wx.setClipboardData({ data: this.data.order.no });
  },

  goPay() {
    wx.navigateTo({ url: '/pages/pay/pay?id=' + this.id });
  },

  confirmReceive() {
    const that = this;
    wx.showModal({
      title: '收到货了吗？',
      content: '确认后这一单的购物积分到账，累计消费也会记入会员额度。',
      confirmText: '确认收货',
      success(res) {
        if (!res.confirm) return;
        api.confirm(that.id).then(function (r) {
          if (!r || !r.ok) {
            wx.showToast({ title: (r && r.msg) || '现在还不能确认收货', icon: 'none' });
            return;
          }
          wx.showToast({ title: '交易完成，积分已到账' });
          that.load();
        });
      }
    });
  },

  applyReturn() {
    const that = this;
    wx.showModal({
      title: '申请退货',
      content: '店长同意后货款原路退回，这一单用掉的积分也会按比例退回。',
      confirmText: '申请退货',
      confirmColor: '#B65B3C',
      success(res) {
        if (!res.confirm) return;
        api.returnApply(that.id).then(function (r) {
          wx.showToast({ title: (r && r.ok) ? '已提交给店长' : ((r && r.msg) || '操作失败'), icon: 'none' });
          if (r && r.ok) that.load();
        });
      }
    });
  },

  cancel() {
    const that = this;
    wx.showModal({
      title: '取消这单？',
      content: '这一单还没付款，取消后不会产生任何费用。',
      confirmText: '取消订单',
      confirmColor: '#B65B3C',
      success(res) {
        if (!res.confirm) return;
        api.cancel(that.id).then(function (r) {
          wx.showToast({ title: (r && r.ok) ? '订单已取消' : ((r && r.msg) || '当前状态不能取消'), icon: 'none' });
          if (r && r.ok) that.load();
        });
      }
    });
  },

  contact() {
    wx.showModal({
      title: '联系店长',
      content: D.STORE.name + '\n微信：' + D.STORE.wechat + '\n电话：' + D.STORE.phone,
      confirmText: '复制微信',
      success(res) {
        if (res.confirm) wx.setClipboardData({ data: D.STORE.wechat });
      }
    });
  },

  callStore() {
    wx.makePhoneCall({ phoneNumber: D.STORE.phone });
  },

  goShop() {
    wx.switchTab({ url: '/pages/home/home' });
  }
});

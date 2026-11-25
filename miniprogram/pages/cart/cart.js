const store = require('../../utils/store');

Page({
  data: {
    list: [],
    summary: { total: 0, count: 0, allSelected: false }
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    this.setData({
      list: store.getCart(),
      summary: store.cartSummary()
    });
    getApp().updateCartBadge();
  },

  toggle(e) {
    store.toggleSelect(e.currentTarget.dataset.key);
    this.refresh();
  },

  toggleAll() {
    store.selectAll(!this.data.summary.allSelected);
    this.refresh();
  },

  minus(e) {
    store.changeQty(e.currentTarget.dataset.key, -1);
    this.refresh();
  },

  plus(e) {
    store.changeQty(e.currentTarget.dataset.key, 1);
    this.refresh();
  },

  remove(e) {
    const key = e.currentTarget.dataset.key;
    const that = this;
    wx.showModal({
      title: '移出购物车',
      content: '确定不要这件了吗？',
      confirmColor: '#b65b3c',
      success(res) {
        if (res.confirm) {
          store.removeCart(key);
          that.refresh();
        }
      }
    });
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id });
  },

  goShopping() {
    wx.switchTab({ url: '/pages/home/home' });
  },

  checkout() {
    const items = store.selectedCart();
    if (!items.length) {
      wx.showToast({ title: '先勾选要买的', icon: 'none' });
      return;
    }
    getApp().globalData.checkoutDraft = {
      from: 'cart',
      items: items.map(function (i) {
        return {
          productId: i.productId,
          color: i.color,
          size: i.size,
          qty: i.qty
        };
      }),
      cartKeys: items.map(function (i) { return i.key; })
    };
    wx.navigateTo({ url: '/pages/checkout/checkout' });
  }
});

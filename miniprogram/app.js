const store = require('./utils/store');
const cloudApi = require('./utils/cloud');

App({
  globalData: {
    statusBarHeight: 20,
    adminUnlocked: false,
    checkoutDraft: null,
    storePhone: '0756-0000 0000',
    cloudReady: false
  },

  onLaunch() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.globalData.statusBarHeight = info.statusBarHeight || 20;
    } catch (e) {
      this.globalData.statusBarHeight = 20;
    }
    /* 填了环境 ID 且是真机/开发者工具环境时才会真的连云端，否则一律走本地演示 */
    this.globalData.cloudReady = cloudApi.ready();
    store.ensureInit();
  },

  onShow() {
    this.updateCartBadge();
  },

  updateCartBadge() {
    const n = store.cartCount();
    try {
      if (n > 0) {
        wx.setTabBarBadge({ index: 2, text: n > 99 ? '99+' : String(n), fail() {} });
      } else {
        wx.removeTabBarBadge({ index: 2, fail() {} });
      }
    } catch (e) {
      // 非 tabBar 环境（如自定义预览）忽略
    }
  }
});

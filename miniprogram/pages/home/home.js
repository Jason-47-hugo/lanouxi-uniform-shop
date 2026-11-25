const D = require('../../utils/data');
const store = require('../../utils/store');

Page({
  data: {
    statusBarHeight: 20,
    store: D.STORE,
    stages: [
      { key: '小学', mark: '小', label: '小学' },
      { key: '初中', mark: '初', label: '初中' },
      { key: '高中', mark: '高', label: '高中' }
    ],
    entries: [],
    stageTab: '高中',
    schoolTab: [],
    schoolList: [],
    schoolOpen: false,
    schoolMore: '',
    featured: [],
    points: 0,
    cartCount: 0
  },

  onLoad() {
    const app = getApp();
    this.setData({ statusBarHeight: (app && app.globalData.statusBarHeight) || 20 });
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const p = store.points();
    const m = store.member();
    const list = D.SCHOOLS.filter(function (s) {
      return s.stage === this.data.stageTab;
    }.bind(this));
    this.setData({
      entries: [
        { key: 'school', mark: '校', label: '按学校', sub: D.SCHOOLS.length + ' 所' },
        { key: 'summer', mark: '夏', label: '夏装', sub: '短袖' },
        { key: 'formal', mark: '正', label: '正装', sub: '西装' },
        { key: 'points', mark: '积', label: '积分', sub: m.isMember ? '96 折' : '抵现 5%' }
      ],
      schoolTab: list,
      schoolList: this.data.schoolOpen ? list : list.slice(0, 6),
      schoolMore: list.length > 6 && !this.data.schoolOpen ? '还有 ' + (list.length - 6) + ' 所' : '',
      featured: store.featuredProducts(),
      points: p.available,
      cartCount: store.cartCount()
    });
    const app = getApp();
    if (app && app.updateCartBadge) app.updateCartBadge();
  },

  toggleSchool() {
    this.setData({ schoolOpen: !this.data.schoolOpen }, this.refresh);
  },

  pickStage(e) {
    const stage = e.currentTarget.dataset.stage;
    const list = D.SCHOOLS.filter(function (s) {
      return s.stage === stage;
    });
    this.setData({
      stageTab: stage,
      schoolTab: list,
      schoolList: this.data.schoolOpen ? list : list.slice(0, 6),
      schoolMore: list.length > 6 && !this.data.schoolOpen ? '还有 ' + (list.length - 6) + ' 所' : ''
    });
  },

  openCategory(filter) {
    const app = getApp();
    app.globalData.categoryFilter = filter || {};
    wx.switchTab({ url: '/pages/category/category' });
  },

  onQuick(e) {
    const key = e.currentTarget.dataset.key;
    if (key === 'points') {
      wx.navigateTo({ url: '/pages/points/points' });
      return;
    }
    if (key === 'school') {
      this.openCategory({});
      return;
    }
    if (key === 'summer') {
      this.openCategory({ category: '夏装' });
      return;
    }
    this.openCategory({ category: '正装' });
  },

  onSchool(e) {
    this.openCategory({ school: e.currentTarget.dataset.school });
  },

  goAll() {
    this.openCategory({});
  },

  goPoints() {
    wx.navigateTo({ url: '/pages/points/points' });
  },

  contact() {
    const s = D.STORE;
    wx.showModal({
      title: '联系店长',
      content: '电话：' + s.phone + '\n微信：' + s.wechat + '\n\n开学季消息多，加微信时备注“校服 + 学校”会更快回复。',
      confirmText: '复制微信',
      cancelText: '知道了',
      success(res) {
        if (res.confirm) {
          wx.setClipboardData({ data: s.wechat });
        }
      }
    });
  },

  copyAddress() {
    wx.setClipboardData({ data: D.STORE.address });
  },

  callStore() {
    wx.makePhoneCall({ phoneNumber: D.STORE.phone });
  },

  onShareAppMessage() {
    return {
      title: '兰欧茜校服 · 珠海本地校服，到店可试穿',
      path: '/pages/home/home',
      imageUrl: '/images/share.png'
    };
  }
});

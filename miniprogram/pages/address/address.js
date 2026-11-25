/* 收货地址簿：列表 + 弹层编辑。
 *
 * 数据走 api（有云存云、没云存本地），规则（手机号、长度、最多十个）
 * 在 utils/store.js 和服务端各有一份，页面只负责收集和提示。
 * 从结算页进来（?select=1）时，点一条就回填并返回。
 */

const api = require('../../utils/api');
const store = require('../../utils/store');

const EMPTY = { id: '', name: '', phone: '', detail: '', tag: '', isDefault: false };

Page({
  data: {
    list: [],
    loading: true,
    selectMode: false,
    formOpen: false,
    form: EMPTY,
    formError: '',
    saving: false
  },

  onLoad(query) {
    /* 先拿本地那份同步渲染（预览工具是同步渲染的），云端回来再覆盖 */
    this.setData({
      selectMode: !!(query && query.select === '1'),
      list: store.getAddresses(),
      loading: false
    });
    this.load();
  },

  onShow() {
    /* 从别处返回时刷新一下，比如刚在别的地方存过 */
    if (!this.data.loading) this.load();
  },

  load() {
    const that = this;
    return api.listAddresses().then(function (r) {
      that.setData({
        list: (r && r.ok && r.addresses) || [],
        loading: false
      });
    });
  },

  pick(e) {
    const id = e.currentTarget.dataset.id;
    const at = this.data.list.filter(function (x) { return x.id === id; })[0];
    if (!at) return;
    if (!this.data.selectMode) {
      this.openWith(at);
      return;
    }
    getApp().globalData.pickedAddress = {
      id: at.id,
      name: at.name,
      phone: at.phone,
      detail: at.detail
    };
    wx.navigateBack();
  },

  add() {
    this.openWith(EMPTY);
  },

  edit(e) {
    const id = e.currentTarget.dataset.id;
    const at = this.data.list.filter(function (x) { return x.id === id; })[0];
    if (at) this.openWith(at);
  },

  openWith(at) {
    this.setData({
      formOpen: true,
      formError: '',
      form: {
        id: at.id || '',
        name: at.name || '',
        phone: at.phone || '',
        detail: at.detail || '',
        tag: at.tag || '',
        isDefault: !!at.isDefault
      }
    });
  },

  closeForm() {
    this.setData({ formOpen: false, formError: '', saving: false });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const patch = {};
    patch['form.' + field] = e.detail.value;
    patch.formError = '';
    this.setData(patch);
  },

  onDefault(e) {
    this.setData({ 'form.isDefault': !!e.detail.value });
  },

  save() {
    if (this.data.saving) return;
    const that = this;
    const f = this.data.form;
    this.setData({ saving: true, formError: '' });
    api.saveAddress({
      id: f.id,
      name: String(f.name || '').trim(),
      phone: String(f.phone || '').trim(),
      detail: String(f.detail || '').trim(),
      tag: String(f.tag || '').trim(),
      isDefault: !!f.isDefault
    }).then(function (r) {
      if (!r || !r.ok) {
        that.setData({ saving: false, formError: (r && r.msg) || '保存失败' });
        return;
      }
      that.setData({
        saving: false,
        formOpen: false,
        list: r.addresses || []
      });
      wx.showToast({ title: '存好了', icon: 'none' });
    }).catch(function () {
      that.setData({ saving: false, formError: '保存失败，请重试' });
    });
  },

  del(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    wx.showModal({
      title: '删掉这条地址？',
      content: '删了要重新填一次。',
      confirmText: '删掉',
      confirmColor: '#A4462F',
      success(res) {
        if (!res.confirm) return;
        api.removeAddress(id).then(function (r) {
          if (!r || !r.ok) {
            wx.showToast({ title: (r && r.msg) || '删不掉', icon: 'none' });
            return;
          }
          that.setData({ list: r.addresses || [] });
        });
      }
    });
  },

  setDefault(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    api.setDefaultAddress(id).then(function (r) {
      if (!r || !r.ok) {
        wx.showToast({ title: (r && r.msg) || '设置失败', icon: 'none' });
        return;
      }
      that.setData({ list: r.addresses || [] });
    });
  },

  /* 微信自带地址簿：用户授权后能拿到姓名/电话/详细地址，不用手打 */
  fromWx() {
    const that = this;
    wx.chooseAddress({
      success(res) {
        const at = {
          id: '',
          name: res.userName || '',
          phone: res.telNumber || '',
          detail: (res.provinceName || '') + (res.cityName || '') + (res.countyName || '') + (res.detailInfo || ''),
          tag: '',
          isDefault: that.data.list.length === 0
        };
        api.saveAddress(at).then(function (r) {
          if (!r || !r.ok) {
            that.setData({ formOpen: true, form: at, formError: (r && r.msg) || '保存失败' });
            return;
          }
          that.setData({ list: r.addresses || [] });
          wx.showToast({ title: '已导入', icon: 'none' });
        });
      },
      fail() {
        wx.showToast({ title: '没拿到微信地址，那就手动填', icon: 'none' });
      }
    });
  }
});

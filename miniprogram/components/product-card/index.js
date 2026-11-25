Component({
  options: {
    addGlobalClass: true
  },
  properties: {
    item: {
      type: Object,
      value: {}
    },
    showSchool: {
      type: Boolean,
      value: true
    }
  },
  methods: {
    onTap() {
      wx.navigateTo({ url: '/pages/detail/detail?id=' + this.data.item.id });
    }
  }
});

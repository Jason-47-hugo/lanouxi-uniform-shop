const D = require('../../utils/data');
const store = require('../../utils/store');

const SCHOOL_NAMES = ['全部学校'].concat(D.SCHOOLS.map(function (s) { return s.short; }));

Page({
  data: {
    schoolNames: SCHOOL_NAMES,
    schoolIndex: 0,
    schoolLabel: '全部学校',
    stageNames: D.STAGES,
    stageIndex: 0,
    stageLabel: '全部学段',
    categories: D.CATEGORIES,
    category: '全部',
    keyword: '',
    sort: '',
    list: [],
    count: 0,
    filtered: false
  },

  onShow() {
    const app = getApp();
    const f = app.globalData.categoryFilter;
    if (f) {
      app.globalData.categoryFilter = null;
      this.applyFilter(f);
    } else {
      this.refresh();
    }
    app.updateCartBadge();
  },

  applyFilter(f) {
    f = f || {};
    const patch = {};
    if (f.school) {
      const i = D.SCHOOLS.findIndex(function (s) { return s.name === f.school; });
      if (i >= 0) {
        patch.schoolIndex = i + 1;
        patch.schoolLabel = D.SCHOOLS[i].short;
      }
    }
    if (f.stage) {
      const i = D.STAGES.indexOf(f.stage);
      if (i > 0) {
        patch.stageIndex = i;
        patch.stageLabel = f.stage;
      }
    }
    if (f.category) patch.category = f.category;
    if (f.keyword) patch.keyword = f.keyword;
    this.setData(patch, this.refresh);
  },

  refresh() {
    const d = this.data;
    const school = d.schoolIndex > 0 ? D.SCHOOLS[d.schoolIndex - 1].name : '全部';
    const stage = d.stageIndex > 0 ? D.STAGES[d.stageIndex] : '全部';
    const list = store.queryProducts({
      school: school,
      stage: stage,
      category: d.category,
      keyword: d.keyword,
      sort: d.sort
    });
    this.setData({
      list: list,
      count: list.length,
      filtered: !!(school !== '全部' || stage !== '全部' || d.category !== '全部' || d.keyword)
    });
  },

  onSchoolPick(e) {
    const i = Number(e.detail.value);
    this.setData({
      schoolIndex: i,
      schoolLabel: i === 0 ? '全部学校' : D.SCHOOLS[i - 1].short
    }, this.refresh);
  },

  onStagePick(e) {
    const i = Number(e.detail.value);
    this.setData({
      stageIndex: i,
      stageLabel: i === 0 ? '全部学段' : D.STAGES[i]
    }, this.refresh);
  },

  onCategory(e) {
    this.setData({ category: e.currentTarget.dataset.cat }, this.refresh);
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value }, this.refresh);
  },

  clearSearch() {
    this.setData({ keyword: '' }, this.refresh);
  },

  toggleSort() {
    this.setData({ sort: this.data.sort === 'price' ? '' : 'price' }, this.refresh);
  },

  reset() {
    this.setData({
      schoolIndex: 0,
      schoolLabel: '全部学校',
      stageIndex: 0,
      stageLabel: '全部学段',
      category: '全部',
      keyword: '',
      sort: ''
    }, this.refresh);
  }
});

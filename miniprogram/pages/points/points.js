const store = require('../../utils/store');
const F = require('../../utils/format');

Page({
  data: {
    available: 0,
    total: 0,
    yuanText: '0',
    member: { isMember: false, remain: 0, spent: 0 },
    logs: [],
    rules: [
      { k: '怎么来', v: '新人送 500 分；确认收货后按实付金额返分（¥1 = 1 分，小数舍去）；退货的部分不返分' },
      { k: '怎么用', v: '100 积分抵 ¥1，每单最多抵总额的 5%（¥100 最多抵 ¥5）；退货时按比例退回' },
      { k: '会员', v: '累计消费满 ¥1200 成为会员，之后每单 96 折，折扣和积分可同时用' },
      { k: '注意', v: '积分不能提现、不能转赠；退货后多返的积分会扣回' }
    ]
  },

  onShow() {
    const p = store.points();
    const m = store.member();
    const logs = store.pointsLog().map(function (l) {
      return {
        id: l.id,
        text: l.text,
        delta: l.delta,
        deltaText: (l.delta > 0 ? '+' : '') + l.delta,
        positive: l.delta > 0,
        timeText: F.dateTime(l.time)
      };
    });
    this.setData({
      available: p.available,
      total: p.total,
      yuanText: F.yuan(p.available / store.POINTS_PER_YUAN),
      member: m,
      logs: logs
    });
  }
});

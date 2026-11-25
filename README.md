# 兰欧茜校服 · 校服小店微信小程序

珠海本地一家校服店的订货小程序：**家长**看款式、按身高选码、下单付款、查订单；**店长**在手机上接单、发货、处理退货、改价改库存、导出对账单。

- 课程项目报告（PDF）：[`submission/Peisong Yuan_Lanouxi.pdf`](submission/Peisong%20Yuan_Lanouxi.pdf)
- 网页演示版（不用装任何东西）：双击 [`web/index.html`](web/index.html)
- 当前版本 **v1.3**（2026-11-25）：12 个页面、30 款商品（22 款实拍图）、21 所学校

---

## 先看这里：我想干什么 → 点哪个

| 我想…… | 打开这个 |
| --- | --- |
| 不看代码，直接点一遍小程序 | `web/index.html`（双击即可，浏览器里走完整流程） |
| 读课程报告 | `submission/Peisong Yuan_Lanouxi.pdf` |
| 在微信开发者工具里真跑 | 「导入项目」选**本文件夹这一层**（`project.config.json` 已指向 `miniprogram/`） |
| 看小程序源码 | `miniprogram/`（12 个页面在 `pages/`） |
| 看服务端逻辑 | `cloudfunctions/api/`（定价、权限、订单状态机都在这） |
| 看文档与截图 | `docs/` |
| 看我是怎么在没有开发者工具的情况下“看见”界面的 | `preview/`（自建的 WXML→HTML 渲染器与自测脚本） |

> `preview/` 和 `tools/` 是开发时用的工具，不影响小程序运行，读代码可以从 `miniprogram/` 开始。

---

## 目录

```
.
├─ README.md                  ← 本文件
├─ project.config.json        微信开发者工具的项目配置（已指向 miniprogram/）
├─ miniprogram/               小程序本体
│  ├─ app.js / app.json / app.wxss
│  ├─ pages/                  12 个页面
│  │   home 首页、category 全部校服、detail 商品详情、cart 购物车、checkout 结算、
│  │   pay 支付、orders 我的订单、order 订单详情、mine 我的、points 积分、
│  │   admin 店长台、address 收货地址簿
│  ├─ components/product-card/
│  ├─ utils/
│  │   ├─ data.js             商品 30 款 / 学校 21 所 / 尺码表 / 店铺信息
│  │   ├─ size.js             身高 → 尺码（纯函数）
│  │   ├─ store.js            本地数据层（无云时用）
│  │   ├─ api.js              统一入口：云优先，连不上退回本地
│  │   ├─ cloud.js            wx.cloud 薄封装 + ENV_ID
│  │   └─ xlsx.js             自己写的 xlsx 生成器（对账单用，不引依赖）
│  └─ images/                 商品图、主视觉、tab 图标
├─ cloudfunctions/
│  ├─ api/                    唯一的云函数（按 action 分派）
│  │   ├─ index.js            入口
│  │   ├─ common/rules.js     定价、状态机、角色（纯函数，可单测）
│  │   ├─ common/service.js   业务实现（下单扣库存、退货退款、看板……）
│  │   ├─ common/wxdb.js      数据库适配层（get/find/add/update/remove/cas/incField）
│  │   └─ data/products.json  随云函数部署的商品目录
│  └─ seed/                   云数据库可导入的种子数据
├─ web/                       网页演示版（build 产物，可直接双击）
│  ├─ index.html
│  ├─ app.html
│  └─ images/
├─ preview/                   自建预览与自测工具
│  ├─ build.js                WXML → HTML（mock wx / Page / 组件 / rpx）
│  ├─ web-build.js            生成 web/
│  ├─ web-runtime.js          网页版里真正跑 WXML/WXSS/JS 的渲染器
│  └─ flow-test.js            数据层全流程自测（108 项）
├─ tools/                     生成脚本（报告、品牌图、商品图整理、云函数自测）
├─ submission/                提交物：报告 PDF + 提交说明
└─ docs/                      文档、决策记录、截图
```

---

## 网页演示版怎么用

双击 `web/index.html`，浏览器里就能点：首页 → 按学校/分类 → 商品详情（填身高出码）→ 加购/立即购买 → 结算（选地址簿）→ 支付 → 我的订单。

- 数据存在浏览器 localStorage，刷新不丢；想重置就清站点数据或执行 `localStorage.clear()`。
- **店长端**：「我的 → 店长入口」，网页版口令 `2468`（小程序端已改成服务端按 `admins` 里的 openid 判定，没有口令）。
- 网页版是把 `miniprogram/` 里真实的 WXML/WXSS/JS 渲染出来的，不是另写一套界面，所以看到的就是小程序的样子。

---

## 小程序怎么跑

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 「导入项目」→ 选**本文件夹这一层**（不是 `miniprogram/`），AppID 填 `wx37e1073cc15df404`，或选「测试号」。
3. 编译后从首页开始点。

云开发环境 ID：`cloud1-d7gvr1q2x22eb4eb0`（`miniprogram/utils/cloud.js` 里 `ENV_ID`）。空着也能跑：会自动退回本地 storage，功能一样全，只是数据不跨设备。

### 一遍完整流程

| 步骤 | 操作 | 看到什么 |
| --- | --- | --- |
| 1 | 任意商品「立即购买」→ 选地址（或点「地址簿」挑一条）→ 提交订单 | 生成订单，状态「待付款」 |
| 2 | 支付页「微信支付 ¥xx」 | 状态变「待发货」，积分抵扣已扣、流水有记录 |
| 3 | 我的 → 店长入口 | 店长台，待办里出现这单 |
| 4 | 「发货」→ 选快递、填单号 | 买家端变「待收货」 |
| 5 | 我的订单 → 订单详情 → 确认收货 | 状态「已完成」，返积分并累计会员消费 |

店长台还能：搜索订单、批量发货、补单号、导出 `.xlsx` 对账单、看「数据」看板（近 7/30 天营收、14 天柱状、热销款、退货率）、看低库存提醒。

---

## 尺码：按身高直接对上号

详情页点「尺码参考」→ 填孩子身高 → 「找尺码」→ 给出码位和一句说明，「就用它」直接选中。

- 规则在 `miniprogram/utils/size.js`（纯函数）：把商品尺码表换算成身高刻度（字母码 S/M/L 是给旧款的，内部映射到身高），取最接近的一档；卡在两档正中间时取大一档；结果永远落在这件商品真实的尺码表里。
- 校服店的衣服本身就是按身高卖的：150 / 155 / … / 200（小学款 110–160）。

---

## 积分、运费与退换

- 新客 500 分；100 分抵 ¥1。
- 每单最多抵「商品金额 − 会员折扣」的 5%，且不超过可用积分；取消订单退回已抵积分。
- 确认收货后按实付商品金额（不含运费）返积分，¥1 = 1 分，小数舍去。
- 累计消费满 ¥1200 成为会员，之后每单 96 折，折扣与积分抵现可叠加。
- 运费：快递 ¥8，满 ¥50 包邮；到店自提 0 元。
- 退换：7 天无理由；退款按实付比例算，抵扣的积分按比例退回，已返的购物积分按留下的金额重算。
- 超时未付款 30 分钟自动关单（退积分、还库存）。

---

## 自测

```bash
node preview/flow-test.js       # 数据层全流程 + 前后端规则一致性 → 期望 ALL PASS 108
node tools/cloud-test.js        # 云函数本地自测（内存库，不需要云环境）→ 期望 ALL PASS 132
node preview/web-build.js       # 重建网页演示版
node preview/build.js           # 生成 preview/html/*.html，逐页看界面
```

报告由 `python tools/build_report.py` 从 `docs/项目报告素材.md` 生成（`python-docx`，需先 `pip install python-docx`），再用任意 docx→pdf 转出。

---

## 已知限制（写在前面，不藏在后面）

- **没有接微信支付商户号**：演示版点「微信支付」只模拟成功，不真扣钱；正式版要换成 `wx.requestPayment` + 云函数回调验签。
- **没有 ICP 备案、没有真机验证**：小程序已通过微信认证、云开发可用，但备案还在审核，真机手势/字体/支付 SDK 没跑过。
- **商品价格待店主核对**：22 款实拍图已入库，只有「二中麒麟校区断码长裤」图上写着 38 元是实价，其余是建议价；库存先填 10。
- 网页演示版的店长口令 `2468` 只是演示门槛；小程序端按 `admins` 集合判定身份。
- 尺码是按尺码表的规则估算，不测体型；偏胖偏瘦、肩宽特殊的孩子仍建议到店试穿。

---

## 文档索引

| 文件 | 内容 |
| --- | --- |
| `docs/项目报告素材.md` | 报告的事实底稿（每条都能在代码里对上） |
| `docs/决策记录.md` | D001–D016，每个决策的选项、取舍与代价 |
| `docs/云开发接入指南.md` | 开通云环境、建集合、部署云函数、验收动作 |
| `docs/上线操作指南.md` | 备案、隐私保护指引、支付商户号怎么填 |
| `docs/作业提交清单.md` | 交作业必需的 6 件 + 上线必需的 9 件 |
| `docs/交接卡-20261117.md` | 版本演进、状态机行号、已知坑（给下一个人看） |
| `docs/进度与待办.md` | 怎么确认各项申请成功、还剩什么 |

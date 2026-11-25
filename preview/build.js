/* 把小程序页面渲染成 HTML，用于本地截图与设计评审。
   不是运行时，只求「像素接近」：支持 wx:for / wx:if / {{}} / 自定义组件 / rpx。 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const OUT = path.join(__dirname, 'html');

/* ------------------------------------------------------------------ *
 * 1. 极简 wx / App / Page 运行时
 * ------------------------------------------------------------------ */

const storage = new Map();
const warnings = new Set();
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

global.wx = {
  getStorageSync() { return ''; },
  setStorageSync() {},
  removeStorageSync() {},
  getStorageInfoSync() { return { keys: [] }; },
  getWindowInfo() {
    return { statusBarHeight: 20, windowWidth: 375, windowHeight: 812, screenWidth: 375, screenHeight: 812 };
  },
  getSystemInfoSync() { return global.wx.getWindowInfo(); },
  getMenuButtonBoundingClientRect() { return { top: 26, height: 32, width: 87 }; },
  showToast() {}, hideToast() {}, showLoading() {}, hideLoading() {},
  showModal(o) { if (o && o.success) o.success({ confirm: true, cancel: false }); },
  navigateTo() {}, redirectTo() {}, switchTab() {}, navigateBack() {},
  setClipboardData(o) { if (o && o.success) o.success(); },
  previewImage() {}, saveImageToPhotosAlbum(o) { if (o && o.success) o.success(); },
  makePhoneCall() {}, setTabBarBadge() {}, removeTabBarBadge() {},
  createSelectorQuery() {
    return { select() { return this; }, boundingClientRect() { return this; }, exec() {} };
  }
};
global.wx.getStorageSync = (k) => (storage.has(k) ? clone(storage.get(k)) : '');
global.wx.setStorageSync = (k, v) => storage.set(k, clone(v));
global.wx.removeStorageSync = (k) => storage.delete(k);
global.wx.getStorageInfoSync = () => ({ keys: Array.from(storage.keys()) });
['setNavigationBarTitle', 'setNavigationBarColor', 'pageScrollTo', 'stopPullDownRefresh',
  'showActionSheet', 'chooseAddress', 'requestSubscribeMessage', 'onWindowResize',
  'offWindowResize', 'nextTick', 'showShareMenu', 'hideShareMenu'].forEach((k) => {
  global.wx[k] = () => {};
});
/* 未知 API 一律 no-op，避免个别页面调用直接炸掉构建 */
global.wx = new Proxy(global.wx, {
  get(target, key) {
    if (key in target) return target[key];
    return function noop() {};
  }
});

const app = {
  globalData: { statusBarHeight: 20, adminUnlocked: true, checkoutDraft: null, storePhone: '' },
  updateCartBadge() {}
};
global.getApp = () => app;
global.App = (cfg) => {
  Object.assign(app, cfg);
  if (cfg.onLaunch) cfg.onLaunch.call(app);
};

let captured = null;
global.Page = (cfg) => { captured = cfg; };
global.Component = (cfg) => { captured = cfg; };

/* ------------------------------------------------------------------ *
 * 2. 载入真实业务代码
 * ------------------------------------------------------------------ */

require(path.join(MP, 'app.js'));
app.globalData.adminUnlocked = true;
const store = require(path.join(MP, 'utils/store.js'));

function seed() {
  storage.clear();
  store.ensureInit();

  store.addToCart({ productId: 'p1', color: '藏青', size: 'L', qty: 1 });
  store.addToCart({ productId: 'p7', color: '藏青', size: 'M', qty: 1 });
  store.addToCart({ productId: 'p3', color: '浅蓝', size: 'M', qty: 1 });

  const addr = { name: '林晓', phone: '13800138000', detail: '珠海市香洲区情侣中路 88 号 3 栋 502' };
  /* 地址簿：预览里也放两条，否则地址页截图是空的 */
  store.saveAddress({ name: '林晓', phone: '13800138000', detail: addr.detail, tag: '家', isDefault: true });
  store.saveAddress({ name: '陈海', phone: '13900139000', detail: '珠海市第一中学 高一二班 陈海 收', tag: '学校' });
  const o1 = store.createOrder({
    items: [{ productId: 'p1', color: '藏青', size: 'L', qty: 1 }],
    delivery: 'express', address: addr, usePoints: false, deposit: true,
    remark: '开学前要用，麻烦快一点'
  }).order;

  const o2 = store.createOrder({
    items: [
      { productId: 'p3', color: '浅蓝', size: 'M', qty: 1 },
      { productId: 'p6', color: '砖红', size: '均码', qty: 1 }
    ],
    delivery: 'express', address: addr, usePoints: false
  }).order;
  store.payOrder(o2.id);
  store.ship(o2.id, '顺丰速运', 'SF1402938712');

  const o3 = store.createOrder({
    items: [{ productId: 'p4', color: '米白', size: 'S', qty: 1 }],
    delivery: 'pickup', usePoints: false
  }).order;
  store.payOrder(o3.id);
  store.ship(o3.id, '到店自提', '');
  store.confirmReceipt(o3.id);

  store.seedDemoOrders();
  return { o1, o2, o3 };
}

/* ------------------------------------------------------------------ *
 * 3. WXML 解析
 * ------------------------------------------------------------------ */

const VOID = { image: 1, input: 1, switch: 1, icon: 1, 'cover-image': 1 };

function tagEnd(src, start) {
  let q = null;
  for (let i = start + 1; i < src.length; i += 1) {
    const c = src[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '>') return i;
  }
  return src.length;
}

function parseAttrs(s) {
  const attrs = {};
  const re = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
  let m;
  while ((m = re.exec(s))) {
    attrs[m[1]] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : '');
  }
  return attrs;
}

function parse(src) {
  const root = { tag: 'root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  const addText = (t) => {
    if (/\S/.test(t)) stack[stack.length - 1].children.push({ type: 'text', text: t.replace(/\s+/g, ' ') });
  };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { addText(src.slice(i)); break; }
    if (lt > i) addText(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    const end = tagEnd(src, lt);
    const raw = src.slice(lt + 1, end).trim();
    i = end + 1;
    if (raw[0] === '/') { if (stack.length > 1) stack.pop(); continue; }
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;
    const m = /^([a-zA-Z][\w-]*)/.exec(body);
    if (!m) continue;
    const tag = m[1];
    const node = { tag, attrs: parseAttrs(body.slice(m[0].length)), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose && !VOID[tag]) stack.push(node);
  }
  return root;
}

/* ------------------------------------------------------------------ *
 * 4. 表达式
 * ------------------------------------------------------------------ */

function evalExpr(expr, scope) {
  try {
    /* eslint-disable no-new-func */
    const fn = new Function('__s', 'with (__s) { return (' + expr + '); }');
    return fn(scope);
  } catch (e) {
    warnings.add('expr: ' + expr.trim() + '  ->  ' + e.message);
    return '';
  }
}

const truthy = (v) => !(v === false || v === 0 || v === '' || v === null || v === undefined);

/* wx:if / wx:for 的值是 "{{expr}}"，剥掉外层大括号再求值 */
function exprOf(raw) {
  if (typeof raw !== 'string') return String(raw);
  const m = /^\s*\{\{([\s\S]*)\}\}\s*$/.exec(raw);
  return m ? m[1] : raw;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

function interp(str, scope) {
  if (typeof str !== 'string' || str.indexOf('{{') < 0) return str;
  return str.replace(/\{\{([\s\S]*?)\}\}/g, (_, expr) => {
    const v = evalExpr(expr, scope);
    return v === undefined || v === null || v === false ? '' : String(v);
  });
}

/* ------------------------------------------------------------------ *
 * 5. 渲染
 * ------------------------------------------------------------------ */

const MAP = {
  view: 'div', text: 'span', image: 'img', block: null, 'scroll-view': 'div',
  swiper: 'div', 'swiper-item': 'div', navigator: 'div', picker: 'div',
  input: 'input', textarea: 'textarea', switch: 'switch-mock', button: 'button'
};

function attrsOf(node, scope) {
  const out = {};
  Object.keys(node.attrs).forEach((k) => {
    if (k.indexOf('bind') === 0 || k.indexOf('catch') === 0 || k.indexOf('wx:') === 0) return;
    out[k] = interp(node.attrs[k], scope);
  });
  return out;
}

function renderChildren(nodes, scope, ctx, out) {
  let chainActive = false;
  let chainMatched = false;
  for (const node of nodes) {
    if (node.type === 'text') {
      const t = interp(node.text, scope);
      if (/\S/.test(t)) out.push(esc(t));
      continue;
    }
    if (node.tag === 'root') { renderChildren(node.children, scope, ctx, out); continue; }

    const hasIf = node.attrs['wx:if'] !== undefined;
    const hasElif = node.attrs['wx:elif'] !== undefined;
    const hasElse = node.attrs['wx:else'] !== undefined;

    if (hasIf) {
      chainActive = true;
      chainMatched = truthy(evalExpr(exprOf(node.attrs['wx:if']), scope));
      if (!chainMatched) continue;
    } else if (hasElif) {
      if (!chainActive || chainMatched) continue;
      chainMatched = truthy(evalExpr(exprOf(node.attrs['wx:elif']), scope));
      if (!chainMatched) continue;
    } else if (hasElse) {
      if (!chainActive || chainMatched) continue;
      chainActive = false;
    } else {
      chainActive = false;
    }

    renderNode(node, scope, ctx, out);
  }
}

function renderNode(node, scope, ctx, out) {
  if (node.attrs['wx:for'] !== undefined) {
    const list = evalExpr(exprOf(node.attrs['wx:for']), scope);
    const arr = Array.isArray(list) ? list : [];
    const itemName = node.attrs['wx:for-item'] || 'item';
    const idxName = node.attrs['wx:for-index'] || 'index';
    const attrs = Object.assign({}, node.attrs);
    ['wx:for', 'wx:for-item', 'wx:for-index', 'wx:key'].forEach((k) => delete attrs[k]);
    arr.forEach((it, idx) => {
      const s = Object.create(scope);
      s[itemName] = it;
      s[idxName] = idx;
      renderNode(Object.assign({}, node, { attrs }), s, ctx, out);
    });
    return;
  }

  if (node.tag === 'block') {
    renderChildren(node.children, scope, ctx, out);
    return;
  }

  if (node.tag === 'product-card') {
    const comp = ctx.components['product-card'];
    const s = Object.assign({}, comp.data);
    s.item = evalExpr(exprOf(node.attrs.item || 'item'), scope) || {};
    const show = node.attrs.showSchool;
    s.showSchool = show === undefined ? true : truthy(evalExpr(exprOf(show), scope));
    renderChildren(comp.ast.children, s, ctx, out);
    return;
  }

  const a = attrsOf(node, scope);
  const cls = a.class ? ' class="' + esc(a.class) + '"' : '';
  const style = a.style ? ' style="' + esc(a.style) + '"' : '';

  if (node.tag === 'image') {
    const src = String(a.src || '');
    const url = src.indexOf('/') === 0 ? 'miniprogram' + src : src;
    const fit = a.mode === 'aspectFill' ? 'object-fit:cover;' : (a.mode === 'aspectFit' ? 'object-fit:contain;' : '');
    out.push('<img' + cls + ' src="' + esc(url) + '" style="' + fit + (a.style ? esc(a.style) + ';' : '') + '">');
    return;
  }

  if (node.tag === 'input') {
    const type = a.type || 'text';
    out.push('<input' + cls + ' type="' + (type === 'number' || type === 'digit' ? 'number' : 'text') +
      '" value="' + esc(a.value || '') + '" placeholder="' + esc(a.placeholder || '') +
      '" style="' + (a.style ? esc(a.style) + ';' : '') + '" readonly>');
    return;
  }

  if (node.tag === 'switch') {
    const on = truthy(evalExpr(exprOf(node.attrs.checked || ''), scope));
    out.push('<span class="__switch' + (on ? ' __on' : '') + '"><i></i></span>');
    return;
  }

  const tag = MAP[node.tag] || 'div';
  let extra = '';
  if (node.tag === 'scroll-view') {
    extra = a['scroll-x'] !== undefined || node.attrs['scroll-x'] !== undefined
      ? 'overflow-x:auto;overflow-y:hidden;'
      : 'overflow-y:auto;';
  }
  out.push('<' + tag + cls + ' style="' + extra + (a.style ? esc(a.style) + ';' : '') + '">');
  renderChildren(node.children, scope, ctx, out);
  out.push('</' + tag + '>');
}

/* ------------------------------------------------------------------ *
 * 6. WXSS
 * ------------------------------------------------------------------ */

function wxss(file) {
  if (!fs.existsSync(file)) return '';
  let css = fs.readFileSync(file, 'utf8');
  css = css.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => (parseFloat(n) / 2).toFixed(2) + 'px');
  css = css.replace(/(^|\})\s*page\s*\{/g, '$1 body {');
  css = css.replace(/env\(safe-area-inset-[a-z]+\)/g, '0px');
  css = css.replace(/constant\(safe-area-inset-[a-z]+\)/g, '0px');
  css = css.replace(/url\((['"]?)\/images\//g, 'url($1miniprogram/images/');
  return css;
}

/* ------------------------------------------------------------------ *
 * 7. 装载页面
 * ------------------------------------------------------------------ */

function loadModule(file) {
  captured = null;
  delete require.cache[require.resolve(file)];
  require(file);
  if (!captured) throw new Error('没有捕获到 Page/Component: ' + file);
  return captured;
}

function instantiate(cfg, query) {
  const inst = Object.create(cfg);
  inst.data = clone(cfg.data || {});
  inst.setData = function setData(patch, cb) {
    Object.keys(patch).forEach((k) => {
      const parts = k.split('.');
      let o = inst.data;
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {};
        o = o[parts[i]];
      }
      o[parts[parts.length - 1]] = patch[k];
    });
    if (typeof cb === 'function') cb.call(inst);
  };
  if (cfg.onLoad) cfg.onLoad.call(inst, query || {});
  if (cfg.onShow) cfg.onShow.call(inst);
  if (cfg.onReady) cfg.onReady.call(inst);
  return inst;
}

/* ------------------------------------------------------------------ *
 * 8. 页面外壳
 * ------------------------------------------------------------------ */

const STATUS_H = 20;
const NAV_H = 44;
const TAB_H = 50;
const TOTAL_H = 812;

function shell(opts) {
  const hasNav = !opts.customNav;
  const hasTab = !!opts.tab;
  const top = hasNav ? STATUS_H + NAV_H : 0;
  const bottom = hasTab ? TAB_H : 0;

  const nav = hasNav ? `
  <div class="__status"><span>9:41</span><span class="__sig">●●●</span></div>
  <div class="__navbar">
    ${opts.back ? '<span class="__back">‹</span>' : ''}
    <span class="__title">${esc(opts.title)}</span>
  </div>` : '';

  const tabs = [['home', '首页', 'tab-home'], ['category', '分类', 'tab-category'], ['cart', '购物车', 'tab-cart'], ['mine', '我的', 'tab-user']];
  const tabbar = hasTab ? `
  <div class="__tabbar">
    ${tabs.map(([k, label, icon]) => `
      <div class="__tab${k === opts.tab ? ' __on' : ''}">
        <img src="miniprogram/images/${icon}${k === opts.tab ? '-on' : ''}.png">
        <span>${label}</span>
      </div>`).join('')}
  </div>` : '';

  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<base href="${pathToFileURL(ROOT + path.sep).href}">
<title>${esc(opts.title)}</title>
<style>
html, body { margin: 0; padding: 0; }
body {
  width: 375px; height: ${TOTAL_H}px; overflow: hidden;
  background: #F7F3EC;
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.__status { height: ${STATUS_H}px; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; box-sizing: border-box; font-size: 11px; font-weight: 600; color: #26364A; background: #F7F3EC; }
.__sig { letter-spacing: 1px; font-size: 9px; }
.__navbar { height: ${NAV_H}px; display: flex; align-items: center; justify-content: center; position: relative; background: #F7F3EC; }
.__title { font-size: 16px; font-weight: 600; color: #26364A; letter-spacing: 1px; }
.__back { position: absolute; left: 14px; top: 6px; font-size: 26px; color: #4A4A4A; line-height: 1; }
.__screen { height: ${TOTAL_H - top - bottom}px; overflow: hidden; transform: translateZ(0); background: #F7F3EC; }
.__tabbar { position: fixed; left: 0; right: 0; bottom: 0; height: ${TAB_H}px; display: flex; background: #FBF8F2; border-top: 1px solid #EFE6D8; }
.__tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font-size: 9px; color: #9C9488; }
.__tab img { width: 22px; height: 22px; }
.__tab.__on { color: #2E4A3F; }
.__switch { display: inline-block; width: 44px; height: 26px; border-radius: 13px; background: #DCD5C8; position: relative; vertical-align: middle; }
.__switch.__on { background: #2E4A3F; }
.__switch i { position: absolute; top: 2px; left: 2px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
.__switch.__on i { left: 20px; }
.page { min-height: 100% !important; }
input { border: none; outline: none; background: transparent; font-family: inherit; }
</style>
<style>
${opts.css}
</style>
</head>
<body>
${nav}
<div class="__screen">
${opts.html}
</div>
${tabbar}
</body></html>`;
}

/* ------------------------------------------------------------------ *
 * 9. 主流程
 * ------------------------------------------------------------------ */

function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const seeds = seed();

  const compCfg = loadModule(path.join(MP, 'components/product-card/index.js'));
  const compAst = parse(fs.readFileSync(path.join(MP, 'components/product-card/index.wxml'), 'utf8'));
  const compData = Object.assign({}, compCfg.data || {});
  Object.keys(compCfg.properties || {}).forEach((k) => {
    const p = compCfg.properties[k];
    compData[k] = p && p.value !== undefined ? p.value : '';
  });
  const compCss = wxss(path.join(MP, 'components/product-card/index.wxss'));
  const appCss = wxss(path.join(MP, 'app.wxss'));
  const components = { 'product-card': { ast: compAst, data: compData } };

  /* 结算草稿 */
  const cart = store.getCart();
  app.globalData.checkoutDraft = {
    items: cart.map((it) => ({ productId: it.productId, color: it.color, size: it.size, qty: it.qty }))
  };

  const PAGES = [
    { name: 'home', title: '嘉贝校服', tab: 'home', customNav: true },
    { name: 'category', title: '全部校服', tab: 'category' },
    { name: 'detail', title: '商品详情', query: { id: 'p1' }, back: true },
    {
      name: 'detail',
      file: 'detail-size',
      title: '尺码推荐',
      query: { id: 'p1' },
      back: true,
      setup: function (inst) {
        inst.setData({ sizeOpen: true, fitH: '170' });
        inst.doFit();
      }
    },
    { name: 'cart', title: '购物车', tab: 'cart' },
    { name: 'checkout', title: '确认订单', back: true },
    { name: 'pay', title: '收银台', query: { id: seeds.o1.id }, back: true },
    { name: 'orders', title: '我的订单', query: { tab: 'all' }, back: true },
    { name: 'order', title: '订单详情', query: { id: seeds.o2.id }, back: true },
    { name: 'mine', title: '会员中心', tab: 'mine' },
    { name: 'points', title: '我的积分', back: true },
    { name: 'address', title: '收货地址', back: true },
    { name: 'admin', title: '店长工作台', back: true }
  ];

  const report = [];
  PAGES.forEach((p) => {
    const cfg = loadModule(path.join(MP, 'pages', p.name, p.name + '.js'));
    const inst = instantiate(cfg, p.query || {});
    if (p.setup) p.setup(inst);
    const ast = parse(fs.readFileSync(path.join(MP, 'pages', p.name, p.name + '.wxml'), 'utf8'));
    const out = [];
    renderChildren(ast.children, inst.data, { components }, out);
    const css = [appCss, compCss, wxss(path.join(MP, 'pages', p.name, p.name + '.wxss'))].join('\n');
    const file = p.file || p.name;
    const html = shell({
      title: p.title, tab: p.tab, customNav: p.customNav, back: p.back,
      html: out.join(''), css
    });
    fs.writeFileSync(path.join(OUT, file + '.html'), html, 'utf8');
    /* 用 iframe 隔离出真正的 375×812 视口：无头浏览器窗口有最小宽度，直接开 375 会把 fixed 元素撑歪 */
    fs.writeFileSync(path.join(OUT, 'wrap-' + file + '.html'), `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; background: #ffffff; }
iframe { display: block; width: 375px; height: 812px; border: 0; }
</style></head><body>
<iframe src="${file}.html" scrolling="no"></iframe>
</body></html>`, 'utf8');
    const chars = out.join('').length;
    report.push(file + ': ' + chars + ' chars');
  });

  fs.writeFileSync(path.join(__dirname, 'warnings.txt'), Array.from(warnings).join('\n'), 'utf8');
  console.log(report.join('\n'));
  if (warnings.size) console.log('\nWARN ' + warnings.size + ' 条，见 preview/warnings.txt');
}

main();

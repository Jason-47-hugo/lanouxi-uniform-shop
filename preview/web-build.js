/* 生成可点击的网页演示版：uniform-shop/web/
   - 直接复用 miniprogram 里的 WXML/WXSS/JS，在浏览器里实现一个极简小程序运行时。
   - 产物是纯静态文件，双击 index.html 即可用（file:// 也能跑）。 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const OUT = path.join(ROOT, 'web');

/* ---------------- WXML 解析（与 build.js 同款） ---------------- */
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
    const node = { tag: m[1], attrs: parseAttrs(body.slice(m[0].length)), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose && !VOID[node.tag]) stack.push(node);
  }
  return root;
}

/* ---------------- WXSS ---------------- */
function wxss(file) {
  if (!fs.existsSync(file)) return '';
  let css = fs.readFileSync(file, 'utf8');
  css = css.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => (parseFloat(n) / 2).toFixed(2) + 'px');
  css = css.replace(/(^|\})\s*page\s*\{/g, '$1 body {');
  css = css.replace(/env\(safe-area-inset-[a-z]+\)/g, '0px');
  css = css.replace(/constant\(safe-area-inset-[a-z]+\)/g, '0px');
  css = css.replace(/url\((['"]?)\/images\//g, 'url($1images/');
  return css;
}

/* ---------------- 模块打包 ---------------- */
function moduleId(file) {
  return path.relative(MP, file).replace(/\\/g, '/').replace(/\.js$/, '');
}

function wrapModule(file) {
  const id = moduleId(file);
  let src = fs.readFileSync(file, 'utf8');
  src = src.replace(/require\(\s*(['"])([^'"]+)\1\s*\)/g, (_, q, p) => {
    const abs = path.resolve(path.dirname(file), p.endsWith('.js') ? p : p + '.js');
    return `__req(${JSON.stringify(moduleId(abs))})`;
  });
  src = src.replace(/<\/script/gi, '<\\/script');
  return `__def(${JSON.stringify(id)}, function (module, exports, __req) {\n${src}\n});`;
}

/* ---------------- 收集页面 ---------------- */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const appJson = readJson(path.join(MP, 'app.json'));
  const pageNames = appJson.pages.map((p) => p.split('/').pop());
  const tabList = (appJson.tabBar && appJson.tabBar.list) || [];
  const tabOf = {};
  const TABS = tabList.map((t) => {
    const name = t.pagePath.split('/').pop();
    tabOf[name] = name;
    return {
      name,
      label: t.text,
      icon: path.basename(t.iconPath, '.png')
    };
  });

  const moduleFiles = [
    path.join(MP, 'app.js'),
    path.join(MP, 'utils', 'data.js'),
    path.join(MP, 'utils', 'format.js'),
    path.join(MP, 'utils', 'size.js'),
    path.join(MP, 'utils', 'xlsx.js'),
    path.join(MP, 'utils', 'cloud.js'),
    path.join(MP, 'utils', 'api.js'),
    path.join(MP, 'utils', 'store.js'),
    path.join(MP, 'components', 'product-card', 'index.js')
  ].concat(pageNames.map((n) => path.join(MP, 'pages', n, n + '.js')));

  const modules = moduleFiles.map(wrapModule).join('\n');

  const PAGES = {};
  pageNames.forEach((name) => {
    const base = path.join(MP, 'pages', name, name);
    const cfg = fs.existsSync(base + '.json') ? readJson(base + '.json') : {};
    PAGES[name] = {
      title: cfg.navigationBarTitleText || name,
      tab: tabOf[name] || '',
      customNav: cfg.navigationStyle === 'custom',
      ast: parse(fs.readFileSync(base + '.wxml', 'utf8')),
      css: wxss(base + '.wxss')
    };
  });

  const compBase = path.join(MP, 'components', 'product-card', 'index');
  const compAst = parse(fs.readFileSync(compBase + '.wxml', 'utf8'));
  const compCss = wxss(compBase + '.wxss');
  const appCss = wxss(path.join(MP, 'app.wxss'));

  /* 复制图片 */
  const imgSrc = path.join(MP, 'images');
  const imgDst = path.join(OUT, 'images');
  fs.mkdirSync(imgDst, { recursive: true });
  fs.readdirSync(imgSrc).forEach((f) => {
    fs.copyFileSync(path.join(imgSrc, f), path.join(imgDst, f));
  });

  const runtime = fs.readFileSync(path.join(__dirname, 'web-runtime.js'), 'utf8');

  const chromeCss = `
html, body { margin: 0; padding: 0; }
body {
  background: #F7F3EC; color: #26364A;
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.status { position: absolute; top: 0; left: 0; right: 0; height: 20px; display: flex; align-items: center;
  justify-content: space-between; padding: 0 18px; box-sizing: border-box; font-size: 11px; font-weight: 600;
  color: #26364A; background: #F7F3EC; z-index: 60; }
.sig { letter-spacing: 1px; font-size: 9px; }
.navbar { position: absolute; top: 20px; left: 0; right: 0; height: 44px; display: flex; align-items: center;
  justify-content: center; background: #F7F3EC; z-index: 60; }
.nav-title { font-size: 16px; font-weight: 600; color: #26364A; letter-spacing: 1px; }
.back { position: absolute; left: 10px; top: 0; width: 34px; height: 44px; display: flex; align-items: center;
  justify-content: center; font-size: 28px; color: #4A4A4A; cursor: pointer; user-select: none; }
body.custom .status, body.custom .navbar { display: none; }
#root { padding-top: 64px; padding-bottom: 6px; }
body.custom #root { padding-top: 0; }
body.tab-none #root { padding-bottom: 6px; }
body.tab-home #root, body.tab-category #root, body.tab-cart #root, body.tab-mine #root { padding-bottom: 56px; }
body.hastab .bar, body.hastab .cart-bar, body.hastab .foot-bar, body.hastab .bottom-bar { bottom: 50px; }
/* 页面里的 position:fixed 底栏/浮层在浏览器里会相对整个窗口定位，
   这里把它们收进 375px 的手机列里（小程序里它们本来就只占一屏宽）。 */
.bar, .cart-bar, .foot-bar, .bottom-bar {
  left: 50% !important; right: auto !important; width: 375px; margin-left: -187.5px; box-sizing: border-box;
}
.mask, .picker-mask, .lightbox, .sheet {
  left: 50% !important; right: auto !important; width: 375px; margin-left: -187.5px; box-sizing: border-box;
}
#screen { position: relative; width: 375px; height: 100vh; max-height: 812px; margin: 0 auto;
  overflow: hidden; background: #F7F3EC; }
#phone { position: absolute; left: 0; right: 0; top: 0; bottom: 0; overflow-y: auto; overflow-x: hidden;
  -webkit-overflow-scrolling: touch; }
.tabbar { position: absolute; left: 0; right: auto; bottom: 0; width: 375px; height: 50px; display: flex; background: #FBF8F2;
  border-top: 1px solid #EFE6D8; z-index: 70; }
.tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  font-size: 10px; color: #6F675B; position: relative; cursor: pointer; }
.tab img { width: 22px; height: 22px; }
.tab.on { color: #2E4A3F; }
.badge { position: absolute; top: 7px; left: 50%; margin-left: 3px; min-width: 15px; height: 15px;
  border-radius: 8px; background: #B65C3C; color: #fff; font-size: 9px; font-style: normal;
  display: none; align-items: center; justify-content: center; padding: 0 4px; }
.toast { position: fixed; left: 50%; top: 46%; transform: translateX(-50%); background: rgba(30,28,25,.86);
  color: #fff; font-size: 13px; padding: 10px 18px; border-radius: 8px; opacity: 0; pointer-events: none;
  transition: opacity .18s; z-index: 200; max-width: 280px; text-align: center; }
.toast.on { opacity: 1; }
.picker-mask, .lightbox { position: fixed; inset: 0; background: rgba(20,18,16,.45); z-index: 300;
  display: flex; align-items: flex-end; }
.picker-sheet { background: #FBF8F2; width: 100%; border-radius: 16px 16px 0 0; max-height: 70%; overflow: auto;
  padding: 8px 0 10px; }
.picker-title { text-align: center; font-size: 12px; color: #9C9488; padding: 8px 0; }
.picker-item { padding: 13px 20px; font-size: 15px; border-top: 1px solid #F0E8DA; }
.picker-item.on { color: #2E4A3F; font-weight: 600; }
.picker-cancel { padding: 14px 20px; text-align: center; color: #8A8378; font-size: 14px; border-top: 1px solid #F0E8DA; }
.lightbox { align-items: center; justify-content: center; flex-direction: column; }
.lightbox img { max-width: 92%; max-height: 80%; border-radius: 8px; }
.lightbox p { color: #fff; font-size: 12px; opacity: .8; }
.__switch { display: inline-block; width: 44px; height: 26px; border-radius: 13px; background: #DCD5C8;
  position: relative; vertical-align: middle; }
.__switch.__on { background: #2E4A3F; }
.__switch i { position: absolute; top: 2px; left: 2px; width: 22px; height: 22px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.2); transition: left .15s; }
.__switch.__on i { left: 20px; }
.page { min-height: 100% !important; }
input { border: none; outline: none; background: transparent; font-family: inherit; }
img { border: 0; }
a { color: inherit; text-decoration: none; }
`;

  const appHtml = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=375, initial-scale=1">
<title>兰欧茜校服 · 演示</title>
<style id="base-css">
${chromeCss}
</style>
<style id="app-css">
${appCss}
</style>
<style id="comp-css">
${compCss}
</style>
<style id="pagecss"></style>
</head>
<body>
<div id="screen">
  <div class="status"><span>9:41</span><span class="sig">●●● ▮</span></div>
  <div class="navbar"><div class="back" id="back">‹</div><div class="nav-title" id="nav-title"></div></div>
  <div id="phone"><div id="root"></div></div>
  <div id="tabbar" class="tabbar"></div>
</div>
<div id="toast" class="toast"></div>
<script>
window.onerror = function (msg, src, line, col) {
  var r = document.getElementById('root');
  if (r) r.innerHTML = '<pre style="color:#B00020;font-size:11px;white-space:pre-wrap;padding:12px">网页演示出错：\\n' +
    msg + '\\n' + (src || '').split('/').pop() + ':' + line + ':' + col + '</pre>';
  return false;
};
window.__MODULES__ = {};
window.__def = function (id, factory) { window.__MODULES__[id] = factory; };
window.__PAGES__ = ${JSON.stringify(PAGES)};
window.__COMPONENTS__ = {};
window.__COMP_AST__ = ${JSON.stringify(compAst)};
window.__TABS__ = ${JSON.stringify(TABS)};
</script>
<script>
${modules}
</script>
<script>
${runtime.replace(/<\/script/gi, '<\\/script')}
</script>
</body></html>`;

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'app.html'), appHtml, 'utf8');

  const frame = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>兰欧茜校服 · 网页演示</title>
<style>
  html, body { margin: 0; height: 100%; }
  body { background: #E9E1D3;
    background-image: radial-gradient(circle at 20% 10%, #F3ECDF 0, transparent 55%), radial-gradient(circle at 85% 85%, #EFE4D2 0, transparent 50%);
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #2E4A3F;
    display: flex; align-items: center; justify-content: center; }
  .wrap { display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .brand { font-family: "Noto Serif SC", "Songti SC", SimSun, serif; font-size: 22px; letter-spacing: 4px; }
  .brand small { font-family: -apple-system, "PingFang SC", sans-serif; font-size: 12px; letter-spacing: 1px;
    color: #8A8378; margin-left: 10px; }
  .device { width: 375px; height: 812px; border-radius: 34px; overflow: hidden; background: #F7F3EC;
    box-shadow: 0 26px 60px rgba(60,45,30,.28), 0 0 0 8px #22302A, 0 0 0 9px #3A4A42; }
  iframe { width: 375px; height: 812px; border: 0; display: block; }
  .tip { font-size: 12px; color: #7C7467; text-align: center; line-height: 1.8; max-width: 520px; }
  .tip b { color: #2E4A3F; font-weight: 600; }
  .actions { display: flex; gap: 10px; }
  .actions button { border: 1px solid #C9BFAE; background: #FBF8F2; color: #2E4A3F; font-size: 12px;
    padding: 8px 16px; border-radius: 20px; cursor: pointer; }
  .actions button:hover { background: #fff; }
  @media (max-width: 430px) {
    .tip, .brand { display: none; }
    body { background: #F7F3EC; align-items: flex-start; overflow-x: auto; }
    .device { transform-origin: top left; transform: scale(calc(100vw / 375)); }
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">兰欧茜 <small>校服 · 珠海</small></div>
  <div class="device"><iframe id="app" src="app.html" scrolling="no"></iframe></div>
  <div class="actions">
    <button onclick="document.getElementById('app').contentWindow.__reset()">重置演示数据</button>
    <button onclick="var w=document.getElementById('app').contentWindow; w.getApp().globalData.adminUnlocked=true; w.location.hash='#/admin'">看店长端</button>
  </div>
  <div class="tip">首页卡片 → 详情选码 → 加购 → 结算 → 转账 → 订单详情，整条链路都能点。<br>
  店长端入口在「我的 → 店长入口」，口令 <b>2468</b>。</div>
</div>
</body></html>`;

  fs.writeFileSync(path.join(OUT, 'index.html'), appHtml, 'utf8');
  fs.writeFileSync(path.join(OUT, 'frame.html'), frame, 'utf8');
  const size = (fs.statSync(path.join(OUT, 'app.html')).size / 1024).toFixed(0);
  console.log('web/index.html  web/app.html (' + size + ' KB)  images: ' + fs.readdirSync(imgDst).length);
}

main();

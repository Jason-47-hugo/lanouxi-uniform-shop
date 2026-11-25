/* 浏览器端轻量运行时：把 WXML/WXSS/Page 配置渲染成 DOM（预览用，非小程序真机环境） */
/* 网页演示版运行时：在浏览器里模拟 wx / Page / Component，把真实 WXML 渲染成 DOM。
   只实现本项目用到的能力：wx:for、wx:if/elif/else、{{}}、bindtap/input/change、picker、switch。 */
(function () {
  'use strict';

  var PAGES = window.__PAGES__;
  var COMPONENTS = window.__COMPONENTS__;
  var MODULES = window.__MODULES__;
  var TABS = window.__TABS__;

  var moduleCache = {};
  function __req(id) {
    if (moduleCache[id]) return moduleCache[id].exports;
    var mod = { exports: {} };
    moduleCache[id] = mod;
    if (!MODULES[id]) throw new Error('missing module ' + id);
    MODULES[id](mod, mod.exports, __req);
    return mod.exports;
  }

  /* ---------------- storage ---------------- */
  var memory = {};
  var PREFIX = 'lanshi_web_';
  function lsGet(k) {
    try {
      var raw = localStorage.getItem(PREFIX + k);
      return raw === null ? '' : JSON.parse(raw);
    } catch (e) { return Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : ''; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch (e) { memory[k] = v; }
  }
  function lsDel(k) {
    try { localStorage.removeItem(PREFIX + k); } catch (e) { delete memory[k]; }
    delete memory[k];
  }

  /* ---------------- app ---------------- */
  var pendingCfg = null;
  var pendingKind = null;
  var app = {
    globalData: { statusBarHeight: 20, adminUnlocked: false, checkoutDraft: null, storePhone: '' },
    updateCartBadge: function () {
      try {
        var store = __req('utils/store');
        var n = store.cartCount();
        var badge = document.getElementById('cart-badge');
        if (badge) {
          badge.textContent = n > 99 ? '99+' : String(n);
          badge.style.display = n ? 'flex' : 'none';
        }
      } catch (e) { /* ignore */ }
    }
  };
  window.getApp = function () { return app; };
  window.App = function (cfg) {
    Object.assign(app, cfg);
    if (cfg.onLaunch) cfg.onLaunch.call(app);
    if (cfg.onShow) cfg.onShow.call(app);
  };
  window.Page = function (cfg) { pendingCfg = cfg; pendingKind = 'page'; };
  window.Component = function (cfg) { pendingCfg = cfg; pendingKind = 'component'; };

  /* ---------------- wx ---------------- */
  var phone = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('on'); }, 1400);
  }
  function routeOf(url) {
    var u = String(url || '').replace(/^\/?pages\//, '').replace(/\/[^/?]+(\?|$)/, '$1');
    var q = '';
    var i = u.indexOf('?');
    if (i >= 0) { q = u.slice(i); u = u.slice(0, i); }
    return '#/' + u + q;
  }
  function hasHistory() { return window.history.length > 1; }

  var wx = {
    getStorageSync: lsGet,
    setStorageSync: lsSet,
    removeStorageSync: lsDel,
    clearStorageSync: function () { try { localStorage.clear(); } catch (e) {} },
    getStorageInfoSync: function () {
      var keys = [];
      try { for (var i = 0; i < localStorage.length; i += 1) keys.push(localStorage.key(i)); } catch (e) {}
      return { keys: keys };
    },
    getWindowInfo: function () { return { statusBarHeight: 20, windowWidth: 375, windowHeight: 812, screenWidth: 375, screenHeight: 812, pixelRatio: 2 }; },
    getSystemInfoSync: function () { return wx.getWindowInfo(); },
    getMenuButtonBoundingClientRect: function () { return { top: 26, height: 32, width: 87 }; },
    showToast: function (o) { toast((o && o.title) || ''); },
    hideToast: function () {},
    showLoading: function () {},
    hideLoading: function () {},
    showModal: function (o) {
      o = o || {};
      var ok = false;
      var content = '';
      if (o.editable) {
        var v = window.prompt((o.title || '') + '\n' + (o.content || ''), o.placeholderText || '');
        ok = v !== null;
        content = v || '';
      } else {
        ok = window.confirm((o.title ? o.title + '\n\n' : '') + (o.content || ''));
      }
      if (o.success) o.success({ confirm: ok, cancel: !ok, content: content });
      if (o.complete) o.complete({ confirm: ok, content: content });
    },
    showActionSheet: function (o) { if (o && o.fail) o.fail({}); },
    navigateTo: function (o) { if (o && o.url) location.hash = routeOf(o.url); },
    redirectTo: function (o) { console.log('[wx] redirectTo ' + (o && o.url)); if (o && o.url) location.hash = routeOf(o.url); },
    switchTab: function (o) { if (o && o.url) location.hash = routeOf(o.url); },
    navigateBack: function () { goBack(); },
    setNavigationBarTitle: function (o) {
      var t = document.getElementById('nav-title');
      if (t && o && o.title) t.textContent = o.title;
    },
    setNavigationBarColor: function () {},
    setTabBarBadge: function (o) {
      if (!o || o.index !== 2) return;
      var badge = document.getElementById('cart-badge');
      if (badge) { badge.textContent = o.text || ''; badge.style.display = o.text ? 'flex' : 'none'; }
    },
    removeTabBarBadge: function () {
      var badge = document.getElementById('cart-badge');
      if (badge) badge.style.display = 'none';
    },
    setClipboardData: function (o) {
      var text = (o && o.data) || '';
      var done = function () { toast('已复制'); if (o && o.success) o.success({}); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        done();
      }
    },
    previewImage: function (o) {
      var urls = (o && (o.urls || [o.current])) || [];
      if (!urls.length) return;
      var mask = document.createElement('div');
      mask.className = 'lightbox';
      mask.innerHTML = '<img src="' + urls[0] + '"><p>点任意处关闭</p>';
      mask.onclick = function () { document.body.removeChild(mask); };
      document.body.appendChild(mask);
    },
    makePhoneCall: function (o) { if (o && o.phoneNumber) window.location.href = 'tel:' + o.phoneNumber; },
    saveImageToPhotosAlbum: function (o) { toast('长按图片可保存'); if (o && o.success) o.success({}); },
    pageScrollTo: function () {},
    stopPullDownRefresh: function () {},
    nextTick: function (fn) { setTimeout(fn, 0); },
    onWindowResize: function () {}, offWindowResize: function () {},
    showShareMenu: function () {}, hideShareMenu: function () {},
    requestSubscribeMessage: function () {},
    chooseAddress: function () {},
    createSelectorQuery: function () {
      var q = {
        select: function () { return q; },
        selectAll: function () { return q; },
        boundingClientRect: function () { return q; },
        scrollOffset: function () { return q; },
        fields: function () { return q; },
        exec: function (cb) { if (cb) cb([]); }
      };
      return q;
    }
  };
  wx = new Proxy(wx, {
    get: function (t, k) {
      if (k in t) return t[k];
      return function () {};
    }
  });
  window.wx = wx;

  /* ---------------- 表达式与渲染 ---------------- */
  function evalExpr(expr, scope) {
    try {
      /* eslint-disable no-new-func */
      var fn = new Function('__s', 'with (__s) { return (' + expr + '); }');
      return fn(scope);
    } catch (e) { return ''; }
  }
  function exprOf(raw) {
    if (typeof raw !== 'string') return String(raw);
    var m = /^\s*\{\{([\s\S]*)\}\}\s*$/.exec(raw);
    return m ? m[1] : raw;
  }
  function truthy(v) { return !(v === false || v === 0 || v === '' || v === null || v === undefined); }
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ESC[c]; }); }
  function interp(str, scope) {
    if (typeof str !== 'string' || str.indexOf('{{') < 0) return str;
    return str.replace(/\{\{([\s\S]*?)\}\}/g, function (_, expr) {
      var v = evalExpr(expr, scope);
      return v === undefined || v === null || v === false ? '' : String(v);
    });
  }

  var compInstances = [];
  var current = null; /* { inst, meta } */

  function camel(s) { return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

  function datasetOf(node, scope) {
    var ds = {};
    Object.keys(node.attrs).forEach(function (k) {
      if (k.indexOf('data-') === 0) ds[camel(k.slice(5))] = interp(node.attrs[k], scope);
    });
    return ds;
  }

  function eventAttrs(node, ctx) {
    var out = '';
    var scope = (ctx && ctx.__scope) || {};
    var ds = datasetOf(node, scope);
    Object.keys(node.attrs).forEach(function (k) {
      var m = /^(bind|catch)([a-z]+)$/.exec(k);
      if (!m) return;
      var type = m[2];
      var handler = interp(node.attrs[k], scope);
      if (!handler) return;
      out += ' data-' + type + '="' + esc(handler) + '"';
    });
    if (ctx && typeof ctx.__ci === 'number') out += ' data-ci="' + ctx.__ci + '"';
    if (Object.keys(ds).length) out += ' data-ds="' + esc(encodeURIComponent(JSON.stringify(ds))) + '"';
    return out;
  }

  function renderNodes(nodes, scope, ctx, out) {
    var chainActive = false;
    var chainMatched = false;
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.type === 'text') {
        var t = interp(node.text, scope);
        if (/\S/.test(t)) out.push(esc(t));
        continue;
      }
      if (node.tag === 'root') { renderNodes(node.children, scope, ctx, out); continue; }

      var hasIf = node.attrs['wx:if'] !== undefined;
      var hasElif = node.attrs['wx:elif'] !== undefined;
      var hasElse = node.attrs['wx:else'] !== undefined;
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
      var list = evalExpr(exprOf(node.attrs['wx:for']), scope);
      var arr = Array.isArray(list) ? list : [];
      var itemName = node.attrs['wx:for-item'] || 'item';
      var idxName = node.attrs['wx:for-index'] || 'index';
      var attrs = {};
      Object.keys(node.attrs).forEach(function (k) {
        if (['wx:for', 'wx:for-item', 'wx:for-index', 'wx:key'].indexOf(k) < 0) attrs[k] = node.attrs[k];
      });
      for (var n = 0; n < arr.length; n += 1) {
        var s = Object.create(scope);
        s[itemName] = arr[n];
        s[idxName] = n;
        renderNode({ tag: node.tag, attrs: attrs, children: node.children }, s, ctx, out);
      }
      return;
    }
    if (node.tag === 'block') { renderNodes(node.children, scope, ctx, out); return; }

    if (node.tag === 'product-card') {
      var comp = COMPONENTS['product-card'];
      var ci = compInstances.length;
      var cinst = Object.create(comp.methods || {});
      cinst.data = Object.assign({}, comp.data);
      cinst.data.item = evalExpr(exprOf(node.attrs.item || 'item'), scope) || {};
      if (node.attrs.showSchool !== undefined) cinst.data.showSchool = truthy(evalExpr(exprOf(node.attrs.showSchool), scope));
      cinst.__ci = ci;
      cinst.setData = function (patch) { Object.assign(this.data, patch); };
      compInstances.push(cinst);
      renderNodes(comp.ast.children, cinst.data, { __ci: ci, __scope: scope }, out);
      return;
    }

    var a = {};
    Object.keys(node.attrs).forEach(function (k) {
      if (k.indexOf('bind') === 0 || k.indexOf('catch') === 0 || k.indexOf('wx:') === 0 || k.indexOf('data-') === 0) return;
      a[k] = interp(node.attrs[k], scope);
    });
    var cls = a.class ? ' class="' + esc(a.class) + '"' : '';
    var style = a.style ? ' style="' + esc(a.style) + '"' : '';
    var ev = eventAttrs(node, ctx || { __scope: scope });

    if (node.tag === 'image') {
      var src = String(a.src || '');
      var url = src.indexOf('/images/') === 0 ? src.slice(1) : src;
      var fit = a.mode === 'aspectFill' ? 'object-fit:cover;' : (a.mode === 'aspectFit' ? 'object-fit:contain;' : 'width:100%;');
      out.push('<img' + cls + ' src="' + esc(url) + '" style="' + fit + (a.style ? esc(a.style) + ';' : '') + '"' + ev + '>');
      return;
    }

    if (node.tag === 'input') {
      var type = a.type === 'number' || a.type === 'digit' ? 'number' : 'text';
      var extra = '';
      if (a['placeholder-class']) extra += ' placeholder-class="' + esc(a['placeholder-class']) + '"';
      out.push('<input' + cls + ' type="' + type + '" value="' + esc(a.value || '') +
        '" placeholder="' + esc(a.placeholder || '') + '" maxlength="' + esc(a.maxlength || '140') +
        '" style="' + (a.style ? esc(a.style) + ';' : '') + '"' + ev + '>');
      return;
    }

    if (node.tag === 'switch') {
      var on = truthy(evalExpr(exprOf(node.attrs.checked || ''), scope));
      var handler = '';
      Object.keys(node.attrs).forEach(function (k) {
        if (/^(bind|catch)change$/.test(k)) handler = interp(node.attrs[k], scope);
      });
      var dsJson = encodeURIComponent(JSON.stringify(datasetOf(node, scope)));
      out.push('<span class="__switch' + (on ? ' __on' : '') + '" data-switch="1" data-checked="' + (on ? '1' : '0') +
        '" data-change="' + esc(handler) + '" data-ds="' + esc(dsJson) + '"' +
        (ctx && typeof ctx.__ci === 'number' ? ' data-ci="' + ctx.__ci + '"' : '') + '><i></i></span>');
      return;
    }

    if (node.tag === 'picker') {
      var rangeRaw = node.attrs.range ? interp(node.attrs.range, scope) : '';
      var list2 = [];
      try { list2 = JSON.parse(evalExpr(exprOf(node.attrs.range || '[]'), scope) || '[]'); } catch (e) { list2 = []; }
      if (!Array.isArray(list2)) list2 = [];
      var val = evalExpr(exprOf(node.attrs.value || '0'), scope);
      var h2 = '';
      Object.keys(node.attrs).forEach(function (k) {
        if (/^(bind|catch)change$/.test(k)) h2 = interp(node.attrs[k], scope);
      });
      out.push('<div' + cls + ' data-picker="1" data-range="' + esc(encodeURIComponent(JSON.stringify(list2))) +
        '" data-value="' + esc(String(val)) + '" data-change="' + esc(h2) + '" style="' +
        (a.style ? esc(a.style) + ';' : '') + '"' + ev + '>');
      renderNodes(node.children, scope, ctx, out);
      out.push('</div>');
      return;
    }

    var tagMap = {
      view: 'div', text: 'span', 'scroll-view': 'div', swiper: 'div', 'swiper-item': 'div',
      navigator: 'div', button: 'button', textarea: 'textarea', form: 'div', label: 'label'
    };
    var tag = tagMap[node.tag] || 'div';
    var extraStyle = '';
    if (node.tag === 'scroll-view') {
      extraStyle = (a['scroll-x'] !== undefined || node.attrs['scroll-x'] !== undefined)
        ? 'overflow-x:auto;overflow-y:hidden;' : 'overflow-y:auto;';
    }
    out.push('<' + tag + cls + ' style="' + extraStyle + (a.style ? esc(a.style) + ';' : '') + '"' + ev + '>');
    renderNodes(node.children, scope, ctx, out);
    out.push('</' + tag + '>');
  }

  /* ---------------- 页面 ---------------- */
  var pageCfgs = {};
  function loadPage(name) {
    if (pageCfgs[name]) return pageCfgs[name];
    pendingCfg = null; pendingKind = null;
    __req('pages/' + name + '/' + name);
    if (!pendingCfg) throw new Error('page not registered: ' + name);
    pageCfgs[name] = pendingCfg;
    return pendingCfg;
  }

  function setPath(obj, key, val) {
    var parts = key.split('.');
    var o = obj;
    for (var i = 0; i < parts.length - 1; i += 1) {
      if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = val;
  }

  var screenEl = null;
  var rootEl = null;
  var scrollPos = {};
  var historyStack = [];

  function goBack() {
    historyStack.pop();
    var prev = historyStack[historyStack.length - 1] || 'home';
    location.hash = '#/' + prev;
  }

  function applyRoute() {
    var hash = location.hash.replace(/^#/, '') || '/home';
    var qi = hash.indexOf('?');
    var path = qi >= 0 ? hash.slice(0, qi) : hash;
    var qstr = qi >= 0 ? hash.slice(qi + 1) : '';
    var name = path.replace(/^\//, '');
    var meta = PAGES[name];
    if (!meta) { location.replace('#/home'); return; }
    var query = {};
    qstr.split('&').forEach(function (kv) {
      if (!kv) return;
      var p = kv.split('=');
      query[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });

    if (current && current.name) scrollPos[current.name] = screenEl.scrollTop;
    if (historyStack[historyStack.length - 1] !== name) historyStack.push(name);

    var cfg = loadPage(name);
    console.log('[route] start ' + name);
    var inst = Object.create(cfg);
    inst.data = JSON.parse(JSON.stringify(cfg.data || {}));
    inst.__quiet = false;
    inst.setData = function (patch, cb) {
      var self = this;
      Object.keys(patch).forEach(function (k) { setPath(self.data, k, patch[k]); });
      if (!self.__quiet && current && current.inst === self) renderCurrent();
      if (typeof cb === 'function') cb.call(self);
    };
    current = { name: name, inst: inst, meta: meta };

    document.getElementById('phone').className = 'phone' + (meta.customNav ? ' custom' : '') + (meta.tab ? ' hastab' : '');
    document.body.className = 'tab-' + (meta.tab || 'none') + (meta.customNav ? ' custom' : '');
    var pcss = document.getElementById('pagecss');
    if (pcss) pcss.textContent = meta.css || '';
    document.getElementById('nav-title').textContent = meta.title || '';
    document.getElementById('back').style.display = meta.tab ? 'none' : 'flex';
    document.querySelectorAll('#tabbar .tab').forEach(function (t) {
      var on = t.getAttribute('data-tab') === meta.tab;
      t.classList.toggle('on', on);
      var img = t.querySelector('img');
      if (img) {
        var icon = img.getAttribute('data-icon') || t.getAttribute('data-tab');
        img.src = 'images/' + icon + (on ? '-on' : '') + '.png';
      }
    });
    var tabbar = document.getElementById('tabbar');
    if (tabbar) tabbar.style.display = meta.tab ? 'flex' : 'none';
    screenEl.scrollTop = scrollPos[name] || 0;

    if (name === 'checkout' && !app.globalData.checkoutDraft) {
      var st = __req('utils/store');
      var picked = st.selectedCart();
      var src = picked.length ? picked : st.getCart();
      if (src.length) {
        app.globalData.checkoutDraft = {
          from: 'web',
          items: src.map(function (i) {
            return { productId: i.productId, color: i.color, size: i.size, qty: i.qty };
          }),
          cartKeys: src.map(function (i) { return i.key; })
        };
      }
    }

    if (name === 'admin' && query.demo === '1') app.globalData.adminUnlocked = true;
    if (name === 'order' && (!query.id || query.id === 'latest')) {
      var allOrders = __req('utils/store').orderList('all');
      if (allOrders.length) query.id = allOrders[0].id;
    }

    if (cfg.onLoad) cfg.onLoad.call(inst, query);
    console.log('[route] loaded ' + name);
    renderCurrent();
    console.log('[route] rendered ' + name);
    screenEl.scrollTop = scrollPos[name] || 0;
    if (cfg.onShow) cfg.onShow.call(inst);
    app.updateCartBadge();
  }

  function renderCurrent() {
    if (!current) return;
    compInstances = [];
    var out = [];
    renderNodes(current.meta.ast.children, current.inst.data, { __scope: current.inst.data }, out);
    rootEl.innerHTML = out.join('');
  }

  /* ---------------- 事件派发 ---------------- */
  function dsOf(el) {
    var raw = el.getAttribute('data-ds');
    if (!raw) return {};
    try { return JSON.parse(decodeURIComponent(raw)); } catch (e) { return {}; }
  }
  function findTarget(el) {
    var ci = el.getAttribute('data-ci');
    if (ci !== null) return compInstances[+ci];
    return current && current.inst;
  }
  function callHandler(el, handler, detail) {
    var target = findTarget(el);
    if (!target || !handler) return;
    var fn = target[handler];
    if (typeof fn !== 'function') return;
    var ds = dsOf(el);
    fn.call(target, {
      type: 'tap',
      currentTarget: { dataset: ds, id: el.id || '' },
      target: { dataset: ds, id: el.id || '' },
      detail: detail || {}
    });
  }

  function bindEvents() {
    phone.addEventListener('click', function (e) {
      var t = e.target.closest('[data-tap],[data-switch],[data-picker]');
      if (!t) {
        var tab = e.target.closest('[data-tab]');
        if (tab) { location.hash = '#/' + tab.getAttribute('data-tab'); }
        return;
      }
      if (t.hasAttribute('data-tap')) {
        console.log('[tap] ' + t.getAttribute('data-tap'));
        callHandler(t, t.getAttribute('data-tap'), {});
        return;
      }
      if (t.hasAttribute('data-switch')) {
        var on = t.getAttribute('data-checked') === '1';
        callHandler(t, t.getAttribute('data-change'), { value: !on });
        renderCurrent();
        return;
      }
      if (t.hasAttribute('data-picker')) {
        openPicker(t);
      }
    });

    phone.addEventListener('input', function (e) {
      var el = e.target.closest('[data-input]');
      if (!el || !current) return;
      current.inst.__quiet = true;
      callHandler(el, el.getAttribute('data-input'), { value: e.target.value });
      current.inst.__quiet = false;
      app.updateCartBadge();
    });

    phone.addEventListener('change', function (e) {
      var el = e.target.closest('[data-input]');
      if (el && current) { renderCurrent(); }
    });

    phone.addEventListener('blur', function (e) {
      var el = e.target.closest('[data-input]');
      if (el) renderCurrent();
    }, true);
  }

  function openPicker(el) {
    var range = [];
    try { range = JSON.parse(decodeURIComponent(el.getAttribute('data-range') || '[]')); } catch (e) { range = []; }
    if (!range.length) return;
    var cur = parseInt(el.getAttribute('data-value') || '0', 10) || 0;
    var mask = document.createElement('div');
    mask.className = 'picker-mask';
    var list = range.map(function (label, i) {
      return '<div class="picker-item' + (i === cur ? ' on' : '') + '" data-i="' + i + '">' + esc(label) + '</div>';
    }).join('');
    mask.innerHTML = '<div class="picker-sheet"><div class="picker-title">请选择</div>' + list + '<div class="picker-cancel">取消</div></div>';
    mask.addEventListener('click', function (ev) {
      var item = ev.target.closest('[data-i]');
      if (item) {
        callHandler(el, el.getAttribute('data-change'), { value: parseInt(item.getAttribute('data-i'), 10) });
        renderCurrent();
      }
      document.body.removeChild(mask);
    });
    document.body.appendChild(mask);
  }

  /* ---------------- 初始数据 ---------------- */
  function seed() {
    var store = __req('utils/store');
    store.ensureInit();
    if (lsGet('seeded4')) return;
    store.addToCart({ productId: 'p1', color: '藏青', size: 'L', qty: 1 });
    store.addToCart({ productId: 'p7', color: '藏青', size: 'M', qty: 1 });
    store.addToCart({ productId: 'p3', color: '浅蓝', size: 'M', qty: 1 });

    var addr = { name: '林晓', phone: '13800138000', detail: '珠海市香洲区情侣中路 88 号 3 栋 502' };
    // 一单待付款
    store.createOrder({
      items: [{ productId: 'p1', color: '藏青', size: 'L', qty: 1 }],
      delivery: 'express', address: addr, usePoints: false,
      remark: '开学前要用，麻烦快一点'
    });
    // 一单已付款、已发货
    var o2 = store.createOrder({
      items: [
        { productId: 'p3', color: '浅蓝', size: 'M', qty: 1 },
        { productId: 'p6', color: '砖红', size: '均码', qty: 1 }
      ],
      delivery: 'express', address: addr, usePoints: false
    }).order;
    store.payOrder(o2.id);
    store.ship(o2.id, '顺丰速运', 'SF1402938712');
    // 一单到店自提、已完成
    var o3 = store.createOrder({
      items: [{ productId: 'p4', color: '米白', size: 'S', qty: 1 }],
      delivery: 'pickup', usePoints: false
    }).order;
    store.payOrder(o3.id);
    store.ship(o3.id, '到店自提', '');
    store.confirmReceipt(o3.id);

    store.seedDemoOrders();
    lsSet('seeded4', 1);
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    phone = document.getElementById('phone') || document.body;
    screenEl = document.getElementById('phone') || document.body;
    rootEl = document.getElementById('root');
    bindEvents();

    var tabsHtml = TABS.map(function (t) {
      return '<div class="tab" data-tab="' + t.name + '"><img src="images/' + t.icon +
        '.png" data-icon="' + t.icon + '"><span>' + t.label + '</span>' +
        (t.name === 'cart' ? '<i id="cart-badge" class="badge"></i>' : '') + '</div>';
    }).join('');
    document.getElementById('tabbar').innerHTML = tabsHtml;

    var backBtn = document.getElementById('back');
    if (backBtn) backBtn.addEventListener('click', function () { goBack(); });
    var resetBtn = document.getElementById('reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        if (!window.confirm('清空演示数据？订单、积分、购物车都会回到初始状态。')) return;
        try { localStorage.clear(); } catch (e) {}
        location.hash = '#/home';
        location.reload();
      });
    }
    window.__reset = function () {
      try { localStorage.clear(); } catch (e) {}
      location.reload();
    };

    __req('app');

    pendingCfg = null;
    __req('components/product-card/index');
    var compCfg = pendingCfg || {};
    var compData = Object.assign({}, compCfg.data || {});
    Object.keys(compCfg.properties || {}).forEach(function (k) {
      var p = compCfg.properties[k];
      compData[k] = p && p.value !== undefined ? p.value : '';
    });
    COMPONENTS['product-card'] = {
      ast: window.__COMP_AST__,
      data: compData,
      methods: compCfg.methods || {}
    };

    seed();
    if (!location.hash) location.replace('#/home');
    window.addEventListener('hashchange', applyRoute);
    applyRoute();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
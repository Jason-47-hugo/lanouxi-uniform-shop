/* 生成 web/audit.html：真实渲染后测量布局，结果写进 <pre id="audit">。
   当前模型看不了截图，只能靠程序化测量判断「溢出 / 重叠 / 塌陷 / 底部被遮」。
   所有坐标以 #screen 左上角为原点。 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.html'), 'utf8');

const script = `<pre id="audit" style="position:fixed;left:-9999px;top:0;"></pre>
<script>
setTimeout(function () {
  var out = {};
  var sc = document.getElementById('screen');
  var root = document.getElementById('root');
  var phone = document.getElementById('phone');
  var tab = document.getElementById('tabbar');
  var o = sc.getBoundingClientRect();
  var W = Math.round(o.width);

  function rel(el) {
    var r = el.getBoundingClientRect();
    return { l: Math.round(r.left - o.left), t: Math.round(r.top - o.top), w: Math.round(r.width), h: Math.round(r.height) };
  }

  // 1) 横向溢出（跳过被 overflow 裁剪的祖先内部）
  var over = [];
  var all = root.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    var p = el.parentElement, clipped = false;
    while (p && p !== root) {
      if (/hidden|auto|scroll/.test(getComputedStyle(p).overflowX)) { clipped = true; break; }
      p = p.parentElement;
    }
    if (clipped) continue;
    var left = r.left - o.left, right = r.right - o.left;
    if (right > W + 0.6 || left < -0.6) over.push((el.className || el.tagName) + ' ' + Math.round(left) + '..' + Math.round(right));
  }
  out.overflow = over.slice(0, 8);

  // 2) 文字挤压 / 行高裁切：不再只查固定几个类名，而是查所有带文字的元素。
  //    典型问题：容器写了固定 height，但字号的视觉高度比它大，字会溢出到下一个元素上。
  var squeezed = [];
  var seen = {};
  var nodes = root.querySelectorAll('*');
  for (var s = 0; s < nodes.length; s++) {
    var e = nodes[s];
    if (e.children.length) continue;                 // 只看叶子节点
    var txt = (e.textContent || '').trim();
    if (!txt) continue;
    var cs = getComputedStyle(e);
    if (cs.overflow === 'visible' && cs.overflowY === 'visible' && e.clientHeight === 0) continue;
    var cw = e.clientWidth, ch = e.clientHeight;
    if (!cw || !ch) continue;
    var key = (e.className || e.tagName) + '|' + txt.slice(0, 12);
    if (seen[key]) continue;
    if (e.scrollWidth > cw + 2) { seen[key] = 1; squeezed.push('W ' + (e.className || e.tagName) + ' ' + e.scrollWidth + '>' + cw + ' 「' + txt.slice(0, 14) + '」'); }
    if (e.scrollHeight > ch + 3) { seen[key] = 1; squeezed.push('H ' + (e.className || e.tagName) + ' ' + e.scrollHeight + '>' + ch + ' 「' + txt.slice(0, 14) + '」'); }
  }
  out.squeezed = squeezed.slice(0, 20);

  // 3) 关键区块
  var secs = {};
  ['.nav','.hero','.entries','.service','.hscroll','.stage-tabs','.schools','.invite','.points-card','.store-card','.footer'].forEach(function (sel) {
    var e = root.querySelector(sel);
    secs[sel] = e ? rel(e) : null;
  });
  out.sections = secs;

  // 4) 滚到底后，内容与固定底栏是否重叠
  phone.scrollTop = phone.scrollHeight;
  var bar = root.querySelector('.cart-bar, .bar, .foot-bar, .bottom-bar');
  var barRect = bar ? bar.getBoundingClientRect() : null;
  var barTop = barRect ? Math.round(barRect.top - o.top) : null;
  var lastBottom = 0, lastName = '';
  var kids = root.querySelectorAll('.page > *');
  for (var k = 0; k < kids.length; k++) {
    var kc = kids[k].className || '';
    if (/\\b(cart-bar|bar|foot-bar|bottom-bar|mask|sheet)\\b/.test(kc)) continue;
    var kr = kids[k].getBoundingClientRect();
    if (kr.height > 0 && kr.bottom - o.top > lastBottom) { lastBottom = Math.round(kr.bottom - o.top); lastName = kc || kids[k].tagName; }
  }
  out.barTop = barTop;
  out.lastChild = lastName;
  out.lastChildBottom = lastBottom;
  out.coveredByBar = barTop !== null && lastBottom > barTop ? lastBottom - barTop : 0;
  phone.scrollTop = 0;

  out.scrollH = phone.scrollHeight;
  out.clientH = phone.clientHeight;
  out.tabH = tab && tab.offsetParent !== null ? Math.round(tab.getBoundingClientRect().height) : 0;
  out.bodyClass = document.body.className;
  out.textLen = root.innerText.replace(/\\s/g, '').length;
  out.hash = location.hash;
  out.screenW = W;

  document.getElementById('audit').textContent = 'AUDIT ' + JSON.stringify(out);
}, 1500);
</script>`;

fs.writeFileSync(path.join(__dirname, '..', 'web', 'audit.html'), src.replace('</body>', script + '</body>'));
console.log('ok');

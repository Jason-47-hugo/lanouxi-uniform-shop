/* 挑码：这款校服的尺码就是身高（150/155/…/200），所以只按身高挑，不算体重、不算 BMI。
   纯函数，不碰 storage，方便 preview/flow-test.js 直接测。
   规则：
     1. 商品尺码是数字（150/155/…）时，取和身高最接近的那一档；
     2. 身高比最小码还矮 / 比最大码还高，给最小码 / 最大码，并说明；
     3. 身高卡在两档中间（离两档一样近），按「拿不准选大一码」给大的一档；
     4. 单尺码（均码）直接给那一个；
     5. 尺码是字母（老数据）时退回按次序找，只提示看表，不再算体重。 */
'use strict';

const LETTER_AS_HEIGHT = {
  XXS: 145, XS: 150, S: 158, M: 165, L: 172, XL: 180, XXL: 188, XXXL: 195
};

function toNumber(v) {
  if (v === '' || v === null || v === undefined) return NaN;
  const n = Number(String(v).replace(/[^\d.]/g, ''));
  return isFinite(n) ? n : NaN;
}

function isNumericSize(s) {
  return /^\d{3}$/.test(String(s));
}

/* 尺码表 → 身高刻度表，例如 ['150','155'] → [{size:'150',h:150}, ...] */
function buildBands(sizes) {
  return (sizes || []).map(function (size) {
    if (isNumericSize(size)) return { size: size, h: Number(size) };
    const h = LETTER_AS_HEIGHT[String(size).toUpperCase()];
    return { size: size, h: h || 165 };
  });
}

/* 身高 → 最接近的一档；返回 {index, diff, out}
   out: -1 矮于最小码，1 高于最大码，0 正常 */
function bandOfHeight(bands, h) {
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < bands.length; i += 1) {
    const d = Math.abs(bands[i].h - h);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  if (h < bands[0].h) return { index: 0, diff: bands[0].h - h, out: -1 };
  if (h > bands[bands.length - 1].h) {
    return { index: bands.length - 1, diff: h - bands[bands.length - 1].h, out: 1 };
  }
  return { index: best, diff: bestDiff, out: 0 };
}

/* product = 商品对象；height 可以是输入框原样传进来的字符串 */
function recommend(product, height) {
  if (!product || !product.sizes || !product.sizes.length) {
    return { ok: false, msg: '这件商品没有尺码信息' };
  }
  const sizes = product.sizes;
  if (sizes.length === 1) {
    return {
      ok: true,
      size: sizes[0],
      index: 0,
      adjusted: 0,
      note: '这款只有一个尺码（' + sizes[0] + '），不用挑。'
    };
  }

  const h = toNumber(height);
  if (!isFinite(h) || h < 90 || h > 220) {
    return { ok: false, msg: '身高填 90–220cm。' };
  }

  const bands = buildBands(sizes);
  const at = bandOfHeight(bands, h);
  let idx = at.index;
  const notes = [];

  if (at.out === -1) {
    notes.push('这款最小是 ' + bands[0].size + ' 码（适合 ' + bands[0].h + 'cm 左右），先按最小码');
  } else if (at.out === 1) {
    const last = bands[bands.length - 1];
    notes.push('这款最大是 ' + last.size + ' 码（适合 ' + last.h + 'cm 左右），再高就得定制');
  } else if (at.diff === 0) {
    notes.push('正好有 ' + h + ' 码');
  } else if (at.diff <= 2.5) {
    notes.push('和 ' + bands[idx].h + ' 码只差 ' + at.diff + 'cm，穿这个最贴身');
  } else {
    notes.push('离 ' + bands[idx].h + ' 码最近');
  }

  /* 卡在两档正中间：按校服「拿不准选大一码」的习惯给大一档 */
  if (at.out === 0 && idx < bands.length - 1) {
    const up = bands[idx + 1];
    if (Math.abs(up.h - h) === Math.abs(bands[idx].h - h)) {
      idx += 1;
      notes.push('正好在两档中间，按「拿不准选大一码」给 ' + up.size + ' 码');
    }
  }

  const picked = bands[idx];
  const gap = picked.h - h;
  let tip = '';
  if (gap > 0) tip = '比身高高 ' + gap + 'cm，孩子长个子还能穿一年';
  else if (gap === 0) tip = '和身高一样，贴身';
  else tip = '比身高低 ' + Math.abs(gap) + 'cm，会略短，介意的话选大一码';

  return {
    ok: true,
    size: picked.size,
    index: sizes.indexOf(picked.size),
    adjusted: idx - at.index,
    note: '身高 ' + h + 'cm → ' + picked.size + ' 码（' + tip + '）。' + notes.join('；') + '。'
  };
}

module.exports = {
  recommend: recommend,
  buildBands: buildBands,
  bandOfHeight: bandOfHeight,
  isNumericSize: isNumericSize,
  LETTER_AS_HEIGHT: LETTER_AS_HEIGHT
};

/* 汇总审计结果：只看有问题的项（溢出 / 文字挤压 / 被底栏遮挡） */
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter(function (f) { return /^aud-.*\.html$/.test(f); });
files.sort().forEach(function (f) {
  const c = fs.readFileSync(path.join(__dirname, f), 'utf8');
  const i = c.indexOf('AUDIT ');
  if (i < 0) {
    console.log(f, 'NO AUDIT');
    return;
  }
  const json = JSON.parse(c.slice(i + 6, c.indexOf('</pre>', i)));
  const probs = [];
  if (json.overflow.length) probs.push('overflow ' + json.overflow.length + ': ' + json.overflow.slice(0, 4).join(' | '));
  if (json.squeezed.length) probs.push('squeezed: ' + json.squeezed.slice(0, 4).join(' | '));
  if (json.coveredByBar) probs.push('coveredByBar ' + json.coveredByBar);
  console.log((probs.length ? 'FAIL ' : 'ok   ') + f.replace(/^aud-|\.html$/g, '') +
    '  h=' + json.scrollH + ' text=' + json.textLen + (probs.length ? '\n     ' + probs.join('\n     ') : ''));
});

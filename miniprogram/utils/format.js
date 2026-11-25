function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

// 金额：整数不显示小数，非整数保留两位
function yuan(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function dateStr(ts) {
  const d = new Date(ts || Date.now());
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function timeStr(ts) {
  const d = new Date(ts || Date.now());
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function dateTime(ts) {
  return dateStr(ts) + ' ' + timeStr(ts);
}

function shortDate(ts) {
  const d = new Date(ts || Date.now());
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function maskPhone(phone) {
  const s = String(phone || '');
  return s.length === 11 ? s.slice(0, 3) + '****' + s.slice(7) : s;
}

// 生成订单号：JB + 年月日 + 时分 + 2 位随机
function orderNo() {
  const d = new Date();
  return (
    'JB' +
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(Math.floor(Math.random() * 90) + 10)
  );
}

module.exports = { yuan, dateStr, timeStr, dateTime, shortDate, maskPhone, orderNo, pad };

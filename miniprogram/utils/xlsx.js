/* 极简 XLSX 生成器：不引第三方库，只用 zip 的「存储」模式打包几段 XML。
 *
 * 为什么不用 CSV：
 *   CSV 进了 Excel 会丢前导零（手机号 0138…）、中文在部分版本的 Excel 里乱码，
 *   而且一个文件只能有一张表。店长要的是「明细 + 按月汇总」两张表。
 * 为什么不用 npm 的 exceljs：
 *   小程序包有 2MB 限制，为了一张对账单塞一个 400KB 的库不值当；这段不到 200 行。
 *
 * 用法（注意：注释里不要写带括号的 require，网页演示版的打包脚本会把它当代码替换掉，
 *       utils/cloud.js 之前就栽在这上面）：
 *   const { buildXlsx } = require '../../utils/xlsx';
 *   const buf = buildXlsx([{ name: '明细', rows: [['订单号','金额'], ['o1', 128]] }]);
 */
const CRC_TABLE = (function () {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function utf8(str) {
  /* 小程序没有 TextEncoder，这里手写一个最小实现 */
  const out = [];
  for (let i = 0; i < str.length; i += 1) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return new Uint8Array(out);
}

function u16(n) {
  return [n & 0xff, (n >> 8) & 0xff];
}

function u32(n) {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

/* 把若干 {name, bytes} 打成一个 zip（只存储，不压缩；xlsx 体积本来就小） */
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  files.forEach(function (f) {
    const nameBytes = utf8(f.name);
    const crc = crc32(f.bytes);
    const local = []
      .concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0))
      .concat(u32(crc), u32(f.bytes.length), u32(f.bytes.length))
      .concat(u16(nameBytes.length), u16(0))
      .concat(Array.prototype.slice.call(nameBytes));
    chunks.push(new Uint8Array(local), f.bytes);

    central.push(
      []
        .concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0))
        .concat(u32(crc), u32(f.bytes.length), u32(f.bytes.length))
        .concat(u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))
        .concat(Array.prototype.slice.call(nameBytes))
    );
    offset += local.length + f.bytes.length;
  });

  const centralBytes = [];
  central.forEach(function (arr) {
    centralBytes.push.apply(centralBytes, arr);
  });
  const end = []
    .concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length))
    .concat(u32(centralBytes.length), u32(offset), u16(0));

  const parts = chunks.concat([
    new Uint8Array(centralBytes),
    new Uint8Array(end)
  ]);
  let total = 0;
  parts.forEach(function (p) {
    total += p.length;
  });
  const out = new Uint8Array(total);
  let at = 0;
  parts.forEach(function (p) {
    out.set(p, at);
    at += p.length;
  });
  return out;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colName(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(rows) {
  const body = (rows || []).map(function (row, r) {
    const cells = (row || []).map(function (v, c) {
      const ref = colName(c) + (r + 1);
      if (typeof v === 'number' && isFinite(v)) {
        return '<c r="' + ref + '"><v>' + v + '</v></c>';
      }
      if (v === null || v === undefined || v === '') return '';
      return '<c r="' + ref + '" t="inlineStr"><is><t>' + esc(v) + '</t></is></c>';
    }).join('');
    return '<row r="' + (r + 1) + '">' + cells + '</row>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData>' + body + '</sheetData></worksheet>';
}

function buildXlsx(sheets) {
  const list = (sheets || []).filter(function (s) {
    return s && Array.isArray(s.rows);
  });
  if (!list.length) throw new Error('至少给一张表');

  const files = [];
  const ctSheet = list.map(function (s, i) {
    return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
  }).join('');
  files.push({
    name: '[Content_Types].xml',
    bytes: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      ctSheet + '</Types>')
  });
  files.push({
    name: '_rels/.rels',
    bytes: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>')
  });

  const sheetTags = list.map(function (s, i) {
    return '<sheet name="' + esc(s.name || ('表' + (i + 1))) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
  }).join('');
  files.push({
    name: 'xl/workbook.xml',
    bytes: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + sheetTags + '</sheets></workbook>')
  });

  const rels = list.map(function (s, i) {
    return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
  }).join('');
  files.push({
    name: 'xl/_rels/workbook.xml.rels',
    bytes: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels + '</Relationships>')
  });

  list.forEach(function (s, i) {
    files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', bytes: utf8(sheetXml(s.rows)) });
  });

  return zip(files);
}

/* 按月份汇总：给对账单第二张表用 */
function byMonth(orders) {
  const map = {};
  (orders || []).forEach(function (o) {
    const d = new Date(o.createdAt || 0);
    const key = d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
    if (!map[key]) map[key] = { month: key, orders: 0, amount: 0, refund: 0, net: 0 };
    const m = map[key];
    m.orders += 1;
    m.amount += o.amount || 0;
    m.refund += o.refundedAmount || 0;
    m.net += Math.max(0, (o.amount || 0) - (o.refundedAmount || 0));
  });
  return Object.keys(map).sort().map(function (k) {
    return map[k];
  });
}

module.exports = { buildXlsx: buildXlsx, byMonth: byMonth, crc32: crc32 };

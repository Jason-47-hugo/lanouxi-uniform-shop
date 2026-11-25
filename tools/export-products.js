/* 把 miniprogram/utils/data.js 里的商品导出成云数据库能直接导入的 JSON Lines。
 *
 *   node tools/export-products.js
 *   → cloudfunctions/seed/products.json    一行一个文档，用于「云开发控制台 → 数据库 → 导入」
 *   → cloudfunctions/seed/schools.json     同上，学校名单
 *   → cloudfunctions/api/data/products.json  JSON 数组，云函数 `syncProducts` 读它一键同步
 *
 * 为什么要导：云函数算钱用的是云数据库里的 products，不是小程序里的 data.js。
 * 表里的 price 才是权威价格，改价只改表，不用发版。
 * 改完 data.js 跑一次本脚本 + 在开发者工具里重新部署 api，再调一次
 * `{"action":"syncProducts"}` 就能把新商品推上云（只增改，不删）。
 */
const fs = require('fs');
const path = require('path');

const D = require(path.join(__dirname, '..', 'miniprogram', 'utils', 'data.js'));
const SEED_DIR = path.join(__dirname, '..', 'cloudfunctions', 'seed');
const API_DATA_DIR = path.join(__dirname, '..', 'cloudfunctions', 'api', 'data');

function doc(p) {
  return {
    _id: p.id,
    id: p.id,
    name: p.name,
    short: p.short,
    school: p.school,
    schoolShort: p.schoolShort,
    stage: p.stage,
    category: p.category,
    price: p.price,
    originalPrice: p.originalPrice,
    stock: p.stock,
    sales: p.sales,
    image: p.image,
    tags: p.tags || [],
    colors: p.colors || [],
    sizes: p.sizes || [],
    fabric: p.fabric || '',
    desc: p.desc || '',
    sizeTip: p.sizeTip || '',
    onSale: p.onSale !== false
  };
}

fs.mkdirSync(SEED_DIR, { recursive: true });
fs.mkdirSync(API_DATA_DIR, { recursive: true });

const docs = D.PRODUCTS.map(doc);

fs.writeFileSync(path.join(SEED_DIR, 'products.json'), docs.map(function (d) { return JSON.stringify(d); }).join('\n') + '\n', 'utf8');
fs.writeFileSync(path.join(API_DATA_DIR, 'products.json'), JSON.stringify(docs, null, 2) + '\n', 'utf8');

const schools = D.SCHOOLS.map(function (s) {
  return JSON.stringify({ _id: s.id || s.name, name: s.name, stage: s.stage, short: s.short || s.name });
}).join('\n') + '\n';

fs.writeFileSync(path.join(SEED_DIR, 'schools.json'), schools, 'utf8');

console.log('products:', docs.length, 'schools:', D.SCHOOLS.length);
console.log('written to', SEED_DIR, 'and', API_DATA_DIR);

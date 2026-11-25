/* 云端调用开关 + 薄封装。
 *
 * 设计原则：**云不可用时自动退回本地 store**，这样
 *   - 网页演示版（没有 wx.cloud）照旧双击就能走完整流程
 *   - 没开通云开发的同学拿到代码也能跑
 *   - 云端一旦可调用，就把真数据写进云数据库
 *
 * 用法：
 *   const cloudApi = require '../../utils/cloud'  ← 见下方 api.js（这里不写括号，免得被打包器当代码改）
 *   if (cloudApi.ready()) {
 *     const r = await cloudApi.call('createOrder', { items, delivery, address });
 *     if (!r.ok) { wx.showToast({ title: r.msg }); return; }
 *   } else {
 *     const r = store.createOrder({ ... }); // 本地演示
 *   }
 */

/* 环境 ID：2026-11-22 开通，来自微信开发者工具「云开发」控制台。
 * 留空 = 关闭云端，全部走本地演示（网页版、没开通云的机器都靠这个）。 */
const ENV_ID = 'cloud1-d7gvr1q2x22eb4eb0';

let inited = false;
let usable = false;

function available() {
  return typeof wx !== 'undefined' && !!wx.cloud && !!ENV_ID;
}

function init() {
  if (inited) return usable;
  inited = true;
  if (!available()) {
    usable = false;
    return usable;
  }
  try {
    wx.cloud.init({ env: ENV_ID, traceUser: true });
    usable = true;
  } catch (e) {
    usable = false;
  }
  return usable;
}

function ready() {
  return init();
}

/* 统一返回 { ok, msg?, ... }，网络/部署错误也转成这个形状，页面不用 try/catch */
function call(action, data) {
  if (!ready()) {
    return Promise.resolve({ ok: false, msg: '还没接云端，走本地演示' });
  }
  return new Promise(function (resolve) {
    wx.cloud.callFunction({
      name: 'api',
      data: Object.assign({ action: action }, data || {}),
      success(res) {
        const r = (res && res.result) || {};
        /* 有的 action（products）直接返回数组，这里统一成 { ok, list } */
        if (Array.isArray(r)) {
          resolve({ ok: true, list: r });
          return;
        }
        resolve(r && typeof r.ok === 'boolean' ? r : { ok: false, msg: '云端返回格式不对' });
      },
      fail(err) {
        resolve({ ok: false, msg: '调用云端失败：' + ((err && err.errMsg) || '未知原因') });
      }
    });
  });
}

module.exports = {
  ENV_ID: ENV_ID,
  available: available,
  ready: ready,
  call: call
};

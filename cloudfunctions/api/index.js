/* 云函数入口：api
 *
 * 部署：微信开发者工具里右键 cloudfunctions/api → 「上传并部署：云端安装依赖」。
 * 需要先在控制台建集合：users / products / orders / admins。
 *
 * 定时任务：config.json 里的 timer 触发器每 10 分钟调一次本函数，
 * 事件长这样 { Type: 'Timer', TriggerName: 'cancelExpired' }，
 * 这时没有 openid，按「系统」身份跑 cancelExpired（超时未付自动关单）。
 */

const cloud = require('wx-server-sdk');
const { makeDb } = require('./common/wxdb');
const { handle } = require('./common/handler');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async function (event, context) {
  const isTimer = event && (event.Type === 'Timer' || event.type === 'timer');
  const wxContext = cloud.getWXContext();
  const ctx = {
    db: makeDb(cloud),
    openid: wxContext.OPENID || 'anonymous',
    now: Date.now(),
    isAdmin: false,
    /* 定时任务没有用户身份，只能跑「系统动作」，业务动作仍然要 openid */
    system: isTimer
  };
  const ev = isTimer ? { action: 'cancelExpired' } : event;
  const res = await handle(ev, ctx);
  return res;
};

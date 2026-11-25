/* 云开发数据库的最小适配层。
 * service.js 只认这几个方法，所以换库（或在本地用内存库跑测试）不用改业务代码。
 *
 *   db.get(coll, id)                     -> doc | null
 *   db.find(coll, where, opt)            -> docs[]      opt: {limit, skip, orderBy:{field, dir}}
 *   db.add(coll, doc)                    -> id
 *   db.update(coll, id, patch)
 *   db.remove(coll, id)
 *   db.cas(coll, id, where, patch)       -> bool        条件更新（状态机用）
 *   db.incField(coll, id, field, delta, atLeast) -> bool 原子自增（库存/积分用）
 *
 * 为什么要有 cas / incField：
 * 云函数会被并发调用（家长同时下单、店长连点两下确认收货）。
 * 「读出来 → 改 → 写回去」这种写法在并发下会互相覆盖：
 *  - 库存可能被扣成负数
 *  - 积分可能退两遍
 * 所以状态流转一律用 cas（把当前状态写进条件里，谁先改谁成功），
 * 库存和积分一律用 incField（交给数据库原子加减，不经过 JS 计算）。
 */

function stripId(doc) {
  const out = Object.assign({}, doc || {});
  delete out._id;
  return out;
}

function makeDb(cloud) {
  const db = cloud.database();
  const _ = db.command;

  /* 对象/数组要用 _.set() 整块替换，否则云开发按「合并」处理：
     tracking 原来是 null 时会报 -502001；timeline 数组会丢新增项。 */
  function wrapPatch(patch) {
    const data = stripId(patch);
    Object.keys(data).forEach(function (k) {
      const v = data[k];
      if (v && typeof v === 'object' && !(v instanceof Date)) data[k] = _.set(v);
    });
    return data;
  }

  return {
    async get(coll, id) {
      try {
        const r = await db.collection(coll).doc(String(id)).get();
        return (r && r.data) || null;
      } catch (e) {
        return null; // 文档不存在时 SDK 会抛错，这里当成 null
      }
    },

    async find(coll, where, opt) {
      const o = opt || {};
      /* 支持 { field: { in: [...] } } 这种写法（订单列表按状态筛选要用），
         其它情况就是普通等值条件 */
      const cond = {};
      Object.keys(where || {}).forEach(function (k) {
        const v = where[k];
        if (v && typeof v === 'object' && Array.isArray(v.in)) cond[k] = _.in(v.in);
        else cond[k] = v;
      });
      let q = db.collection(coll).where(cond);
      if (o.orderBy && o.orderBy.field) {
        q = q.orderBy(o.orderBy.field, o.orderBy.dir || 'desc');
      }
      if (o.skip) q = q.skip(o.skip);
      q = q.limit(Math.min(o.limit || 100, 100));
      const r = await q.get();
      return (r && r.data) || [];
    },

    async add(coll, doc) {
      /* _id 只能当文档主键用，不能出现在 data 里，否则云端报
         -501007 invalid parameters「不能更新_id的值」 */
      const data = stripId(doc);
      const id = doc._id;
      if (id) {
        await db.collection(coll).doc(String(id)).set({ data: data });
        return id;
      }
      const r = await db.collection(coll).add({ data: data });
      return r._id;
    },

    async update(coll, id, patch) {
      await db.collection(coll).doc(String(id)).update({ data: wrapPatch(patch) });
    },

    async remove(coll, id) {
      await db.collection(coll).doc(String(id)).remove();
    },

    /* 条件更新：where 里的字段全部匹配才写。返回「有没有真的改到一行」，
       调用方靠这个返回值判断自己有没有抢到这次状态流转。 */
    async cas(coll, id, where, patch) {
      const cond = Object.assign({ _id: String(id) }, where || {});
      const r = await db.collection(coll).where(cond).update({ data: wrapPatch(patch) });
      return !!(r && r.stats && r.stats.updated > 0);
    },

    /* 原子自增：atLeast 给了就先检查「当前值 >= atLeast」，两个条件在同一条
       where 里，数据库一次完成，不存在读到旧值再写的窗口。 */
    async incField(coll, id, field, delta, atLeast) {
      const cond = { _id: String(id) };
      if (typeof atLeast === 'number') cond[field] = _.gte(atLeast);
      const data = {};
      data[field] = _.inc(delta);
      const r = await db.collection(coll).where(cond).update({ data: data });
      return !!(r && r.stats && r.stats.updated > 0);
    }
  };
}

module.exports = { makeDb: makeDb };

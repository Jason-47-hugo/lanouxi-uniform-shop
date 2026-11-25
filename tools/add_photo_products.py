#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 20 张实拍图对应的校服写成商品，插进 miniprogram/utils/data.js。

幂等：文件里已有 `// >>> 实拍款（2026-11-25）` 标记就跳过。
价格：08 二中麒麟断码长裤 38 元是图上写明的真实价；其余是按现有商品价推的建议价，
      店长台改价后以云数据库为准。

用法：python tools/add_photo_products.py
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, 'miniprogram', 'utils', 'data.js')
MARK = '// >>> 实拍款（2026-11-25）'

SIZES = "['150', '155', '160', '165', '170', '175', '180', '185', '190', '195', '200']"

# (学校全称, 简称, 款式, 类目, 价格, 原价, 一句话版型, 面料, 图片编号)
PHOTOS = [
    ('珠海市第二中学', '二中', '高中套装', '夏装', 128, 158, '短袖上衣 + 长裤', '棉涤混纺，夏季薄款', '02'),
    ('珠海市斗门第一中学', '斗一', '高中套装', '夏装', 128, 158, '短袖上衣 + 长裤', '棉涤混纺，夏季薄款', '03'),
    ('华中师范大学（珠海）附属中学', '华师附', '高中套装', '夏装', 138, 168, '短袖上衣（两色可选）+ 长裤', '棉涤混纺，夏季薄款', '04'),
    ('珠海市实验中学', '市实验', '高中套装', '夏装', 138, 168, '拼色短袖上衣 + 长裤', '棉涤混纺，夏季薄款', '05'),
    ('珠海市第一中学平沙校区', '平沙', '短袖上衣', '夏装', 88, 108, '单件短袖上衣', '棉涤混纺，夏季薄款', '06'),
    ('珠海市第一中学鸿鹤校区', '鸿鹤', '套装', '夏装', 128, 158, '短袖上衣 + 长裤', '棉涤混纺，夏季薄款', '07'),
    ('珠海市麒麟中学', '麒麟', '断码长裤（旧款）', '夏装', 38, 38, '单条长裤，旧款面料已停产，断码清仓', '200G 涤盖棉（62% 棉 · 38% 聚酯纤维）', '08'),
    ('北京师范大学（珠海）附属高级中学', '北师附', '套装', '夏装', 138, 168, '酒红短袖上衣 + 长裤', '棉涤混纺，夏季薄款', '09'),
    ('珠海市广东实验中学金湾学校', '省实金湾', '套装', '夏装', 148, 178, '印花短袖上衣 + 运动长裤', '速干棉涤混纺', '10'),
    ('珠海市田家炳中学', '田家炳', '短袖上衣（A/B 款）', '夏装', 88, 108, '单件短袖，蓝白 A 款或白红 B 款', '棉涤混纺，夏季薄款', '11'),
    ('珠海市和风中学', '和风', '高中套装', '夏装', 128, 158, '短袖上衣 + 长裤', '棉涤混纺，夏季薄款', '12'),
    ('珠海市北京师范大学香山中学', '香山', '套装', '夏装', 168, 198, '拼色短袖上衣 + 长裤', '棉涤混纺，夏季薄款', '13'),
    ('珠海市香洲中学', '香洲中学', '短袖上衣', '夏装', 88, 108, '单件短袖上衣，多种面料可选', '棉涤混纺，夏季薄款', '14'),
    ('珠海市香洲中学', '香洲中学', '中裤', '夏装', 58, 78, '单条中裤，多种面料可选', '棉涤混纺', '15'),
    ('珠海市香洲中学', '香洲中学', '裤裙（女）', '夏装', 78, 98, '女生裤裙，版型好不走光', '棉涤混纺', '16'),
    ('珠海市香洲中学', '香洲中学', '春、秋、夏裤', '秋装', 68, 88, '单条长裤，多种面料可选', '棉涤混纺', '17'),
    ('珠海市香洲中学', '香洲中学', '长袖上衣', '秋装', 108, 128, '单件长袖上衣，亲肤透气', '棉涤混纺，秋季款', '18'),
    ('珠海市香洲中学', '香洲中学', '冬装（外套 + 裤）', '冬装', 238, 268, '棒球款加厚外套 + 加绒长裤', '健康棉，加绒保暖', '19'),
    ('珠海市第一中学汇文中学', '一中汇文', '短袖上衣', '夏装', 88, 108, '单件短袖上衣', '棉涤混纺，夏季薄款', '20'),
    ('珠海市第一中学汇文中学', '一中汇文', '长袖上衣', '秋装', 108, 128, '单件长袖上衣', '棉涤混纺，秋季款', '20'),
    ('珠海市第一中学汇文中学', '一中汇文', '薄外套', '秋装', 158, 178, '单件薄外套', '薄款风衣布', '20'),
    ('珠海市第一中学汇文中学', '一中汇文', '厚外套', '冬装', 188, 218, '单件厚外套', '加厚防风面料', '20'),
]

NEW_SCHOOLS = [
    ('s18', '珠海市香洲中学', '香洲中学'),
    ('s19', '珠海市田家炳中学', '田家炳'),
    ('s20', '珠海市和风中学', '和风'),
    ('s21', '珠海市第一中学汇文中学', '一中汇文'),
]


def js_str(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"


def product_js(pid, school, short, kind, cat, price, orig, cut, fabric, img):
    orig = orig if orig else price
    return '\n'.join([
        '  {',
        "    id: '%s'," % pid,
        '    name: %s,' % js_str('%s · %s' % (short, kind)),
        '    short: %s,' % js_str(kind),
        '    school: %s,' % js_str(school),
        '    schoolShort: %s,' % js_str(short),
        "    stage: '高中',",
        '    category: %s,' % js_str(cat),
        '    price: %d,' % price,
        '    originalPrice: %d,' % orig,
        '    points: %d,' % price,
        '    sales: 0,',
        '    stock: 10,',
        "    image: '/images/prod-%s.jpg'," % img,
        "    tags: ['实拍', '新上架'],",
        '    colors: [',
        "      { name: '藏青', value: '#26364A' },",
        "      { name: '米白', value: '#F3EEE2' }",
        '    ],',
        '    sizes: %s,' % SIZES,
        '    fabric: %s,' % js_str(fabric),
        '    desc: %s,' % js_str('%s。%s，到店可试穿。' % (kind, cut)),
        '    sizeTip: %s' % js_str('尺码就是身高：170 码给 168–172cm 的同学穿。'),
        '  }',
    ])


def main():
    with io.open(DATA, encoding='utf-8') as f:
        src = f.read()
    if MARK in src:
        print('already patched, skip')
        return 0

    blocks = [product_js('p%d' % (9 + i), *row) for i, row in enumerate(PHOTOS)]
    # p1（市一中 夏季短袖套装）已经有同名款，直接换成实拍图，不再重复上架
    src = src.replace("image: '/images/p1.png',", "image: '/images/prod-01.jpg',")
    insert = ',\n' + MARK + '\n' + ',\n'.join(blocks) + '\n'

    anchor = re.search(r"\n\];\n\nconst FEATURED_IDS", src)
    if not anchor:
        print('ANCHOR NOT FOUND (PRODUCTS 结尾没匹配上)')
        return 1
    src = src[:anchor.start()] + insert + src[anchor.start():]

    school_lines = ''.join(
        "  { id: '%s', name: '%s', short: '%s', group: '高中', stage: '高中' },\n" % (sid, name, short)
        for sid, name, short in NEW_SCHOOLS)
    pos = src.index("\n];\n\nconst CATEGORIES")
    src = src[:pos] + ',\n' + school_lines.rstrip('\n') + src[pos:]

    with io.open(DATA, 'w', encoding='utf-8', newline='\n') as f:
        f.write(src)
    print('patched: %d products, %d schools' % (len(blocks), len(NEW_SCHOOLS)))
    return 0


if __name__ == '__main__':
    sys.exit(main())

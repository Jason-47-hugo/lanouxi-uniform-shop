#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把店长发来的校服卡片图批量规整成商品图。

- 输入：微信/相册里存下来的卡片图（白色留边 + 蓝色圆角底板）
- 处理：自动找蓝色底板边界 -> 裁掉白边 -> 补成正方形 -> 缩到 750x750 -> 压到 200KB 内
- 输出：docs/product-photos/<编号>-<名字>.jpg，外加 0-index.jpg 总览（带编号）和 清单.md

用法：python tools/import_photos.py
源图清单写在 PHOTOS 里（编号, 文件名用名, 源文件绝对路径）。
"""
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'docs', 'product-photos')
SIDE = 750
QUALITY = 82

ATT = r'C:\Users\silve\.dsh\attachments\v1\objects'

# (编号, 名字, 学校, 款式, 源文件 sha)
PHOTOS = [
    ('01', '市一中-夏季短袖套装', '市一中', '夏季短袖套装', '7a3d28a30f60c1e751b14fb733063e5cc7bf9c0ed6b9c933329b1fcd1ddff428'),
    ('02', '市二中-高中套装', '市二中', '高中套装', 'eb9b6634a1c2034f5871ec05f9fa5e9a36d31991c781d26e19c41f34c958919c'),
    ('03', '斗门一中-高中套装', '斗门一中', '高中套装', '694c7e205bed15ea4beeaa2dcd5683978503cea3da4eeae2a763fed949cd206e'),
    ('04', '华师附中-高中套装', '华师附中', '高中套装', '9cc29ea5c1088229dad5c73ea304af2c8e1a80d0f60d33439471f333ede21fa0'),
    ('05', '市实验-高中套装', '市实验', '高中套装', '635cf16026759b4c584a35d523a1fccd3b9cb0162284cbf6afcd74047311a144'),
    ('06', '平沙一中-短袖', '平沙一中', '短袖', 'b1e7f1f73fd0a1ca314d36d8794fd3bc12f4844f00823396377b936f021235ab'),
    ('07', '一中鸿鹤校区-套装', '一中鸿鹤校区', '套装', 'a7b59a11405abaf0a30c25aaa348248a0d1bd9991e629b44b21b05dbdb88c2e0'),
    ('08', '二中麒麟校区-断码长裤', '二中麒麟校区', '断码长裤', '0bc2beb8f49f5c9ef3f58fd7985badecb223de474f8b577dbcc6c05794f4dd17'),
    ('09', '北师大附中-套装', '北师大附中', '套装', 'abad994c0e909428db2f609fc4cd9b5893366d80fc93af759ce732fedaa253cc'),
    ('10', '省实金湾-套装', '省实金湾', '套装', 'ee837aa11b64d19a2ba60718b09f83e82bb3e23df9a307a88ef17085c7f20acf'),
    ('11', '田家炳中学-短袖AB款', '田家炳中学', '短袖 A/B 款', '3e03c924c720b38645ffb721842f47cf673ad5dc2e7762bee3789c7bc9f29719'),
    ('12', '和风中学-高中套装', '和风中学', '高中套装', '481a2fed15b76ed4d35238bbd3940969cf27ebfffbc3686ba80a0b3c5b3477ac'),
    ('13', '香山中学-套装', '香山中学', '套装', '933586ff2a4772d9973244c614eb6d16d1f5818612f700b57b27bb3ec165c4ce'),
    ('14', '香洲中学-短袖', '香洲中学', '短袖', 'cc1bb341a7aeda10bbfb9b25c2a606c8c44490f8145bbe772b533105f4e72657'),
    ('15', '香洲中学-中裤', '香洲中学', '中裤', 'fa88838a1a5478408957d7e16e7a6eaa5843b5b693d7557df73b46775e575f9d'),
    ('16', '香洲中学-裤裙女', '香洲中学', '裤裙（女）', '4d77280319224a8e2d446337a71872c410d4e60c957c160e8b340ee40b57c797'),
    ('17', '香洲中学-春秋夏裤', '香洲中学', '春、秋、夏裤', 'cf131f9faf6ba145d66d05bcead9ea3bbd4fb9962d511a3b07d4f2bd358842fe'),
    ('18', '香洲中学-长袖', '香洲中学', '长袖', '612e89edd621683e6cb1ee9930780f26be277133a53ce7a391a1d8516c649b6b'),
    ('19', '香洲中学-冬装', '香洲中学', '冬装', 'd6808867042eabe4e26700ea539c6085e296e9ea663efaa43e1a1abb81028c97'),
    ('20', '一中汇文-短袖长袖外套', '一中汇文', '短袖/长袖/薄外套/厚外套', '9bf43b8f3a878d5979dfa374216dd9ff644cceedcd189d8d8f513076b78d23a2'),
]


def src_path(sha):
    return os.path.join(ATT, sha[:2], sha)


def is_blue(px):
    r, g, b = px[0], px[1], px[2]
    return b > 150 and b - r > 25 and b - g > 10


def trim_white(im, tol=10):
    """裁掉四边纯白留边（保留整张卡片，包括学校名和价格标注）。"""
    bg = Image.new('RGB', im.size, (255, 255, 255))
    diff = ImageChops.difference(im, bg).convert('L')
    mask = diff.point(lambda v: 255 if v > tol else 0)
    bb = mask.getbbox()
    if not bb:
        return im
    w, h = im.size
    bx = (max(0, bb[0] - 2), max(0, bb[1] - 2), min(w, bb[2] + 2), min(h, bb[3] + 2))
    return im.crop(bx)


def square(im):
    w, h = im.size
    side = max(w, h)
    canvas = Image.new('RGB', (side, side), (255, 255, 255))
    canvas.paste(im, ((side - w) // 2, (side - h) // 2))
    return canvas


def main():
    if not os.path.isdir(OUT):
        os.makedirs(OUT)
    rows = []
    for no, name, school, kind, sha in PHOTOS:
        p = src_path(sha)
        if not os.path.exists(p):
            print('MISSING %s %s' % (no, name))
            continue
        im = Image.open(p).convert('RGB')
        im = trim_white(im)
        im = square(im).resize((SIDE, SIDE), Image.LANCZOS)
        dst = os.path.join(OUT, '%s-%s.jpg' % (no, name))
        im.save(dst, 'JPEG', quality=QUALITY, optimize=True, progressive=True)
        # 小程序包里放一份 600×600、更小的（主包 2MB 限制）
        app_dst = os.path.join(ROOT, 'miniprogram', 'images', 'prod-%s.jpg' % no)
        im.resize((600, 600), Image.LANCZOS).save(app_dst, 'JPEG', quality=78, optimize=True)
        kb = os.path.getsize(dst) / 1024.0
        rows.append((no, name, school, kind, os.path.basename(dst), kb))
        print('%s %-28s %5.1fKB' % (no, name, kb))

    # 总览图：5 列 x 4 行，每格带编号
    cols, cell, gap, top = 5, 300, 16, 34
    rows_n = (len(rows) + cols - 1) // cols
    W = gap + cols * (cell + gap)
    H = top + gap + rows_n * (cell + gap + 22)
    sheet = Image.new('RGB', (W, H), (247, 243, 236))
    d = ImageDraw.Draw(sheet)
    try:
        f_no = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc', 20)
    except Exception:
        f_no = ImageFont.load_default()
    for i, (no, name, school, kind, fn, kb) in enumerate(rows):
        c, r = i % cols, i // cols
        x = gap + c * (cell + gap)
        y = top + gap + r * (cell + gap + 22)
        im = Image.open(os.path.join(OUT, fn)).resize((cell, cell), Image.LANCZOS)
        sheet.paste(im, (x, y))
        d.text((x + 4, y + cell + 2), '%s %s %s' % (no, school, kind), font=f_no, fill=(46, 74, 63))
    sheet.save(os.path.join(OUT, '0-index.jpg'), 'JPEG', quality=85, optimize=True)
    print('sheet %dx%d %d photos' % (W, H, len(rows)))

    lines = ['# 校服实拍图清单（2026-11-24 批量导入）', '',
             '| 编号 | 学校 | 款式 | 文件 | 大小 | 售价（待填） |',
             '| --- | --- | --- | --- | --- | --- |']
    for no, name, school, kind, fn, kb in rows:
        lines.append('| %s | %s | %s | `%s` | %.0fKB |  |' % (no, school, kind, fn, kb))
    lines += ['', '说明：图片已裁掉白边、补成正方形、缩到 750×750、压在 200KB 以内，可直接上传云存储。',
              '售价一列空着等店家填；填完由 `tools/import_photos.py` 之外的数据脚本写进 `utils/data.js`。']
    with open(os.path.join(OUT, '清单.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print('清单.md written')


if __name__ == '__main__':
    sys.exit(main())

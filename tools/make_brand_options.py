# -*- coding: utf-8 -*-
"""生成 5 版「兰欧茜」品牌图（无水印，PNG，透明或奶油底），供挑选用。

跑法：python tools/make_brand_options.py
产物：docs/brand-options/1..5.png + 0-all.png（拼一张总览）
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'docs', 'brand-options')
os.makedirs(OUT, exist_ok=True)

S = 1600          # 画布边长（画完缩到 800）
GREEN = (46, 74, 63)
CREAM = (248, 241, 229)
INK = (43, 40, 36)
RED = (181, 84, 58)
GOLD = (176, 141, 87)

F_KAI = 'C:/Windows/Fonts/simkai.ttf'
F_SONG = 'C:/Windows/Fonts/simsun.ttc'
F_HEI_B = 'C:/Windows/Fonts/msyhbd.ttc'
F_HEI = 'C:/Windows/Fonts/msyh.ttc'
F_DENG = 'C:/Windows/Fonts/Deng.ttf'


def font(path, size):
    return ImageFont.truetype(path, size)


def text_w(d, txt, f, track=0):
    if not txt:
        return 0
    w = 0
    for ch in txt:
        w += d.textbbox((0, 0), ch, font=f)[2] + track
    return w - track


def draw_tracked(d, xy, txt, f, fill, track=0, anchor_mid=True):
    """带字距的横排文字；anchor_mid=True 时 xy 是整行的水平中心。"""
    x, y = xy
    if anchor_mid:
        x -= text_w(d, txt, f, track) / 2
    for ch in txt:
        d.text((x, y), ch, font=f, fill=fill)
        x += d.textbbox((0, 0), ch, font=f)[2] + track


def base(bg=None):
    img = Image.new('RGBA', (S, S), bg if bg else (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def save(img, name):
    img.resize((800, 800), Image.LANCZOS).save(os.path.join(OUT, name))


# ---------------------------------------------------------------- 1 圆形印章
def opt1():
    img, d = base()
    cx = cy = S // 2
    d.ellipse([60, 60, S - 60, S - 60], outline=RED, width=10)
    d.ellipse([104, 104, S - 104, S - 104], outline=RED, width=5)

    f = font(F_KAI, 300)
    txt = '兰欧茜'
    total = text_w(d, txt, f, track=24)
    x = cx - total / 2
    baseline = cy - 70          # 三字按底边对齐，不再各按 bbox[1]
    for ch in txt:
        bb = d.textbbox((0, 0), ch, font=f)
        d.text((x - bb[0], baseline - bb[3]), ch, font=f, fill=RED)
        x += bb[2] + 24

    fp = font(F_HEI, 62)
    draw_tracked(d, (cx, cy + 150), 'LANOUXI', fp, RED, track=16)
    save(img, '1-seal.png')


# ---------------------------------------------------------------- 2 方形牌匾
def opt2():
    img, d = base(CREAM + (255,))
    d.rectangle([70, 70, S - 70, S - 70], fill=GREEN)
    d.rectangle([104, 104, S - 104, S - 104], outline=(214, 192, 156), width=3)

    f = font(F_KAI, 330)
    txt = '兰欧茜'
    # 竖排：字号缩到 330、步进 330，避免三字上下相压
    y = 250
    for ch in txt:
        bb = d.textbbox((0, 0), ch, font=f)
        w = bb[2] - bb[0]
        d.text(((S - w) / 2 - bb[0], y - bb[1]), ch, font=f, fill=CREAM)
        y += 330

    fs = font(F_DENG, 58)
    draw_tracked(d, (S / 2, 1320), '校服 · 珠海', fs, (214, 192, 156), track=10)
    save(img, '2-plaque.png')


# ---------------------------------------------------------------- 3 字标
def opt3():
    img, d = base(CREAM + (255,))
    f = font(F_SONG, 330)
    bb = d.textbbox((0, 0), '兰欧茜', font=f)
    w = bb[2] - bb[0]
    x = (S - w) / 2 - bb[0]
    d.text((x, 470 - bb[1]), '兰欧茜', font=f, fill=GREEN)

    d.line([S / 2 - 240, 940, S / 2 + 240, 940], fill=GOLD, width=4)
    fp = font(F_HEI, 76)
    draw_tracked(d, (S / 2, 1010), 'LANOUXI UNIFORM', fp, (95, 88, 78), track=12)
    save(img, '3-wordmark.png')


# ---------------------------------------------------------------- 4 单字徽章
def opt4():
    img, d = base()
    cx = cy = S // 2
    d.ellipse([80, 80, S - 80, S - 80], fill=GREEN)
    d.ellipse([140, 140, S - 140, S - 140], outline=GOLD, width=4)

    f = font(F_KAI, 520)
    bb = d.textbbox((0, 0), '兰', font=f)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    d.text((cx - w / 2 - bb[0], cy - h / 2 - bb[1] + 10), '兰', font=f, fill=CREAM)

    fp = font(F_HEI, 62)
    draw_tracked(d, (cx, cy + 330), 'LANOUXI', fp, GOLD, track=18)
    save(img, '4-badge.png')


# ---------------------------------------------------------------- 5 极简
def opt5():
    img, d = base(CREAM + (255,))
    d.rectangle([0, 0, 96, S], fill=RED)
    d.rectangle([96, 0, 124, S], fill=GREEN)

    f = font(F_HEI_B, 300)
    bb = d.textbbox((0, 0), '兰欧茜', font=f)
    w = bb[2] - bb[0]
    d.text((210, 560 - bb[1]), '兰欧茜', font=f, fill=GREEN)

    fp = font(F_DENG, 70)
    draw_tracked(d, (210, 960), 'LANOUXI', fp, (120, 112, 100), track=20, anchor_mid=False)
    fd = font(F_DENG, 44)
    d.text((212, 1090), '珠海校服 · 2026 秋季', font=fd, fill=(150, 141, 128))
    d.line([212, 1220, 212 + w, 1220], fill=GOLD, width=4)
    save(img, '5-minimal.png')


def contact_sheet():
    files = ['1-seal.png', '2-plaque.png', '3-wordmark.png', '4-badge.png', '5-minimal.png']
    cell = 420
    gap = 24
    sheet = Image.new('RGBA', (cell * 5 + gap * 6, cell + gap * 2), CREAM + (255,))
    for i, fn in enumerate(files):
        im = Image.open(os.path.join(OUT, fn)).convert('RGBA').resize((cell, cell), Image.LANCZOS)
        sheet.alpha_composite(im, (gap + i * (cell + gap), gap))
    sheet.convert('RGB').save(os.path.join(OUT, '0-all.png'))



# ------------------------------------------------- 分享卡（微信 5:4，500x400）
def share_cover():
    W, H = 1000, 800
    img = Image.new('RGBA', (W, H), CREAM + (255,))
    d = ImageDraw.Draw(img)
    # 左下角砖红细条 + 右上角淡墨绿圆
    d.rectangle([0, H - 14, W, H], fill=RED)
    d.ellipse([W - 300, -170, W + 120, 250], fill=(236, 229, 214, 255))

    f = font(F_SONG, 250)
    bb = d.textbbox((0, 0), '兰欧茜', font=f)
    w = bb[2] - bb[0]
    d.text(((W - w) / 2 - bb[0], 210 - bb[1]), '兰欧茜', font=f, fill=GREEN)

    d.line([W / 2 - 150, 500, W / 2 + 150, 500], fill=GOLD, width=5)
    fp = font(F_HEI, 58)
    draw_tracked(d, (W / 2, 540), 'LANOUXI UNIFORM', fp, (95, 88, 78), track=10)

    img.resize((500, 400), Image.LANCZOS).convert('RGB').save(
        os.path.join(os.path.dirname(HERE), 'miniprogram', 'images', 'share.png'))

if __name__ == '__main__':
    opt1()
    opt2()
    opt3()
    opt4()
    opt5()
    contact_sheet()
    share_cover()
    for fn in sorted(os.listdir(OUT)):
        print(fn, os.path.getsize(os.path.join(OUT, fn)))

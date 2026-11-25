# -*- coding: utf-8 -*-
"""生成校服小店的插画素材（商品图、首页主视觉、收款码占位、tab 图标、分享图）。"""
import os, math, random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "miniprogram" / "images"
OUT.mkdir(parents=True, exist_ok=True)

SS = 3  # 超采样倍数

CREAM = "#F7F3EC"
INK = "#23201C"
GREEN = "#2E4A3F"
BRICK = "#B65B3C"
GOLD = "#C9A227"
NAVY = "#26364A"

FONT_SERIF = "C:/Windows/Fonts/NotoSerifSC-VF.ttf"
FONT_SANS = "C:/Windows/Fonts/NotoSansSC-VF.ttf"

def hx(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i+2], 16) for i in (0, 2, 4))

def mix(c1, c2, t):
    a, b = hx(c1), hx(c2)
    return tuple(round(a[i] + (b[i]-a[i])*t) for i in range(3))

def shade(c, f=0.86):
    r, g, b = hx(c)
    return (max(0, round(r*f)), max(0, round(g*f)), max(0, round(b*f)))

def tint(c, f=0.5):
    return mix(c, "#FFFFFF", f)

class Pad:
    def __init__(self, w, h, bg=None):
        self.w, self.h = w, h
        col = (0, 0, 0, 0) if bg is None else hx(bg) + (255,)
        self.im = Image.new("RGBA", (w*SS, h*SS), col)
        self.d = ImageDraw.Draw(self.im)

    def _s(self, pts):
        return [(x*SS, y*SS) for x, y in pts]

    def poly(self, pts, fill=None, outline=None, width=2):
        self.d.polygon(self._s(pts), fill=fill,
                       outline=outline, width=max(1, int(width*SS)))

    def line(self, pts, fill, width=3, joint="curve"):
        self.d.line(self._s(pts), fill=fill, width=max(1, int(width*SS)), joint=joint)

    def circle(self, x, y, r, fill=None, outline=None, width=2):
        self.d.ellipse([(x-r)*SS, (y-r)*SS, (x+r)*SS, (y+r)*SS],
                       fill=fill, outline=outline, width=max(1, int(width*SS)))

    def rr(self, box, radius, fill=None, outline=None, width=2):
        x1, y1, x2, y2 = box
        self.d.rounded_rectangle([x1*SS, y1*SS, x2*SS, y2*SS],
                                 radius=radius*SS, fill=fill,
                                 outline=outline, width=max(1, int(width*SS)))

    def finish(self):
        return self.im.resize((self.w, self.h), Image.LANCZOS)

    def paste(self, layer, x, y):
        self.im.alpha_composite(layer, (int(x*SS), int(y*SS)))


def garment(kind, main, trim, accent, dark=None):
    """在 800x800 透明画布上画一件校服。"""
    p = Pad(800, 800)
    dk = dark or shade(main, 0.82)
    outline = shade(main, 0.72)

    def body_base():
        p.poly([(278, 252), (522, 252), (540, 640), (260, 640)], main, outline, 2.5)
        p.poly([(278, 252), (302, 252), (286, 640), (260, 640)], shade(main, 0.93))
        p.poly([(522, 252), (498, 252), (514, 640), (540, 640)], shade(main, 0.93))

    if kind in ("polo", "shirt"):
        long_sleeve = kind == "shirt"
        # 袖子
        if not long_sleeve:
            p.poly([(285, 258), (205, 302), (168, 432), (236, 466), (292, 372)], main, outline, 2.5)
            p.poly([(515, 258), (595, 302), (632, 432), (564, 466), (508, 372)], main, outline, 2.5)
            p.line([(180, 392), (240, 420)], accent, 12)
            p.line([(620, 392), (560, 420)], accent, 12)
        else:
            p.poly([(285, 258), (208, 300), (175, 560), (238, 572), (300, 420)], main, outline, 2.5)
            p.poly([(515, 258), (592, 300), (625, 560), (562, 572), (500, 420)], main, outline, 2.5)
            p.poly([(175, 560), (238, 572), (240, 600), (177, 588)], trim, outline, 2)
            p.poly([(625, 560), (562, 572), (560, 600), (623, 588)], trim, outline, 2)
        body_base()
        # 领口阴影 + 领座 + 领角
        p.d.ellipse([366*SS, 240*SS, 434*SS, 292*SS], fill=shade(main, 0.78))
        p.poly([(350, 244), (450, 244), (446, 276), (400, 296), (354, 276)], trim, shade(trim, 0.8), 2)
        if kind == "shirt":
            p.poly([(352, 272), (400, 306), (370, 420), (330, 296)], trim, shade(trim, 0.8), 2)
            p.poly([(448, 272), (400, 306), (430, 420), (470, 296)], trim, shade(trim, 0.8), 2)
            p.line([(400, 300), (400, 636)], shade(main, 0.86), 3)
            for yy in (344, 386, 428):
                p.circle(400, yy, 5, trim)
        else:
            p.poly([(352, 272), (400, 296), (374, 332), (344, 286)], trim, shade(trim, 0.8), 2)
            p.poly([(448, 272), (400, 296), (426, 332), (456, 286)], trim, shade(trim, 0.8), 2)
            # 门襟
            p.poly([(392, 292), (408, 292), (408, 438), (392, 438)], trim)
            for yy in (324, 364, 404):
                p.circle(400, yy, 4.5, shade(trim, 0.55))
            # 袖口罗纹
            p.line([(168, 432), (236, 466)], trim, 8)
            p.line([(632, 432), (564, 466)], trim, 8)
            p.circle(306, 404, 17, accent)
            p.circle(306, 404, 17, trim, None, 2)
        p.line([(260, 640), (540, 640)], dk, 3)

    elif kind == "pants":
        p.poly([(298, 300), (400, 300), (396, 700), (296, 700)], main, outline, 2.5)
        p.poly([(400, 300), (502, 300), (504, 700), (404, 700)], main, outline, 2.5)
        p.poly([(298, 300), (318, 300), (316, 700), (296, 700)], shade(main, 0.92))
        p.poly([(482, 300), (502, 300), (504, 700), (484, 700)], shade(main, 0.92))
        p.poly([(292, 244), (508, 244), (508, 304), (292, 304)], shade(main, 0.9), outline, 2.5)
        p.line([(292, 276), (508, 276)], dk, 2)
        for x in (322, 400, 478):
            p.line([(x, 244), (x, 268)], dk, 4)
        p.line([(348, 320), (348, 680)], shade(main, 0.88), 2)
        p.line([(452, 320), (452, 680)], shade(main, 0.88), 2)
        p.line([(304, 380), (336, 380)], dk, 3)
        p.line([(464, 380), (496, 380)], dk, 3)

    elif kind == "jacket":
        # 袖子
        p.poly([(290, 262), (205, 310), (180, 590), (242, 602), (300, 430)], main, outline, 2.5)
        p.poly([(510, 262), (595, 310), (620, 590), (558, 602), (500, 430)], main, outline, 2.5)
        body_base()
        p.rr((336, 232, 464, 286), 18, main, outline, 2.5)
        p.line([(336, 258), (464, 258)], shade(main, 0.85), 2)
        p.line([(400, 286), (400, 636)], shade(main, 0.82), 4)
        p.circle(400, 300, 7, trim)
        # 口袋
        p.line([(292, 500), (292, 560), (358, 560)], shade(main, 0.78), 4)
        p.line([(508, 500), (508, 560), (442, 560)], shade(main, 0.78), 4)
        # 下摆与袖口罗纹
        p.poly([(260, 606), (540, 606), (540, 640), (260, 640)], shade(main, 0.9))
        for x in range(272, 540, 18):
            p.line([(x, 610), (x, 636)], shade(main, 0.8), 1)
        for x in range(186, 238, 12):
            p.line([(x, 590), (x, 600)], shade(main, 0.8), 1)
        p.line([(300, 370), (500, 370)], trim, 14)
        p.line([(300, 370), (500, 370)], accent, 4)

    elif kind == "dress":
        # 裙摆
        p.poly([(310, 400), (490, 400), (572, 706), (228, 706)], main, outline, 2.5)
        for x in (300, 345, 390, 435, 480):
            p.line([(x, 410), (x + (x-400)*0.5, 696)], shade(main, 0.88), 2)
        p.line([(228, 706), (572, 706)], dk, 3)
        # 上身
        p.poly([(322, 250), (478, 250), (492, 418), (308, 418)], main, outline, 2.5)
        p.poly([(322, 250), (342, 250), (330, 418), (308, 418)], shade(main, 0.93))
        # 短袖
        p.poly([(326, 256), (262, 300), (286, 370), (332, 340)], main, outline, 2.5)
        p.poly([(474, 256), (538, 300), (514, 370), (468, 340)], main, outline, 2.5)
        # 领子
        p.poly([(356, 246), (444, 246), (444, 280), (356, 280)], trim, shade(trim, 0.8), 2)
        p.poly([(356, 280), (338, 340), (392, 294)], trim, shade(trim, 0.8), 2)
        p.poly([(444, 280), (462, 340), (408, 294)], trim, shade(trim, 0.8), 2)
        # 腰带与蝴蝶结
        p.poly([(308, 404), (492, 404), (492, 440), (308, 440)], accent)
        p.poly([(400, 420), (368, 396), (368, 444)], accent, shade(accent, 0.8), 2)
        p.poly([(400, 420), (432, 396), (432, 444)], accent, shade(accent, 0.8), 2)
        p.circle(400, 420, 7, shade(accent, 0.85))

    elif kind == "blazer":
        p.poly([(288, 262), (210, 312), (186, 600), (246, 612), (300, 440)], main, outline, 2.5)
        p.poly([(512, 262), (590, 312), (614, 600), (554, 612), (500, 440)], main, outline, 2.5)
        body_base()
        # 衬衫 V 领 + 领带
        p.poly([(400, 286), (458, 362), (400, 486), (342, 362)], "#F8F3E8", shade(trim, 0.82), 2)
        p.poly([(400, 356), (414, 356), (408, 470), (400, 492), (392, 470)], accent, shade(accent, 0.78), 1.5)
        # 翻领
        lap = mix(main, "#FFFFFF", 0.10)
        p.poly([(348, 250), (400, 356), (308, 468), (280, 300)], lap, shade(main, 0.7), 2)
        p.poly([(452, 250), (400, 356), (492, 468), (520, 300)], lap, shade(main, 0.7), 2)
        p.circle(406, 486, 7, GOLD)
        p.circle(406, 530, 7, GOLD)
        p.line([(300, 520), (360, 520)], shade(main, 0.8), 4)
        p.line([(500, 520), (440, 520)], shade(main, 0.8), 4)
        p.line([(260, 640), (540, 640)], dk, 3)

    elif kind == "coat":
        # 帽子（圆拱，被身体压住下缘）
        p.d.ellipse([312*SS, 168*SS, 488*SS, 356*SS], fill=shade(main, 0.9), outline=outline, width=int(3*SS))
        p.d.ellipse([344*SS, 206*SS, 456*SS, 350*SS], fill=shade(main, 0.74))
        # 袖子
        p.poly([(286, 270), (200, 322), (178, 620), (244, 632), (300, 450)], main, outline, 2.5)
        p.poly([(514, 270), (600, 322), (622, 620), (556, 632), (500, 450)], main, outline, 2.5)
        body_base()
        p.rr((344, 236, 456, 292), 16, shade(main, 0.92), outline, 2.5)
        p.line([(400, 292), (400, 636)], shade(main, 0.78), 4)
        p.circle(400, 320, 7, trim)
        # 大口袋
        p.poly([(284, 500), (356, 500), (350, 580), (290, 580)], shade(main, 0.93), outline, 2)
        p.poly([(516, 500), (444, 500), (450, 580), (510, 580)], shade(main, 0.93), outline, 2)
        p.line([(290, 540), (352, 540)], accent, 5)
        p.line([(510, 540), (448, 540)], accent, 5)
        p.line([(260, 640), (540, 640)], dk, 3)
        for x in range(186, 238, 12):
            p.line([(x, 620), (x, 630)], shade(main, 0.8), 1)

    elif kind == "tie":
        p.poly([(372, 210), (428, 210), (438, 262), (362, 262)], main, shade(main, 0.78), 2)
        p.poly([(362, 262), (438, 262), (418, 610), (400, 656), (382, 610)], main, shade(main, 0.78), 2)
        # 斜纹
        for i, yy in enumerate((330, 400, 470)):
            w = 38 - i*2
            p.poly([(400-w, yy), (400+w, yy), (400+w-6, yy+28), (400-w-6, yy+28)], trim)
        p.circle(400, 268, 10, trim)

    elif kind == "shorts":
        p.poly([(286, 336), (400, 336), (398, 618), (292, 618)], main, outline, 2.5)
        p.poly([(400, 336), (514, 336), (508, 618), (402, 618)], main, outline, 2.5)
        p.poly([(286, 336), (310, 336), (314, 618), (292, 618)], shade(main, 0.92))
        p.poly([(490, 336), (514, 336), (508, 618), (486, 618)], shade(main, 0.92))
        p.poly([(278, 258), (522, 258), (522, 342), (278, 342)], shade(main, 0.9), outline, 2.5)
        p.line([(278, 300), (522, 300)], dk, 2)
        p.line([(296, 336), (296, 614)], accent, 10)
        p.line([(504, 336), (504, 614)], accent, 10)
        p.line([(294, 594), (398, 594)], dk, 3)
        p.line([(402, 594), (506, 594)], dk, 3)
        p.line([(362, 300), (362, 360)], trim, 4)
        p.line([(438, 300), (438, 360)], trim, 4)

    return p.finish()


def gradient_bg(w, h, c1, c2, vertical=True):
    a, b = hx(c1), hx(c2)
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    n = h if vertical else w
    for i in range(n):
        t = i / max(1, n-1)
        col = tuple(round(a[k] + (b[k]-a[k])*t) for k in range(3))
        if vertical:
            d.line([(0, i), (w, i)], fill=col)
        else:
            d.line([(i, 0), (i, h)], fill=col)
    return im.convert("RGBA")


def make_product(name, kind, main, trim, accent, bg1, bg2, arch):
    W = H = 800
    bg = gradient_bg(W, H, bg1, bg2)
    p = Pad(W, H)
    p.im.alpha_composite(bg.resize((W*SS, H*SS), Image.LANCZOS))
    p.d = ImageDraw.Draw(p.im)
    # 背景拱形
    p.rr([150, 90, 650, 780], 250, arch)
    # 细线装饰
    p.line([(150, 690), (650, 690)], mix(arch, "#FFFFFF", 0.35), 1)
    p.circle(665, 140, 7, accent)
    p.circle(690, 140, 4, accent)
    # 投影
    shadow = Image.new("RGBA", (420*SS, 60*SS), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.ellipse([0, 0, 420*SS, 60*SS], fill=(60, 45, 30, 26))
    shadow = shadow.filter(ImageFilter.GaussianBlur(10*SS))
    p.im.alpha_composite(shadow, (190*SS, 700*SS))
    g = garment(kind, main, trim, accent)
    g = g.resize((660*SS, 660*SS), Image.LANCZOS)
    p.im.alpha_composite(g, (70*SS, 140*SS))
    out = p.finish().convert("RGB")
    out.save(OUT / f"{name}.png", quality=92)
    return out


def make_hero():
    W, H = 1200, 800
    im = gradient_bg(W, H, "#F8F2E7", "#EFE2CE")
    p = Pad(W, H)
    p.im.alpha_composite(im.resize((W*SS, H*SS), Image.LANCZOS))
    p.d = ImageDraw.Draw(p.im)
    # 右侧大拱
    p.rr([620, 40, 1320, 880], 380, "#E9D8BE")
    p.rr([620, 40, 1320, 880], 380, None, mix("#E9D8BE", "#B65B3C", 0.12), 2)
    # 顶栏细线
    p.line([(60, 92), (1140, 92)], mix("#B65B3C", "#F8F2E7", 0.55), 1)
    # 挂杆
    p.line([(700, 210), (1250, 210)], "#B99C74", 5)
    p.line([(700, 210), (700, 236)], "#B99C74", 5)
    # 点阵
    for r in range(4):
        for c in range(6):
            p.circle(760 + c*26, 640 + r*26, 2.4, mix("#B65B3C", "#F8F2E7", 0.45))
    # 挂衣
    specs = [
        ("polo", "#26364A", "#F3EEE2", "#B65B3C", 700, 236, 315, -4),
        ("dress", "#B65B3C", "#F6EEDF", "#26364A", 930, 240, 320, 3),
    ]
    for kind, m, t, a, x, y, size, ang in specs:
        g = garment(kind, m, t, a).resize((size*SS, size*SS), Image.LANCZOS)
        g = g.rotate(ang, expand=True, resample=Image.BICUBIC)
        # 衣架
        hx0 = x + size//2
        p.line([(hx0, 214), (hx0, y-6)], "#8F7654", 3)
        p.line([(hx0, y-6), (hx0-52, y+64), (hx0+52, y+64), (hx0, y-6)], "#8F7654", 4)
        p.im.alpha_composite(g, (int(x*SS - (g.width - size*SS)/2), int(y*SS - (g.height - size*SS)/2)))
    # 叶片
    p.line([(840, 792), (920, 734), (1010, 706)], "#7E8B6A", 3)
    for i, (lx, ly, rr_) in enumerate([(870, 760, 20), (905, 738, 18), (945, 720, 16), (985, 708, 12)]):
        p.d.ellipse([(lx-rr_)*SS, (ly-rr_*0.55)*SS, (lx+rr_)*SS, (ly+rr_*0.55)*SS],
                    fill="#8C9A78")
    # 印章
    stamp = Pad(240, 240)
    sd = stamp.d
    sd.ellipse([12*SS, 12*SS, 228*SS, 228*SS], outline=hx(BRICK)+(255,), width=4*SS)
    sd.ellipse([26*SS, 26*SS, 214*SS, 214*SS], outline=hx(BRICK)+(255,), width=2*SS)
    try:
        f = ImageFont.truetype(FONT_SERIF, 64*SS)
    except Exception:
        f = ImageFont.load_default()
    txt = "兰欧茜"
    # 三个字在圆形印章里放不下 64px，按内圈宽度缩到能塞进 168px
    fsz = 60*SS
    while fsz > 20 and sd.textbbox((0, 0), txt, font=ImageFont.truetype(FONT_SERIF, fsz))[2] > 146*SS:
        fsz -= 4
    f = ImageFont.truetype(FONT_SERIF, fsz)
    bb = sd.textbbox((0, 0), txt, font=f)
    sd.text(((240*SS-(bb[2]-bb[0]))//2 - bb[0], (240*SS-(bb[3]-bb[1]))//2 - 8*SS - bb[1]), txt, font=f, fill=hx(BRICK)+(255,))
    stamp = stamp.finish().resize((190*SS, 190*SS), Image.LANCZOS).rotate(-8, expand=True, resample=Image.BICUBIC)
    p.im.alpha_composite(stamp, (930*SS, 505*SS))
    # 左下角小字标（无文字，留白给 WXML 文案）
    p.line([(70, 700), (150, 700)], mix("#2E4A3F", "#F8F2E7", 0.4), 2)
    out = p.finish().convert("RGB")
    out.save(OUT / "hero.png", quality=94)


def make_qr():
    random.seed(7)
    W = 600
    p = Pad(W, W, "#FFFFFF")
    n = 25
    m = 18
    ox = oy = (600 - n*m)//2
    cells = [[random.random() < 0.45 for _ in range(n)] for _ in range(n)]
    # 定位角
    def finder(cx, cy):
        for y in range(7):
            for x in range(7):
                edge = x in (0, 6) or y in (0, 6)
                core = 2 <= x <= 4 and 2 <= y <= 4
                if edge or core:
                    cells[cy+y][cx+x] = True
                else:
                    cells[cy+y][cx+x] = False
    finder(0, 0); finder(n-7, 0); finder(0, n-7)
    # 清空中间放印章
    for y in range(10, 15):
        for x in range(10, 15):
            cells[y][x] = False
    for y in range(n):
        for x in range(n):
            if cells[y][x]:
                p.rr([ox+x*m, oy+y*m, ox+x*m+m-2, oy+y*m+m-2], 2, "#1E1C19")
    p.circle(300, 300, 46, "#FFFFFF")
    p.circle(300, 300, 46, None, BRICK, 3)
    try:
        f = ImageFont.truetype(FONT_SERIF, 40*SS)
    except Exception:
        f = ImageFont.load_default()
    bb = p.d.textbbox((0, 0), "兰", font=f)
    p.d.text((300*SS-(bb[2]-bb[0])//2, 300*SS-(bb[3]-bb[1])//2 - 6*SS), "兰", font=f, fill=hx(BRICK)+(255,))
    out = p.finish().convert("RGB")
    out.save(OUT / "qr-demo.png", quality=95)


def make_icons():
    def icon(name, color):
        p = Pad(81, 81, None)
        c = hx(color) + (255,)
        w = 5
        if name == "home":
            p.line([(16, 40), (40.5, 17), (65, 40)], c, w)
            p.line([(23, 36), (23, 64), (58, 64), (58, 36)], c, w)
            p.line([(35, 64), (35, 47), (46, 47), (46, 64)], c, 4)
        elif name == "category":
            for x, y in ((17, 17), (44, 17), (17, 44), (44, 44)):
                p.rr([x, y, x+20, y+20], 5, None, c, 4)
        elif name == "cart":
            p.line([(12, 20), (22, 20), (30, 56), (63, 56), (68, 32), (25, 32)], c, w)
            p.circle(33, 66, 4.5, c)
            p.circle(59, 66, 4.5, c)
        elif name == "user":
            p.circle(40.5, 30, 11, None, c, w)
            p.d.arc([20*SS, 45*SS, 61*SS, 78*SS], 200, 340, fill=c, width=int(w*SS))
        return p.finish()
    for name in ("home", "category", "cart", "user"):
        icon(name, "#9C9488").save(OUT / f"tab-{name}.png")
        icon(name, "#2E4A3F").save(OUT / f"tab-{name}-on.png")


def make_logo():
    p = Pad(400, 400, "#2E4A3F")
    p.rr([60, 60, 340, 340], 60, None, "#EFE3D0", 3)
    try:
        f = ImageFont.truetype(FONT_SERIF, 150*SS)
    except Exception:
        f = ImageFont.load_default()
    bb = p.d.textbbox((0, 0), "嘉", font=f)
    p.d.text(((400*SS-(bb[2]-bb[0]))//2, (400*SS-(bb[3]-bb[1]))//2 - 20*SS), "嘉", font=f, fill=hx("#EFE3D0")+(255,))
    p.finish().convert("RGB").save(ROOT / "miniprogram" / "logo.png", quality=95)


if __name__ == "__main__":
    make_hero()
    products = [
        ("p1", "polo", "#F8F5EC", "#26364A", "#B65B3C", "#EFE7D9", "#F8F2E8", "#E7DAC5"),
        ("p2", "jacket", "#26364A", "#F3EEE2", "#B65B3C", "#EDE7DD", "#F7F1E6", "#E3D6C1"),
        ("p3", "dress", "#A9C3D6", "#FFFFFF", "#26364A", "#E9EEF0", "#F6F2EA", "#DFE7E6"),
        ("p4", "shirt", "#FBF8F1", "#DCD5C6", "#26364A", "#F0E9DC", "#FAF5EB", "#E6DAC7"),
        ("p5", "blazer", "#2B3B52", "#EFE7D8", "#8E3F28", "#ECE6DC", "#F7F1E6", "#E2D5C0"),
        ("p6", "tie", "#B65B3C", "#F4ECDD", "#8E3F28", "#F1E8DC", "#FAF4EA", "#E8DAC6"),
        ("p7", "shorts", "#26364A", "#F3EEE2", "#B65B3C", "#EAEDE8", "#F7F3EA", "#DCE2D9"),
        ("p8", "coat", "#33465C", "#E8DFCE", "#B65B3C", "#E9E7E0", "#F6F2E9", "#DFD8CB"),
    ]
    for spec in products:
        make_product(*spec)
    make_qr()
    make_icons()
    make_logo()

    # 审阅用拼图
    sheet = Image.new("RGB", (1600, 1300), "#F7F3EC")
    for i, (name, *_ ) in enumerate(products):
        im = Image.open(OUT / f"{name}.png").resize((380, 380), Image.LANCZOS)
        sheet.paste(im, (20 + (i % 4)*395, 20 + (i // 4)*385))
    hero = Image.open(OUT / "hero.png").resize((780, 520), Image.LANCZOS)
    sheet.paste(hero, (20, 800))
    qr = Image.open(OUT / "qr-demo.png").resize((300, 300), Image.LANCZOS)
    sheet.paste(qr, (830, 880))
    icons = [Image.open(OUT / f"tab-{n}.png") for n in ("home", "category", "cart", "user")]
    for i, ic in enumerate(icons):
        sheet.paste(ic.resize((90, 90), Image.LANCZOS), (1180, 880 + i*100), ic.resize((90, 90), Image.LANCZOS))
    sheet.save(ROOT / "docs" / "art-review.png")
    print("done", OUT)


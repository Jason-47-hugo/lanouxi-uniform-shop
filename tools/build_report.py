# -*- coding: utf-8 -*-
"""生成课程项目报告（中文）docx。

用法：
    python tools/build_report.py

产物：submission/兰欧茜校服-项目报告.docx（再交给 office_convert 转 PDF）
所有数字都来自仓库里的实际命令输出，改事实前先跑命令。
"""
import os
import sys

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'submission')
OUT = os.path.join(OUT_DIR, '兰欧茜校服-项目报告.docx')

BODY_FONT = '宋体'
HEAD_FONT = '黑体'
ASCII_FONT = 'Times New Roman'
INK = RGBColor(0x26, 0x22, 0x1D)
GREEN = RGBColor(0x2E, 0x4A, 0x3F)


def set_run_font(run, font=BODY_FONT, size=10.5, bold=False, color=None, ascii_font=ASCII_FONT):
    run.font.name = ascii_font
    run.font.size = Pt(size)
    run.bold = bold
    if color is not None:
        run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn('w:rFonts'))
    if rfonts is None:
        rfonts = OxmlElement('w:rFonts')
        rpr.append(rfonts)
    rfonts.set(qn('w:eastAsia'), font)
    rfonts.set(qn('w:ascii'), ascii_font)
    rfonts.set(qn('w:hAnsi'), ascii_font)


def style_document(doc):
    normal = doc.styles['Normal']
    normal.font.name = ASCII_FONT
    normal.font.size = Pt(10.5)
    normal.element.rPr.rFonts.set(qn('w:eastAsia'), BODY_FONT)
    pf = normal.paragraph_format
    pf.space_before = Pt(0)
    pf.space_after = Pt(6)
    pf.line_spacing = 1.4

    for name, size in (('Heading 1', 15), ('Heading 2', 12.5)):
        st = doc.styles[name]
        st.font.name = ASCII_FONT
        st.font.size = Pt(size)
        st.font.bold = True
        st.font.color.rgb = GREEN
        rpr = st.element.get_or_add_rPr()
        rfonts = rpr.find(qn('w:rFonts'))
        if rfonts is None:
            rfonts = OxmlElement('w:rFonts')
            rpr.append(rfonts)
        rfonts.set(qn('w:eastAsia'), HEAD_FONT)
        rfonts.set(qn('w:ascii'), ASCII_FONT)
        rfonts.set(qn('w:hAnsi'), ASCII_FONT)
        st.paragraph_format.space_before = Pt(14 if size > 13 else 10)
        st.paragraph_format.space_after = Pt(6)
        st.paragraph_format.keep_with_next = True


def add_page_number_footer(doc):
    footer = doc.sections[0].footer
    para = footer.paragraphs[0]
    para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = para.add_run()
    set_run_font(run, size=9, color=RGBColor(0x6F, 0x67, 0x5B))
    fld_begin = OxmlElement('w:fldChar')
    fld_begin.set(qn('w:fldCharType'), 'begin')
    instr = OxmlElement('w:instrText')
    instr.set(qn('xml:space'), 'preserve')
    instr.text = ' PAGE '
    fld_end = OxmlElement('w:fldChar')
    fld_end.set(qn('w:fldCharType'), 'end')
    run._r.append(fld_begin)
    run._r.append(instr)
    run._r.append(fld_end)


def h(doc, text, level=1):
    para = doc.add_heading(level=level)
    run = para.add_run(text)
    set_run_font(run, font=HEAD_FONT, size=15 if level == 1 else 12.5, bold=True, color=GREEN)
    return para


def p(doc, text, size=10.5, bold=False, before=0, after=6, indent=0.0, color=INK, align=None):
    para = doc.add_paragraph()
    para.paragraph_format.space_before = Pt(before)
    para.paragraph_format.space_after = Pt(after)
    if indent:
        para.paragraph_format.left_indent = Cm(indent)
    if align is not None:
        para.alignment = align
    run = para.add_run(text)
    set_run_font(run, size=size, bold=bold, color=color)
    return para


def bullet(doc, text, lead=None):
    para = doc.add_paragraph(style='List Bullet')
    para.paragraph_format.space_after = Pt(3)
    if lead:
        r1 = para.add_run(lead)
        set_run_font(r1, bold=True, color=INK)
    r2 = para.add_run(text)
    set_run_font(r2, color=INK)
    return para


_NUM = {'n': 0}


def reset_numbering():
    """每个编号列表前调用一次：手写序号，避免 Word 自动编号跨列表续号。"""
    _NUM['n'] = 0


def numbered(doc, text, lead=None, num=None):
    _NUM['n'] += 1
    para = doc.add_paragraph()
    para.paragraph_format.space_after = Pt(3)
    para.paragraph_format.left_indent = Cm(0.75)
    para.paragraph_format.first_line_indent = Cm(-0.75)
    r0 = para.add_run(str(num if num is not None else _NUM['n']) + '. ')
    set_run_font(r0, bold=True, color=GREEN)
    if lead:
        r1 = para.add_run(lead)
        set_run_font(r1, bold=True, color=INK)
    r2 = para.add_run(text)
    set_run_font(r2, color=INK)
    return para


def num_list(doc, items):
    for i, item in enumerate(items, 1):
        lead, text = item if isinstance(item, (tuple, list)) else (None, item)
        numbered(doc, text, lead=lead, num=i)


def shade(cell, hex_color):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_color)
    tc_pr.append(shd)


def fix_table_layout(tbl, widths):
    """固定列宽（Word/WPS/LibreOffice 都按 tblGrid 来），并让表头跨页重复。"""
    tbl.autofit = False
    tbl_pr = tbl._tbl.tblPr
    layout = OxmlElement('w:tblLayout')
    layout.set(qn('w:type'), 'fixed')
    tbl_pr.append(layout)
    grid = tbl._tbl.find(qn('w:tblGrid'))
    if grid is not None:
        for gc, width in zip(grid.findall(qn('w:gridCol')), widths):
            gc.set(qn('w:w'), str(int(Cm(width).twips)))
    for row in tbl.rows:
        for i, width in enumerate(widths):
            row.cells[i].width = Cm(width)
        tr_pr = row._tr.get_or_add_trPr()
        cant = OxmlElement('w:cantSplit')
        tr_pr.append(cant)
    tr_pr = tbl.rows[0]._tr.get_or_add_trPr()
    header = OxmlElement('w:tblHeader')
    header.set(qn('w:val'), 'true')
    tr_pr.append(header)


def table(doc, headers, rows, widths, font_size=9, header_fill='F2EADC'):
    tbl = doc.add_table(rows=1, cols=len(headers))
    tbl.style = 'Table Grid'
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl.autofit = False
    hdr = tbl.rows[0].cells
    for i, text in enumerate(headers):
        hdr[i].text = ''
        para = hdr[i].paragraphs[0]
        run = para.add_run(text)
        set_run_font(run, size=font_size, bold=True, color=GREEN)
        shade(hdr[i], header_fill)
    for row in rows:
        cells = tbl.add_row().cells
        for i, text in enumerate(row):
            cells[i].text = ''
            para = cells[i].paragraphs[0]
            para.paragraph_format.space_after = Pt(2)
            run = para.add_run(text)
            set_run_font(run, size=font_size, color=INK)
    fix_table_layout(tbl, widths)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return tbl


def image(doc, rel_path, width_cm, caption):
    path = os.path.join(ROOT, rel_path)
    if not os.path.exists(path):
        raise SystemExit('缺少图片：' + path)
    para = doc.add_paragraph()
    para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    para.paragraph_format.space_before = Pt(6)
    para.paragraph_format.space_after = Pt(2)
    para.add_run().add_picture(path, width=Cm(width_cm))
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.paragraph_format.space_after = Pt(10)
    run = cap.add_run(caption)
    set_run_font(run, size=9, color=RGBColor(0x6F, 0x67, 0x5B))


def image_row(doc, items, caption, width_cm=7.0):
    """两张图并排，items = [(rel_path, 子标题), ...]"""
    tbl = doc.add_table(rows=1, cols=len(items))
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl.autofit = False
    for i, (rel_path, label) in enumerate(items):
        cell = tbl.rows[0].cells[i]
        cell.width = Cm(width_cm + 1)
        para = cell.paragraphs[0]
        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        para.add_run().add_picture(os.path.join(ROOT, rel_path), width=Cm(width_cm))
        lab = cell.add_paragraph()
        lab.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = lab.add_run(label)
        set_run_font(run, size=9, color=RGBColor(0x6F, 0x67, 0x5B))
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.paragraph_format.space_after = Pt(10)
    run = cap.add_run(caption)
    set_run_font(run, size=9, color=RGBColor(0x6F, 0x67, 0x5B))


def build():
    os.makedirs(OUT_DIR, exist_ok=True)
    doc = Document()
    style_document(doc)
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.top_margin = Cm(2.2)
    sec.bottom_margin = Cm(2.2)
    sec.left_margin = Cm(2.4)
    sec.right_margin = Cm(2.4)
    add_page_number_footer(doc)

    # 标题区
    title = doc.add_paragraph()
    title.paragraph_format.space_before = Pt(18)
    title.paragraph_format.space_after = Pt(2)
    run = title.add_run('兰欧茜校服 · 校服小店微信小程序')
    set_run_font(run, font=HEAD_FONT, size=22, bold=True, color=GREEN)

    sub = doc.add_paragraph()
    sub.paragraph_format.space_after = Pt(14)
    run = sub.add_run('课程项目报告 ｜ 版本 v1.3 ｜ 2026-11-25 ｜ Yuan Peisong')
    set_run_font(run, size=10.5, color=RGBColor(0x6F, 0x67, 0x5B))

    p(doc, '给家里校服店做的小程序：家长看款式、选尺码、下单、付款；店长在手机上接单、发货、处理退货。'
           '下面五节对应作业要求的 a–e，所有数字都是仓库里实际跑出来的结果，不是估算。',
      after=10)

    # 访问信息
    h(doc, '项目访问信息', level=2)
    table(doc,
          ['项目', '内容'],
          [['网页演示版', '双击 web/index.html，浏览器里可走完整流程（首页 → 详情选码 → 购物车 → 结算 → 支付 → 我的订单），无需安装任何环境'],
           ['小程序版', '微信开发者工具「导入项目」选 uniform-shop/ 这一层（project.config.json 已指向 miniprogram/，AppID 已填 wx37e1073cc15df404），云开发环境 cloud1-d7gvr1q2x22eb4eb0'],
           ['店长端', '小程序内「我的 → 店长入口」，按 admins 集合里的 openid 判定身份；网页版无云，用口令 2468。可看订单、搜索、批量发货、补单号、导出对账单、改商品价格/库存/上架'],
           ['数据', '云数据库四集合（users / products / orders / admins）；连不上云时自动退回本机 wx.storage，网页版是 localStorage'],
           ['代码仓库', 'GitHub 是否公开待定（涉及真实电话/地址），见第 f 节']],
          [3.0, 13.0])

    # a)
    h(doc, 'a) 项目背景与动机')
    p(doc, '家里在珠海经营校服生意，卖的是本地多所中小学的校服款式，日常靠线下门店加微信私聊。'
           '开学前后，家长的提问高度集中在四件事：有没有我们家学校的款、多少钱、我家孩子穿多大、什么时候能到。'
           '店里忙的时候消息容易漏回，一个家长来回问三轮才下单是常态；店长一个人既要看店又要回消息，订单靠纸上记。')
    p(doc, '为什么选这个题：', bold=True, before=6, after=3)
    bullet(doc, '店长是家人，第一批用户当天就能触达，需求不是编出来的。', lead='真实：')
    bullet(doc, '逛 → 选码 → 下单 → 付款 → 发货 → 收货 → 退货 → 积分是一条能跑完的闭环，'
                '既能让家里人真的点一遍，也能用脚本逐条断言。', lead='可验证：')
    bullet(doc, '30 款商品、21 所学校入口、12 个页面，一个人维护得动，一个学期能做完并留下证据。', lead='做得完：')
    bullet(doc, '不接第三方商城 SaaS，不做拼团、直播、多店加盟——范围写清楚，才谈得上"完成"。', lead='边界清楚：')
    p(doc, '目标用户：', bold=True, before=6, after=3)
    bullet(doc, '珠海本地中小学家长（30–45 岁），全程在微信里操作，耐心有限，'
                '最关心"是不是我校服、多少钱、多久到、尺码对不对"。', lead='主用户：')
    bullet(doc, '店长（一个人），需要极简的订单列表：谁下的、付没付、发什么快递、单号多少、要退哪件。', lead='次用户：')
    p(doc, '本期核心功能：', bold=True, before=6, after=3)
    num_list(doc, [
        ('逛：', '按学校 / 学段 / 品类筛选；首页只做分流，不铺货。'),
        ('选码：', '详情页有尺码对照表；v0.6 起可以填身高体重直接算一码。'),
        ('下单：', '购物车、快递或到店自提、收货信息、备注；快递 ¥8，满 ¥50 包邮，自提 0 元；收货地址存地址簿（最多 10 条，可一键拉微信地址）。'),
        ('付款：', '微信支付，钱直接进店长绑定的银行卡，不走收款码（演示版模拟成功，不真扣钱）。'),
        ('积分：', '新客 500 分，100 分抵 ¥1，每单最多抵 5%，确认收货按实付返 1 元 = 1 分，满 ¥1200 会员 96 折；下单 30 分钟不付款自动关单，积分和库存自动退回。'),
        ('售后：', '7 天无理由退货；退款按实付比例算，抵扣的积分按比例退回，已返积分按留下的金额重算。'),
        ('店长端：', '看订单、订单搜索、批量发货、补运单号、导出对账单 CSV、处理退货、改商品价格/库存/上下架，库存 ≤5 自动标红提醒补货。'),
    ])
    p(doc, '不做什么（本期）：不做签到、不做保证金、不做拼团与直播、不做多店加盟、不做复杂客服仲裁。', before=4)

    # b)
    h(doc, 'b) 开发历史')
    p(doc, '每一版的"自测 N 项"都是 node preview/flow-test.js 的实际输出；截图为当版实际渲染的画面'
           '（开发机没有微信开发者工具，界面由自建渲染器出图，原因见 d 第 6 条）。')
    table(doc,
          ['版本', '日期', '这一步做了什么', '证据'],
          [['v0.1', '2026-11-12', '需求拆解 + 设计系统（奶油纸底 / 墨绿 / 砖红 / 宋体标题）+ 8 件商品的矢量占位图 + 11 个页面骨架', 'docs/art-review.png'],
           ['v0.2', '2026-11-12', '11 个页面全部完成（首页/分类/详情/购物车/结算/支付/订单列表/订单详情/我的/积分/店长端）；本地数据层 + 订单状态机；自测 29 项；自建 WXML→HTML 预览器', 'docs/preview-1.png、preview-2.png'],
           ['v0.3', '2026-11-16', '按店家确认的规则重写：店名「兰欧茜」、17 个学校入口、满 ¥50 包邮、积分 5% 抵现 + 新客 500 分 + 会员 96 折、取消保证金；网页演示版可点；自测 33 项', 'docs/web-preview.png'],
           ['v0.4', '2026-11-17', '六条新规则落地（删签到、支付改微信支付、退货按实付比例退积分、店长自己维护商品图/价/库存、海岛不送）；数据层重写为 v4（新增 payOrder / applyReturn / updateProduct）；店长台重做；自测 54 项', 'docs/web-preview.png'],
           ['v0.5', '2026-11-17', 'UI 第二轮打磨：字号整体上调（18–22rpx 的说明文字实际只有 9–11px）、灰阶文字对比度 2.2–2.8:1 → 3.0–4.8:1、首页「按学校找」从 11 个格子改成一张目录卡；新增布局审计脚本，14 条路由全部通过', 'docs/web-preview.png'],
           ['v0.6', '2026-11-17', '详情页尺码面板新增「报身高体重 → 推荐尺码」表单；自测 64 → 76 项，新增「WXML 里绑定的事件方法都真的存在」12 条；修好网页演示版详情页白屏；新增浏览器级点验页，13 条全过', 'docs/size-form.png'],
           ['v0.7', '2026-11-18', '云开发落地：只做一个云函数 api（action 分派），定价/运费/会员折扣/积分抵扣/退货比例全部挪到服务端 rules.js（纯函数，与本地 store.js 逐条对应）；内存库自测 49 条；新增「前后端常量与同一笔单定价是否一致」16 条', '命令行输出'],
           ['v0.8', '2026-11-22', '云环境开通（小程序注册走个体工商户主体 + 微信认证），八个页面改走 utils/api.js（云优先、连不上退回本地）；实机跑通「下单 128、500 分抵 5、实付 123」，修掉 _id 写库报错', 'docs/cloud-orders.jpg'],
           ['v0.9', '2026-11-22', '收货地址簿（云同步、wx.chooseAddress 一键导入、最多 10 条、结算页自动带出）；修好「云端订单点支付报订单不见了」；云函数自测 71 条', 'docs/cloud-checkout.jpg'],
           ['v1.0', '2026-11-22', '店长台四件工具（搜索、批量发货、补单号、导出对账单）+ 超时 30 分钟自动关单 + 低库存预警；修掉三个只在真云端才犯的 bug；自测 101 / 98 条', 'docs/cloud-admin-goods.jpg'],
           ['v1.1', '2026-11-22', '并发加固（状态用条件更新、库存积分用一条语句加减）+ 订单分页 20 条 + 店长数据看板 + 对账单导真 xlsx（两张表，自己写 200 行不引库）；自测 106 / 126 条', 'docs/cloud-dashboard.jpg'],
            ['v1.2', '2026-11-23', '按店家真机反馈改：尺码改成纯身高制（150–200，两档中间取大）、店长入口只对 admins 里的人显示、分享卡、图片压缩、订单列表骨架屏；上传体验版 v1.2.2', 'docs/preview-qr.jpg'],
            ['v1.3', '2026-11-25', '20 张店面实拍图批量入库（裁白边 / 补方 / 750×750，包内 600×600），商品 8 → 30 款、学校 17 → 21 所；新增「一键把商品表同步到云数据库」（按 10 条分片，绕开云函数 3 秒超时）；首页「按学校」数量改为读数据；自测 108 / 132 条', 'docs/product-photos/0-index.jpg']],
          [1.2, 1.9, 9.9, 3.6], font_size=8)

    p(doc, '注：图 2、图 3 是当时版本的截图，品牌名当时为「兰茜」，2026-11-17 按店家要求更名为「兰欧茜」，'
           '代码、界面和本报告其余部分均已用新名。', size=9)
    image(doc, 'docs/art-review.png', 13.5, '图 1　v0.1：设计系统与 8 件商品占位图评审')
    image_row(doc, [('docs/preview-1.png', 'v0.2 上半：首页 / 分类 / 详情 / 购物车'),
                    ('docs/preview-2.png', 'v0.2 下半：结算 / 支付 / 订单 / 我的')],
              '图 2　v0.2：11 个页面全部可点通（自建渲染器出图）', width_cm=5.8)
    image(doc, 'docs/web-preview.png', 15.5, '图 3　v0.3–v0.5：网页演示版（真实 WXML/WXSS/JS 渲染，可在浏览器里点）')
    image(doc, 'docs/size-form.png', 7.0, '图 4　v0.6：详情页尺码面板里的「报身高体重 → 推荐尺码」')
    image_row(doc, [('docs/cloud-orders.jpg', '买家「我的订单」（云端订单，¥123）'),
                    ('docs/cloud-pay.jpg', '收银台加载云端订单（¥118）')],
              '图 5　v0.8：真机模拟器里走通一单（云数据库里的订单）', width_cm=6.2)
    image_row(doc, [('docs/cloud-address.jpg', '收货地址簿（云端同步）'),
                    ('docs/cloud-checkout.jpg', '结算页自动带出默认地址')],
              '图 6　v0.9：收货地址簿与结算页', width_cm=6.2)
    image(doc, 'docs/cloud-admin-goods.jpg', 5.4, '图 7　v1.0：店长台商品页的低库存提醒（「仅剩 3 件」）')
    image(doc, 'docs/cloud-dashboard.jpg', 5.4, '图 8　v1.1：店长台「数据」看板（近 7/30 天、14 天柱状、热销款、退货率）')
    image(doc, 'docs/product-photos/0-index.jpg', 14.0, '图 9　v1.3：20 张校服实拍图批量整理后的总览（编号对应商品 p9–p30）')

    # c)
    h(doc, 'c) 新增/修改的主要功能与想法来源')
    table(doc,
          ['功能', '想法来源', '说明'],
          [['首页不做整页商品瀑布流', '用户：整页陈列"看着太难受"（样板图4 是反例）', '主视觉 + 四个入口 + 本周精选 + 按学校找 + 积分说明，一屏只讲一件事'],
           ['「按学校找」做成一张目录卡', '用户："有点怪怪的"', '最初 3 列 11 个格子把首页拉到 2332px，改成学段 tab + 单列名单（默认 6 行、可展开）'],
           ['左侧分类栏 + 商品列表', '样板图3', '校服按学校/学段天然分层，左栏比纯搜索快'],
           ['「我的」会员中心', '样板图2', '家长最常用的入口是"我的订单"，因此放首屏'],
           ['微信支付（替换收款码）', '用户改口：小程序微信付款、绑银行卡', '删掉 pending_confirm，改 pending_pay → paid；钱进店长银行卡，走官方对账'],
           ['积分抵现 + 会员成长', '用户提出，店家定规则', '原想用积分冻结当"诚意金"，店家核算毛利后改成 5% 抵现 + 满 ¥1200 享 96 折，保证金取消'],
           ['退货按比例双向结算', '用户提出："退了货不能白拿积分"', '退款、退积分、扣回已返积分三条线用同一比例，只写在一处'],
           ['店长端可改价 / 改图 / 改库存', '用户提出（商品图店主自己维护）', '店长不用会改代码：点商品卡片就能改名称、价格、库存、拍照换图'],
           ['店长端发货', '样板图2/3 的订单模块', '店长只需"看订单 → 填单号"两步，不引入复杂 ERP'],
           ['详情页「身高体重 → 推荐尺码」', '用户勾选要做（docs/待确认.md 第 4 条）', '规则收成一个纯函数：先按身高落档，再按体重浮动一档，BMI 极端再兜一层，结果永远夹在商品真实尺码表里'],
           ['收货地址簿', '用户实际下单时要反复重填地址', '地址几乎不变，存 users 文档的 addresses 数组（最多 10 条、第一条自动默认），并接 wx.chooseAddress 一键拉微信地址'],
           ['店长端批量发货 + 补单号', '店长视角：开学季一天几十单，一单一单点太慢', '「全选待发货 → 选快递 → 批量发货」两步；单号常要等揽收才有，所以先发货、后补单号，setTracking 只允许补已发货的单'],
           ['导出对账单（真 xlsx）', '店长要跟快递、跟家里对账', '自己写 200 行生成 .xlsx（两张表：明细 + 按月汇总），手机号保留前导零；不引第三方库，小程序主包只有 2MB'],
           ['店长台数据看板', '店长要看「这个月卖得怎么样」', '近 7/30 天销售额与客单价、近 14 天柱状、热销款前 5、退货率、超时关单数，底部一行写清口径'],
           ['订单分页（20 条）', '开学季一天几十单，一次拉全部首屏要等 2–3 秒', '服务端 limit/skip 返回 hasMore，买家滑到底自动加载、店长点「看更早的订单」'],
           ['扣库存/改状态改并发写法', '一个家长会连点两下，两个人也可能抢最后一件', '状态用条件更新（cas）、数量用一条语句加减（incField），扣不动就回滚并给中文原因'],
           ['超时 30 分钟自动关单', '店长台堆着一排「待付款」，库存被占着', '定时触发器每 10 分钟扫一次：退积分、还库存、置「已取消」并写原因；前端定时器不可靠（退出小程序就停）'],
           ['商品低库存预警', '校服常见断码，店长要提前补货', '库存 ≤5 标「仅剩 N 件」、售罄反白，顶部汇总「N 款商品库存不多了」']],
          [3.9, 4.6, 8.1], font_size=8.5)
    p(doc, '尺码推荐是这一版的重点，展开一句为什么是"规则"而不是"模型"：店里的尺码表本来就是按身高体重分档的，'
           '规则直接映射店长脑子里的判断；样本是 8 件商品、几百单，训不出模型；让家长多填肩宽胸围，'
           '开学季的耐心撑不住。代价是不测体型，胖瘦只靠 BMI 兜一层，所以结果卡里写明"按这款的尺码表算的参考值"，'
           '下面仍保留完整对照表和"拿不准选大一号"的提示。')

    # d)
    h(doc, 'd) 遇到的问题与解决')
    p(doc, '只记真实发生过的，每条写清"为什么"和"怎么验证"。')
    reset_numbering()
    numbered(doc, '最初以为个人主体永远开不了微信支付，因此设计了"店长收款码 + 人工确认"。'
                  '店家后来明确要求"小程序微信付款、绑定银行卡"，方案整个推翻：订单状态机删掉 pending_confirm，'
                  '改成 pending_pay → paid，付款成功由支付回调写状态，演示版用一个按钮走同一条路径。'
                  '教训：把"暂时做不到"写进设计的代价，比把"能不能做到"问清楚更大。', lead='支付的合规前提被误解了一轮。')
    numbered(doc, '不能让任意用户进店长端改订单。演示版用"店长入口 + 4 位口令（2468）"，'
                  '所有店长操作只改本地数据；正式版改为云开发 openid 白名单。', lead='店长身份识别。')
    numbered(doc, '不能直接搬样板小程序的图（版权 + 不是自家货）。先做一套统一色系的矢量插画占位，'
                  '可整体替换；店家确认"实物图店主自己维护"后，把名称/价格/库存/图片做成店长台可编辑（store.updateProduct），'
                  '拿到实拍图后店长自己换，不需要改代码。', lead='没有真实商品图和商品数据。')
    numbered(doc, '校服退换麻烦，尺码错一次就是一次售后。v0.3 起详情页放身高体重对照表；'
                  'v0.6 把对照表升级成可点的小表单：填身高体重，「算一下」直接给出码位和一句理由，「就用它」就选中这个码。'
                  '规则写成纯函数 miniprogram/utils/size.js，最后一步把结果夹进这件商品真实的尺码表，所以不会推荐不存在的码。'
                  '验证：自测第 11 节 10 条断言（8 件商品的推荐结果必须落在各自尺码表里）+ 浏览器里点一遍 13 条。', lead='家长不会选尺码。')
    numbered(doc, '小程序不能像网页一样甩链接。提交时给「小程序名称 + 体验版二维码 + 3 步打开说明」，'
                  '同时附网页演示版（双击就能看）和源码仓库。', lead='作业要求的"访问信息"怎么给。')
    numbered(doc, '开发机没有微信开发者工具，改完界面只能靠想象。写了一个只服务于本项目的预览渲染器'
                  '（preview/build.js + preview/web-runtime.js）：在浏览器里 mock wx / Page / getApp，解析 WXML'
                  '（wx:for、wx:if、{{}}、自定义组件）和 WXSS（rpx→px），把真实的页面代码打包成可直接双击打开的 HTML。'
                  '不执行真机手势，所以只用于"看"，交互仍靠数据层自测。收获：渲染器和截图本身成了报告"开发历史"的证据。', lead='看不见界面。')
    numbered(doc, '积分规则改了三版（20% → 10% + 保证金 → 5% + 会员 96 折），每次都要同步结算页、详情页、积分页文案和测试断言，'
                  '其中一次改完还有文案残留（结算页仍写"跳到店长收款码"、订单页仍写"冻结的 200 积分"）。'
                  '解决：把抵扣公式收敛到 store.createOrder 一处，结算页只读 maxUse；改完规则后全项目搜"保证金 / 冻结 / 收款码"做文案清理。', lead='积分规则改版留下的文案残留。')
    numbered(doc, '用户说"怪怪的"却说不清哪里怪，而开发机上又看不了截图。解决：把"怪"拆成可测的量——'
                  '写 preview/make-audit.js 注入审计脚本测横向溢出、文字被行高裁切、滚动到底最后一格被固定底栏盖住；'
                  '用 preview/contrast.js 算每个灰阶在奶油底上的对比度；用 preview/bump-fonts.js 把字号按单调映射整体上调。'
                  '结果：审计出 cart-bar 横向溢出到 -187..563、#9a9184 只有 2.81:1 对比度、大量 18–22rpx 说明文字实际只有 9–11px；'
                  '修完后 14 条路由审计全部通过。把主观反馈翻译成客观指标，是这次最有用的一条方法论。', lead='"有点怪怪的"这种反馈怎么落地。')
    numbered(doc, '新加 utils/size.js 后，网页演示版打开详情页只有一行红字：missing module utils/size。'
                  '原因是网页版不是打包工具，preview/web-build.js 里有一份 moduleFiles 白名单，漏了新的工具模块，'
                  '页面一 require 就炸。解决：把 utils/size.js 加进白名单并重建（244KB / 18 图），'
                  '并在交接卡里写下"以后新增 utils/*.js 必须同步白名单"。教训：自建渲染器的隐式白名单最容易漏，因为构建本身不报错。', lead='网页演示版详情页白屏。')
    numbered(doc, '第一版截图里，体重输入框和单位「kg」被裁到屏幕外。原因是原生 input 在 flex 容器里默认 min-width:auto，'
                  '按内容宽度撑开，两个输入框加按钮就超出 375 宽。解决：给输入框和它的容器加 min-width:0、width:100%，'
                  '按钮加 flex:0 0 auto，改完重新截图核对。收获：纯 CSS 的错只有截图能看出来，数据层自测永远全过——UI 改动必须配一次真截图。', lead='尺码表单在窄屏被撑破。')
    numbered(doc, '店长第一次在真云端点「发货」，云函数报 -502001 Cannot create field '
                  "'company' in element {tracking: null}。原因是云数据库的 update 对对象/数组是合并而不是替换："
                  'tracking 原本是 null，没法往里加子字段；timeline 数组按索引合并还会丢新增项。'
                  '解决：在 common/wxdb.js 里统一对对象/数组值包一层 db.command.set()，标量照旧；修完实测发货 + 补单号都 ok，'
                  'timeline 长度 4（提交/支付/发货/补单号）。教训：内存库自测（纯 JS 对象直接赋值）永远查不出这类云端语义差异。', lead='云数据库的 update 是合并语义。')
    numbered(doc, '店长改完价，自己手机显示新价、另一台手机还是老价。原因是客户端传的是 {id, patch} 嵌套对象，'
                  '而云函数 updateProduct 读的是扁平字段（payload.price/stock/...），于是每次都返回「没有要改的字段」——'
                  '本地看着成功、云端一动不动。解决：api.js 里摊平成 Object.assign({}, patch, {id})，表单传的字符串由服务端 Number() 兜住；'
                  '顺带发现下架开关的 onSale 服务端根本没写，一并补上，商品列表也改成以云端 products 为准。'
                  '教训：「响应成功」不等于「数据写进去了」，改完必须回读一次云端。', lead='店长改价「本地成了、云端没动」。')
    numbered(doc, '明明把库存改成 3、也重新部署了云函数，模拟器页面一直显示 86，差点以为云函数没生效。'
                  '原因是开发者工具缓存编译产物，只关掉重开项目仍跑旧 bundle。解决：先 cli cache --clean all 再关开项目。'
                  '教训：排查「云端没生效」之前，先证明本机跑的是最新代码——在页面里塞一个 dbg 字段读回来，比猜快得多。', lead='开发工具缓存造成的假象。')
    numbered(doc, '开学季一个家长会连点两下「确认收货」，两个人也可能同时抢最后一件。原来的写法是「读出来 → 算好 → 整份写回」，'
                  '两个请求交错时后写的覆盖先写的：积分返两次、库存扣成负数。解决：状态用条件更新（where status = 旧状态 才改），'
                  '数值用一条语句带加减（where stock >= qty 才 inc(-qty)），落地在 common/wxdb.js 的 cas() 与 incField()；'
                  '扣不动就回滚并返回中文原因。踩到的坑：退货的 cas 一开始把旧状态写死成 return_pending，'
                  '而部分退货后订单其实是 done，第二次退剩下的货永远抢不到。'
                  '教训：条件更新里的旧状态必须是刚读出来的那个值。'
                  '验证：cloud-test 第 12 组 10 条（连点确认只返一次、最后一件只成一个、同一笔积分两单同时抵用只成一个）。', lead='并发下的重复扣款。')
    numbered(doc, '店长要「能粘进 Excel 的对账单」。原来是拼 CSV 复制到剪贴板，结果手机号 0138… 的前导零被 Excel 吃掉、'
                  '一个文件只能一张表、中文偶尔乱码。解决：自己写 200 行生成真 xlsx（CRC32 + zip 只存储 + 几段固定 XML），'
                  '两张表：明细（每单一行）+ 按月汇总；不引 exceljs 之类的库，因为小程序主包只给 2MB。'
                  '验证：Python 的 zipfile 与 openpyxl 双读通过，真机模拟器导出后从 USER_DATA_PATH 读回来再验一遍'
                  '（10 行数据、实付是数字型）。顺手又踩了同一个坑：打包白名单漏了 utils/xlsx.js，'
                  '且注释里的 require 被当成代码替换掉。', lead='对账单只能用 CSV。')
    numbered(doc, '店长台顶部「已收款」显示 ¥1345，新加的数据看板「近 30 天」却是 ¥1099，差 246 正好是两笔超时取消的单。'
                  '原因是两处各算各的：看板按已付款状态过滤，顶部那个把取消的单也算进了销售额。'
                  '解决：revenue 统一只统计已付款状态，并把口径写成一句话显示在看板底部（销售额 = 实付 − 已退款）。'
                  '教训：同一个数字在页面上出现两次，就必须用同一个函数算，否则店长会以为系统在乱算。', lead='同一个销售额算出两个数。')

    # e)
    h(doc, 'e) 收集到的反馈与决策')
    table(doc,
          ['日期', '来源', '反馈', '决策', '原因'],
          [['2026-11-12', '用户', '首页不要像样板图4 那样整页堆商品，"看着太难受"', '采纳：改编辑式布局，商品只露 4–6 个', '家长是带着目的来的，首页负责分流，不负责铺货'],
           ['2026-11-12', '用户', '担心没有稳定付款渠道，想用妈妈收款码 + 积分抵押', '当时采纳，v0.4 推翻', '先保证流程走通；店家后来明确要官方支付'],
           ['2026-11-12', '用户', 'UI 要"看着舒心"，可以"整点花"', '采纳：奶油纸底 + 墨绿/砖红 + 宋体标题 + 手绘校服插画', '校服是"端正"的品类，走克制的编辑感而不是糖果色'],
           ['2026-11-16', '用户（转述店长规则）', '新客 500 分、100 积分抵 ¥1、每单最多抵 5%、满 ¥1200 享 96 折、取消保证金', '采纳：公式收敛到 createOrder 一处', '店家核算过毛利；保证金对家长门槛太高'],
           ['2026-11-17', '用户', '六条：不要签到 / 退货按实付退积分 / 小学初中三区 6 个通用入口 / 海岛不送 / 实物图店主自己维护 / 微信支付不用码', '全部采纳', '都直接来自店家实际经营，不是设计偏好'],
           ['2026-11-17', '用户', '"上一条对话说了让你把 UI 界面再打磨一下，现在有点怪怪的"', '采纳：字号、灰阶、首页目录卡、分隔饰线四项重做，并加可重复运行的审计脚本', '说不清怪在哪，就用对比度、字号、溢出、遮挡四个可测维度逼近'],
           ['2026-11-17', '用户', '勾选要做尺码推荐小表单，并要求更新过期文档、整理报告', '采纳：详情页尺码面板加表单（纯前端规则，不碰后端）；README 与交接卡从 v0.2 更新到 v0.6 实际状态', '尺码错一次就是一次售后，而这一步不需要任何服务端能力'],
           ['2026-11-17', '用户', '品牌名改成「兰欧茜」', '采纳：81 个文本文件一次替换，印章 logo 改成按内圈宽度自动缩字号，报告重出', '店名是招牌，要么不改，要么连网页版产物和报告一起改干净'],
           ['2026-11-18', '用户', '"是真要收钱，因为我既然开发了这个那以后肯定是要用的要维护的"', '采纳：注册走个体工商户主体 + 微信认证（个人主体开不了微信支付）', '校服店是长期生意，主体选错后面要整个重来；认证 30 元 + 云开发 19.9 元/月可接受'],
           ['2026-11-22', '用户', '"除了商品图和支付两块剩下能做的全做了，然后更新文档和报告"', '采纳：店长台工具、超时关单、低库存预警、三个云端 bug 修复；文档升 v1.0；清掉 140 个一次性产物（10.4MB）', '商品图要等实拍、支付要等商户号，都是外部依赖；其余能力现在就能做完并验证'],
           ['2026-11-22', '用户', '"9、10、11、13、14、16都做了，1、3、4告诉我怎么做在哪里做"', '采纳：并发加固、订单分页、数据看板、真 xlsx 对账单、商品图上云存储、索引与权限文档化；备案 / 隐私保护指引 / 商户号单独写成 docs/上线操作指南.md', '能自己做的先做完；卡在「必须营业执照本人签字」的写成操作手册，他照着点就行']],
          [2.0, 2.4, 4.8, 4.3, 4.1], font_size=8.5)

    # f)
    h(doc, 'f) 当前限制与下一步')
    p(doc, '写在这里，是因为这些限制会直接影响"能不能真开店"，不是留到以后再说的小毛病：', after=4)
    bullet(doc, '演示版点「微信支付」只模拟成功、不真扣钱；正式收款要小程序认证 + 微信支付商户号，卡住正式收款的只有这一项。', lead='没有商户号。')
    bullet(doc, '数据已经在云数据库里（users / products / orders / admins），但云开发按量收费（个人版 19.9 元/月），没备案也上不了线；清缓存只清本机缓存，云端数据不动。', lead='云开发是收费服务。')
    bullet(doc, '小程序端店长身份由服务端按 admins 集合的 openid 判定，防得住；但网页演示版仍用口令 2468，那是个挡板。', lead='网页版的店长口令只是挡板。')
    bullet(doc, '30 款商品里 22 款已换成店面实拍图（另 8 款仍是矢量插画），¥25–¥268；价格除「麒麟断码长裤 38 元」是图上明写的，其余是按现有款推的建议价，等店家核。', lead='商品与价格待核。')
    bullet(doc, '按尺码表规则估算，不测体型；胖瘦只靠 BMI 兜一层，肩宽特殊的孩子仍建议到店试穿。', lead='尺码推荐不是量体。')
    bullet(doc, '开发者工具模拟器已经走通云端的完整一单，但真机手势、字体回退、支付 SDK、体验版二维码还没跑过；'
                'ICP 备案与类目审核也都还没办。', lead='没有真机验证、没有备案。')
    p(doc, '下一步：ICP 备案 + 类目审核（要经营者本人办，1–2 周）→ 真机走通一单 → 接商户号把 pay 换成 wx.requestPayment '
           '并写支付回调 → 商品图挪到云存储 → 提审发布。', before=6)

    # g)
    h(doc, 'g) 附：可复查的证据')
    table(doc,
          ['检查', '命令 / 方式', '结果'],
          [['数据层全流程自测', 'node preview/flow-test.js', 'ALL PASS 108（下单/支付/退货/积分/购物车/按身高选码/事件绑定/云端一致性/接口层/网页版模块完整性/xlsx 结构）'],
           ['云函数本地自测', 'node tools/cloud-test.js', 'ALL PASS 132（定价/权限/状态机/退货比例/支付幂等/地址簿/超时关单/补运单号/并发/分页与看板/商品图校验/商品表同步）'],
           ['静态页面构建', 'node preview/build.js', '13 个页面全部生成（12 页 + 尺码推荐态）'],
           ['网页演示版构建', 'node preview/web-build.js', 'web/index.html、web/app.html（各 292KB）、18 张图'],
           ['网页版交互点验', '浏览器打开 preview/itest-size.html', '13 条全 PASS（开面板 → 填 170/62 → M 码 → 85cm 报错 → 就用它 → 弹提示并收起）'],
           ['云端实机验证', '开发者工具 + 云函数（automation 调用）', '见 d 与图 5–7：下单 128 → 积分抵 5 → 实付 123 → 支付 → 批量发货 → 补单号 ZT998877665 → 时间线 4 条'],
           ['布局审计（v0.5）', 'node preview/make-audit.js', '14 条路由全部通过（横向溢出、行高裁切、固定底栏遮挡）']],
          [3.4, 5.4, 8.0], font_size=8.5)
    p(doc, '代码规模：小程序本体 21 个 js / 4020 行、13 个 wxml / 1436 行、14 个 wxss / 4690 行；'
           '云函数 5 个 js / 1046 行；预览与自测工具 2010 行、云端自测 490 行。'
           '数据规模：30 款商品（22 款实拍图）、21 所学校入口、12 个页面、四张云数据库集合。')
    p(doc, '文档清单：README.md（怎么跑、怎么换成店里真实数据）、docs/决策记录.md（D001–D013）、'
           'docs/项目报告素材.md（本报告的事实底稿）、docs/云开发接入指南.md（开通与核对步骤）、docs/上线操作指南.md（备案 / 隐私保护指引 / 商户号怎么点）、'
           'docs/待确认.md（等店家拍板的 6 条）、docs/交接卡-20261117.md（给下一个会话的交接）。')

    doc.save(OUT)
    print('WROTE', OUT)
    print('paragraphs', len(doc.paragraphs), 'tables', len(doc.tables))


if __name__ == '__main__':
    build()

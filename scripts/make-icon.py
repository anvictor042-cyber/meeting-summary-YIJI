#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
议迹 App 图标生成器（v1.3.7）
概念：会议追踪与对比
- 深绿渐变圆角方底（品牌色 #2e5e4e 系）
- 两张错位叠放的圆角卡片 = 多场会议追踪 + 对比
- 前置卡片上的声波条 = 录音 / 转写
输出：build/icon.png (1024x1024 RGBA)
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 2048          # 超采样绘制尺寸
OUT = 1024        # 最终尺寸
R = 22            # 背景圆角比例(%)

# ---- 调色板（品牌深绿 + 米白，克制的单强调色）----
GREEN_A = (28, 68, 52)      # 渐变左上
GREEN_B = (46, 100, 76)     # 渐变右下（保持 <80% 饱和度）
CREAM = (246, 243, 236)     # 卡片米白（与界面 #f4f3ee 一致）
INK = (26, 62, 48)          # 声波条深绿（在米白上高对比）
BACK_ALPHA = 0.16           # 后卡片透明度

# ---- 背景：对角渐变 + 圆角 ----
def diag_gradient(w, h, a, b):
    t = np.linspace(0, 1, w, dtype=np.float64)[None, :, None]
    u = np.linspace(0, 1, h, dtype=np.float64)[:, None, None]
    k = np.clip((t + u) / 2, 0, 1)
    A = np.array(a, dtype=np.float64)[None, None, :]
    B = np.array(b, dtype=np.float64)[None, None, :]
    return (A * (1 - k) + B * k)

bg = np.zeros((S, S, 4), dtype=np.uint8)
bg[..., :3] = diag_gradient(S, S, GREEN_A, GREEN_B)
bg[..., 3] = 255

img = Image.fromarray(bg, 'RGBA')
d = ImageDraw.Draw(img)
# 背景圆角遮罩
mask = Image.new('L', (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * R / 100), fill=255)
img.putalpha(Image.composite(img.split()[3], Image.new('L', (S, S), 0), mask))
d = ImageDraw.Draw(img)

# ---- 后卡片（幽灵白，左上一角露出 = 过往会议）----
def card_rect(px, py, size, r):
    return [px, py, px + size, py + size], r

BACK = 0.47 * S
(bx0, by0, bx1, by1), br = card_rect(0.135 * S, 0.165 * S, BACK, int(BACK * 0.26))
back_layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
bd = ImageDraw.Draw(back_layer)
bd.rounded_rectangle([bx0, by0, bx1, by1], radius=br, fill=(255, 255, 255, int(255 * BACK_ALPHA)))
img = Image.alpha_composite(img, back_layer)

# ---- 前卡片（米白 + 淡绿投影）----
FRONT = 0.545 * S
(fx0, fy0, fx1, fy1), fr = card_rect(0.30 * S, 0.285 * S, FRONT, int(FRONT * 0.25))
shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.rounded_rectangle([fx0 + 12, fy0 + 26, fx1 + 12, fy1 + 26], radius=fr, fill=(10, 30, 22, 130))
shadow = shadow.filter(ImageFilter.GaussianBlur(36))
img = Image.alpha_composite(img, shadow)
front_layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
fd = ImageDraw.Draw(front_layer)
fd.rounded_rectangle([fx0, fy0, fx1, fy1], radius=fr, fill=CREAM + (255,))
# 卡片顶部细高光（内描边，非纯白外发光）
fd.rounded_rectangle([fx0 + 6, fy0 + 6, fx1 - 6, fy1 - 6], radius=fr - 6, outline=(255, 255, 255, 70), width=5)
img = Image.alpha_composite(img, front_layer)
d = ImageDraw.Draw(img)

# ---- 声波条（7 根圆头竖条，居中于前卡片）----
heights = [0.42, 0.68, 0.92, 0.52, 0.78, 0.46, 0.62]   # 相对波形区高度
n = len(heights)
bar_w = 0.085 * FRONT
gap = 0.045 * FRONT
total_w = n * bar_w + (n - 1) * gap
x0 = (fx0 + fx1) / 2 - total_w / 2
base_y = fy1 - 0.185 * FRONT          # 波形基线（卡片内底部）
top_y = fy0 + 0.30 * FRONT            # 波形区顶
zone_h = base_y - top_y
for i, h in enumerate(heights):
    x = x0 + i * (bar_w + gap)
    bh = zone_h * h
    y0 = base_y - bh
    d.rounded_rectangle([x, y0, x + bar_w, base_y], radius=bar_w / 2, fill=INK + (255,))

# ---- 输出 ----
img = img.resize((OUT, OUT), Image.LANCZOS)
img.save('build/icon.png', 'PNG')
print('ICON_OK', img.size)

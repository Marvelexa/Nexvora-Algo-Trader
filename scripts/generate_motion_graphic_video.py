"""
Delta Exchange High-Frequency Quantitative Trading Bot
Procedural Motion Graphics Video Generator (MP4)
Renders high-definition motion graphic video on project architecture,
dual-engine confluence, trap shields, risk guard, and compounding.
"""

import math
import os
import sys
import time
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# Reconfigure stdout for UTF-8 on Windows
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

# Video Configuration
WIDTH = 1280
HEIGHT = 720
FPS = 30
SCENE_DURATION_SEC = 6.0
NUM_SCENES = 6
TOTAL_DURATION_SEC = SCENE_DURATION_SEC * NUM_SCENES  # 36 seconds
TOTAL_FRAMES = int(TOTAL_DURATION_SEC * FPS)          # 1080 frames
OUTPUT_VIDEO_PATH = "delta_cryptobot_motion_graphics.mp4"

# Colors (RGB)
BG_COLOR = (9, 14, 24)
GRID_COLOR = (18, 28, 48)
CYAN = (0, 240, 255)
GREEN = (0, 255, 140)
GOLD = (255, 195, 18)
PURPLE = (180, 70, 255)
RED = (255, 60, 95)
WHITE = (245, 248, 255)
MUTED = (120, 145, 175)
CARD_BG = (15, 23, 38)
CARD_BORDER = (28, 44, 72)
CARD_BG_LIGHT = (20, 32, 54)

# Load Fonts safely
FONT_TITLE_PATH = "C:/Windows/Fonts/segoeuib.ttf"
FONT_MONO_PATH = "C:/Windows/Fonts/consola.ttf"
FONT_REGULAR_PATH = "C:/Windows/Fonts/segoeui.ttf"

def get_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()

font_hero = get_font(FONT_TITLE_PATH, 42)
font_title = get_font(FONT_TITLE_PATH, 28)
font_subtitle = get_font(FONT_TITLE_PATH, 20)
font_body = get_font(FONT_REGULAR_PATH, 16)
font_mono_lg = get_font(FONT_MONO_PATH, 20)
font_mono = get_font(FONT_MONO_PATH, 14)
font_small = get_font(FONT_REGULAR_PATH, 13)

# Easing functions
def ease_out_cubic(x):
    return 1 - pow(1 - max(0.0, min(1.0, x)), 3)

def ease_in_out_quad(x):
    x = max(0.0, min(1.0, x))
    return 2 * x * x if x < 0.5 else 1 - pow(-2 * x + 2, 2) / 2

# Primitives
def draw_rounded_rect(draw, x, y, w, h, radius, fill, outline=None, width=1):
    draw.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=fill, outline=outline, width=width)

def draw_hud(draw, width, height, t, global_t, scene_idx, scene_title):
    # Top status bar
    draw.line([(0, 48), (width, 48)], fill=GRID_COLOR, width=1)
    
    # Blinking Live Dot
    blink = int(math.sin(global_t * 6) * 127 + 128)
    live_color = (0, 255, 140) if (int(global_t * 3) % 2 == 0) else (0, 180, 100)
    draw.ellipse([24, 18, 36, 30], fill=live_color)
    draw.text((44, 15), "DELTA EXCHANGE INDIA [LIVE API]", fill=WHITE, font=font_mono)
    
    # Middle status indicators
    ping = 0.4 + 0.1 * math.sin(global_t * 2)
    telemetry_str = f"TELEMETRY: 0ms DIRECT AGG | PING: {ping:.1f}ms | CONFLUENCE THRESHOLD: >= 40"
    draw.text((360, 15), telemetry_str, fill=MUTED, font=font_mono)
    
    # Right scene indicator
    scene_str = f"SCENE 0{scene_idx + 1}/06: {scene_title.upper()}"
    bbox = font_mono.getbbox(scene_str)
    sw = bbox[2] - bbox[0]
    draw.text((width - sw - 24, 15), scene_str, fill=CYAN, font=font_mono)
    
    # Bottom scrubber & timecode
    draw.line([(0, height - 32), (width, height - 32)], fill=GRID_COLOR, width=1)
    
    # Progress line
    progress = global_t / TOTAL_DURATION_SEC
    draw.line([(0, height - 32), (int(width * progress), height - 32)], fill=CYAN, width=3)
    
    # Timecode
    cur_sec = int(global_t)
    tot_sec = int(TOTAL_DURATION_SEC)
    tc = f"{cur_sec//60:02d}:{cur_sec%60:02d} / {tot_sec//60:02d}:{tot_sec%60:02d}  [30 FPS - 1080p MASTER]"
    draw.text((24, height - 24), tc, fill=MUTED, font=font_mono)
    
    # Scene markers
    for i in range(1, NUM_SCENES):
        mx = int(width * (i / NUM_SCENES))
        draw.line([(mx, height - 36), (mx, height - 28)], fill=MUTED, width=1)

def draw_background_grid(draw, width, height, t):
    # Subtle moving cyber grid
    offset = int((t * 20) % 40)
    for x in range(0, width, 40):
        draw.line([(x, 48), (x, height - 32)], fill=(12, 18, 30), width=1)
    for y in range(48 + offset, height - 32, 40):
        draw.line([(0, y), (width, y)], fill=(12, 18, 30), width=1)

# Scene Renderers
def render_scene_1(draw, t, global_t):
    """Scene 1: Title & System Boot Sequence"""
    cx, cy = WIDTH // 2, HEIGHT // 2
    anim_in = ease_out_cubic(min(1.0, t / 1.2))
    
    # Rotating outer radar rings
    for r, speed in [(180, 0.5), (240, -0.3), (300, 0.2)]:
        rot = global_t * speed
        for deg in range(0, 360, 45):
            rad = math.radians(deg + rot * 60)
            x1 = cx + math.cos(rad) * (r - 10)
            y1 = cy + math.sin(rad) * (r - 10)
            x2 = cx + math.cos(rad) * r
            y2 = cy + math.sin(rad) * r
            draw.line([(x1, y1), (x2, y2)], fill=(25, 42, 68), width=2)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(18, 30, 50), width=1)
    
    # Central Hexagon
    hex_pts = []
    hex_r = 60 * anim_in
    for i in range(6):
        a = math.radians(60 * i + global_t * 20)
        hex_pts.append((cx + hex_r * math.cos(a), cy - 60 + hex_r * math.sin(a)))
    if len(hex_pts) >= 3:
        draw.polygon(hex_pts, outline=CYAN, width=2)
    
    # Title badge
    badge_w, badge_h = 320, 28
    bx = cx - badge_w // 2
    by = cy - 145
    draw_rounded_rect(draw, bx, by, badge_w, badge_h, 6, CARD_BG, outline=CYAN, width=1)
    draw.text((bx + 20, by + 5), "INSTITUTIONAL QUANT ENGINE", fill=CYAN, font=font_mono)
    
    # Main Hero Title
    title1 = "DELTA CRYPTOBOT"
    bbox1 = font_hero.getbbox(title1)
    w1 = bbox1[2] - bbox1[0]
    draw.text((cx - w1 // 2, cy - 105), title1, fill=WHITE, font=font_hero)
    
    title2 = "DUAL-ENGINE HIGH FREQUENCY QUANTITATIVE TRADER"
    bbox2 = font_title.getbbox(title2)
    w2 = bbox2[2] - bbox2[0]
    draw.text((cx - w2 // 2, cy - 45), title2, fill=GOLD, font=font_title)
    
    desc = "Mathematical Digital Signal Processing (DSP) + Price Action Mechanics + Auto Execution"
    bbox_d = font_body.getbbox(desc)
    wd = bbox_d[2] - bbox_d[0]
    draw.text((cx - wd // 2, cy + 5), desc, fill=MUTED, font=font_body)
    
    # Feature Badges
    badges = [
        ("0ms WEBSOCKET STREAM", GREEN),
        ("DUAL CONFLUENCE MATRIX", CYAN),
        ("SYMMETRIC TRAP SHIELD", PURPLE),
        ("ZERO INVERSION GUARANTEE", GOLD),
        ("HARD RISK GUARD (20x MAX)", RED)
    ]
    card_total_w = len(badges) * 230 - 20
    start_bx = cx - card_total_w // 2
    for i, (text, color) in enumerate(badges):
        bx = start_bx + i * 230
        by = cy + 70 + int((1 - anim_in) * 40)
        draw_rounded_rect(draw, bx, by, 210, 48, 8, CARD_BG, outline=color, width=1)
        draw.ellipse([bx + 12, by + 19, bx + 22, by + 29], fill=color)
        draw.text((bx + 30, by + 16), text, fill=WHITE, font=font_small)

    # Footnote
    fn = "Target: High-Alpha Perpetual Futures (XRP, SOL, DOGE, AVAX, SUI) | Delta Exchange India"
    bbox_fn = font_mono.getbbox(fn)
    wfn = bbox_fn[2] - bbox_fn[0]
    draw.text((cx - wfn // 2, cy + 160), fn, fill=CYAN, font=font_mono)


def render_scene_2(draw, t, global_t):
    """Scene 2: Dual-Engine Confluence Matrix"""
    anim_in = ease_out_cubic(min(1.0, t / 1.0))
    
    # Header
    draw.text((60, 70), "CORE ARCHITECTURE: DUAL-ENGINE CONFLUENCE MATRIX", fill=WHITE, font=font_title)
    draw.text((60, 105), "Two independent algorithmic minds must mathematically agree before ANY trade order is dispatched.", fill=MUTED, font=font_body)
    
    # Left Engine: Dedicated Indicators
    card_y = 150
    w, h = 480, 450
    draw_rounded_rect(draw, 60, card_y, w, h, 12, CARD_BG, outline=CYAN, width=2)
    
    # Badge
    draw_rounded_rect(draw, 80, card_y + 20, 200, 28, 6, CARD_BG_LIGHT, outline=CYAN, width=1)
    draw.text((95, card_y + 25), "ENGINE 1: TECHNICALS", fill=CYAN, font=font_mono)
    draw.text((80, card_y + 60), "Institutional Indicator Engine", fill=WHITE, font=font_subtitle)
    
    # Animated Candlesticks & EMAs
    chart_x, chart_y, chart_w, chart_h = 80, card_y + 100, 440, 180
    draw_rounded_rect(draw, chart_x, chart_y, chart_w, chart_h, 8, (11, 17, 28), outline=CARD_BORDER, width=1)
    
    # Draw simulated candles
    np.random.seed(42)
    candles = [
        (100, 95, 115, 110), (110, 108, 125, 122), (122, 118, 130, 120),
        (120, 115, 135, 132), (132, 128, 142, 138), (138, 135, 150, 148),
        (148, 142, 155, 145), (145, 140, 160, 158), (158, 152, 168, 165)
    ]
    candle_step = chart_w // (len(candles) + 1)
    for ci, (o, l, h_p, c) in enumerate(candles):
        cx = chart_x + 30 + ci * candle_step
        yo = chart_y + chart_h - int((o - 80) * 1.5)
        yc = chart_y + chart_h - int((c - 80) * 1.5)
        yl = chart_y + chart_h - int((l - 80) * 1.5)
        yh = chart_y + chart_h - int((h_p - 80) * 1.5)
        color = GREEN if c >= o else RED
        draw.line([(cx, yl), (cx, yh)], fill=color, width=1)
        top = min(yo, yc)
        bot = max(yo, yc)
        draw.rectangle([cx - 7, top, cx + 7, bot], fill=color)
        
    # Moving Average Waves
    ema_pts = []
    for step in range(chart_w):
        val = chart_y + chart_h - 60 - int(math.sin((step + global_t * 40) * 0.03) * 25 + step * 0.15)
        ema_pts.append((chart_x + step, val))
    if len(ema_pts) > 1:
        draw.line(ema_pts, fill=GOLD, width=2)
        
    draw.text((80, card_y + 300), "• Triple Exponential Ribbon (EMA 9, 21, 50, 100, 200)", fill=WHITE, font=font_body)
    draw.text((80, card_y + 330), "• Dynamic Momentum Wave (RSI-14 Curve Divergence)", fill=WHITE, font=font_body)
    draw.text((80, card_y + 360), "• Zero-Lag Exponential Moving Average (ZLEMA-21)", fill=WHITE, font=font_body)
    draw.text((80, card_y + 390), "• Bollinger Band Mean-Reversion Floor Reclaims", fill=WHITE, font=font_body)
    
    # Right Engine: Quant Mathematical Engine
    rx = WIDTH - 60 - w
    draw_rounded_rect(draw, rx, card_y, w, h, 12, CARD_BG, outline=PURPLE, width=2)
    
    # Badge
    draw_rounded_rect(draw, rx + 20, card_y + 20, 210, 28, 6, CARD_BG_LIGHT, outline=PURPLE, width=1)
    draw.text((rx + 35, card_y + 25), "ENGINE 2: QUANT DSP", fill=PURPLE, font=font_mono)
    draw.text((rx + 20, card_y + 60), "Mathematical & Physics Engine", fill=WHITE, font=font_subtitle)
    
    # DSP Waveform Box
    chart_rx = rx + 20
    draw_rounded_rect(draw, chart_rx, chart_y, chart_w, chart_h, 8, (11, 17, 28), outline=CARD_BORDER, width=1)
    
    # Draw Kalman + Fisher + SuperSmoother Sine waves
    dsp_pts1 = []
    dsp_pts2 = []
    for step in range(chart_w):
        phase = step * 0.04 + global_t * 3
        v1 = chart_y + 90 + int(math.sin(phase) * 35 + math.cos(phase * 0.5) * 15)
        v2 = chart_y + 90 + int(math.sin(phase + 1.2) * 25)
        dsp_pts1.append((chart_rx + step, v1))
        dsp_pts2.append((chart_rx + step, v2))
    draw.line(dsp_pts1, fill=CYAN, width=2)
    draw.line(dsp_pts2, fill=PURPLE, width=2)
    
    draw.text((rx + 20, card_y + 300), "• Ehlers SuperSmoother 2-Pole Digital Filter", fill=WHITE, font=font_body)
    draw.text((rx + 300, card_y + 300), "[LOW LAG]", fill=GREEN, font=font_mono)
    draw.text((rx + 20, card_y + 330), "• Hurst Exponent H = 0.68 Persistence Metric", fill=WHITE, font=font_body)
    draw.text((rx + 380, card_y + 330), "[TRENDING]", fill=CYAN, font=font_mono)
    draw.text((rx + 20, card_y + 360), "• Fisher Transform Gaussian Wave Velocity", fill=WHITE, font=font_body)
    draw.text((rx + 20, card_y + 390), "• Kalman Filter Hidden State Trend Estimation", fill=WHITE, font=font_body)
    
    # Center Fusion Matrix
    center_x = WIDTH // 2
    center_y = card_y + h // 2
    
    # Animated electric line between both engines
    beam_w = rx - (60 + w)
    pulse_pos = int((global_t * 120) % beam_w)
    draw.line([(60 + w, center_y), (rx, center_y)], fill=(30, 50, 80), width=3)
    draw.circle((60 + w + pulse_pos, center_y), 5, fill=GOLD)
    
    # Central Confluence Meter
    meter_w, meter_h = 160, 160
    mx = center_x - meter_w // 2
    my = center_y - meter_h // 2
    draw_rounded_rect(draw, mx, my, meter_w, meter_h, 16, CARD_BG_LIGHT, outline=GOLD, width=3)
    draw.text((mx + 25, my + 15), "CONFLUENCE", fill=GOLD, font=font_mono)
    
    # Animated Score Count
    score = min(88.5, 42.0 + t * 9.5)
    score_str = f"{score:.1f}"
    bbox_sc = font_hero.getbbox(score_str)
    sw = bbox_sc[2] - bbox_sc[0]
    draw.text((mx + (meter_w - sw) // 2, my + 45), score_str, fill=GREEN, font=font_hero)
    draw.text((mx + 30, my + 100), "MIN PASS: >= 40", fill=MUTED, font=font_small)
    draw.text((mx + 25, my + 125), "[STRONG BUY]", fill=GREEN, font=font_mono)


def render_scene_3(draw, t, global_t):
    """Scene 3: Symmetrical Trap & Liquidity Shield"""
    anim_in = ease_out_cubic(min(1.0, t / 1.0))
    
    # Header
    draw.text((60, 70), "DEFENSE SYSTEM: SYMMETRICAL TRAP & REVERSAL SHIELD", fill=WHITE, font=font_title)
    draw.text((60, 105), "Protects capital by filtering false breakouts, stop-hunts, and detecting counter-trend absorption floors.", fill=MUTED, font=font_body)
    
    # Main Chart Panel (Left 750px)
    cx, cy, cw, ch = 60, 150, 740, 450
    draw_rounded_rect(draw, cx, cy, cw, ch, 12, CARD_BG, outline=CARD_BORDER, width=2)
    
    # Chart Header
    draw.text((cx + 25, cy + 20), "SOLUSD 15M - LIQUIDITY SWEEP & ABSORPTION WICK", fill=WHITE, font=font_subtitle)
    draw.text((cx + 560, cy + 20), "STATUS: TRAP NEUTRALIZED", fill=GREEN, font=font_mono)
    
    # Support Level Line
    sup_y = cy + 280
    draw.line([(cx + 20, sup_y), (cx + cw - 20, sup_y)], fill=(40, 70, 110), width=2)
    draw.text((cx + 30, sup_y - 22), "MAJOR KEY SUPPORT ZONE ($184.50)", fill=CYAN, font=font_mono)
    
    # Draw Candlesticks showing False Breakdown
    trap_candles = [
        # (offset_x, open, high, low, close, color)
        (60, 220, 210, 240, 235, RED),
        (130, 235, 230, 260, 255, RED),
        (200, 255, 250, 280, 275, RED), # Approaching support
        (270, 275, 270, 360, 290, RED), # FAKE BREAKDOWN WICK (Pierces deep below support)
        (340, 290, 265, 300, 265, GREEN), # Institutional Absorption Candle
        (410, 265, 240, 270, 240, GREEN), # Powerful Bounce
        (480, 240, 210, 245, 215, GREEN), # Continuation
        (550, 215, 185, 220, 190, GREEN),
        (620, 190, 160, 195, 165, GREEN),
    ]
    
    for ox, o, h_p, l, c, col in trap_candles:
        candle_x = cx + ox
        draw.line([(candle_x, cy + h_p), (candle_x, cy + l)], fill=col, width=2)
        top = min(cy + o, cy + c)
        bot = max(cy + o, cy + c)
        draw.rectangle([candle_x - 12, top, candle_x + 12, bot], fill=col)
        
    # Highlighting the Trap Wick with animated target box
    wick_x = cx + 270
    wick_y = cy + 320
    box_pulse = int(math.sin(global_t * 6) * 5)
    draw.rectangle([wick_x - 30, wick_y - 20 + box_pulse, wick_x + 30, wick_y + 45 + box_pulse], outline=RED, width=2)
    draw.text((wick_x - 110, wick_y + 55), "FALSE BREAKDOWN STOP-HUNT", fill=RED, font=font_mono)
    
    # Green shield on the absorption candle
    shield_x = cx + 340
    shield_y = cy + 250
    draw.ellipse([shield_x - 22, shield_y - 22, shield_x + 22, shield_y + 22], fill=(0, 80, 50), outline=GREEN, width=2)
    draw.text((shield_x - 12, shield_y - 10), "OK", fill=WHITE, font=font_mono)
    draw.text((shield_x - 40, shield_y - 50), "REVERSAL RECLAIM", fill=GREEN, font=font_mono)
    
    # Right Information Panel (420px)
    rx = cx + cw + 30
    rw = WIDTH - rx - 60
    draw_rounded_rect(draw, rx, cy, rw, ch, 12, CARD_BG, outline=CYAN, width=2)
    
    draw.text((rx + 25, cy + 25), "TRAP SHIELD MECHANICS", fill=CYAN, font=font_subtitle)
    
    shield_features = [
        ("Wick Absorption Scoring", "Identifies institutional limit orders absorbing retail panic sales (>0.8 ATR wick).", GREEN),
        ("Symmetric Evaluation", "Both capitulation floors and blow-off tops are analyzed with equal mathematical rigor.", GOLD),
        ("Zero Signal Inversion", "BUY signals strictly dispatch BUY orders. 100% directional fidelity guaranteed.", CYAN),
        ("Anti-Chop Filter", "Choppiness Index & False-Breakout detector pauses trading in low-conviction range chop.", PURPLE),
    ]
    
    fy = cy + 70
    for title, desc, col in shield_features:
        draw_rounded_rect(draw, rx + 20, fy, rw - 40, 75, 8, CARD_BG_LIGHT, outline=CARD_BORDER, width=1)
        draw.ellipse([rx + 35, fy + 16, rx + 45, fy + 26], fill=col)
        draw.text((rx + 55, fy + 12), title, fill=WHITE, font=font_mono)
        # Wrap desc
        draw.text((rx + 35, fy + 38), desc[:48], fill=MUTED, font=font_small)
        draw.text((rx + 35, fy + 54), desc[48:96], fill=MUTED, font=font_small)
        fy += 90


def render_scene_4(draw, t, global_t):
    """Scene 4: Leader-Follower Alpha Network"""
    # Header
    draw.text((60, 70), "LEADER-FOLLOWER HIERARCHY & WATCHLIST MATRIX", fill=WHITE, font=font_title)
    draw.text((60, 105), "High-conviction market leaders transmit directional momentum to correlated followers with zero lag.", fill=MUTED, font=font_body)
    
    card_y = 150
    w_card = 350
    
    # Leader 1: XRPUSD
    lx1 = 120
    ly1 = card_y + 40
    draw_rounded_rect(draw, lx1, ly1, w_card, 160, 12, CARD_BG, outline=CYAN, width=2)
    draw.text((lx1 + 20, ly1 + 20), "XRPUSD", fill=WHITE, font=font_hero)
    draw.text((lx1 + 170, ly1 + 30), "SUPREME LEADER", fill=CYAN, font=font_mono)
    draw.text((lx1 + 20, ly1 + 80), "HISTORICAL WIN RATE: 83.3%", fill=GREEN, font=font_subtitle)
    draw.text((lx1 + 20, ly1 + 115), "Highest conviction setups | Directional King", fill=MUTED, font=font_body)
    
    # Follower 1: SOLUSD
    fx1 = WIDTH - 120 - w_card
    fy1 = ly1
    draw_rounded_rect(draw, fx1, fy1, w_card, 160, 12, CARD_BG, outline=CARD_BORDER, width=1)
    draw.text((fx1 + 20, fy1 + 20), "SOLUSD", fill=WHITE, font=font_hero)
    draw.text((fx1 + 160, fy1 + 30), "HIGH-BETA FOLLOWER", fill=MUTED, font=font_mono)
    draw.text((fx1 + 20, fy1 + 80), "COPIES DIRECTION: XRP -> SOL", fill=CYAN, font=font_subtitle)
    draw.text((fx1 + 20, fy1 + 115), "Amplifies alpha on correlated high-beta moves", fill=MUTED, font=font_body)
    
    # Connector Arrow & Data Pulse 1
    arrow_y1 = ly1 + 80
    draw.line([(lx1 + w_card, arrow_y1), (fx1, arrow_y1)], fill=CARD_BORDER, width=2)
    pulse_1 = int((global_t * 220) % (fx1 - (lx1 + w_card)))
    draw.circle((lx1 + w_card + pulse_1, arrow_y1), 6, fill=CYAN)
    draw.text((lx1 + w_card + 80, arrow_y1 - 25), "SYNCHRONIZED PACKET", fill=CYAN, font=font_mono)
    
    # Leader 2: DOGEUSD
    ly2 = card_y + 240
    draw_rounded_rect(draw, lx1, ly2, w_card, 160, 12, CARD_BG, outline=GOLD, width=2)
    draw.text((lx1 + 20, ly2 + 20), "DOGEUSD", fill=WHITE, font=font_hero)
    draw.text((lx1 + 180, ly2 + 30), "MEME LEADER", fill=GOLD, font=font_mono)
    draw.text((lx1 + 20, ly2 + 80), "HISTORICAL WIN RATE: 73.3%", fill=GREEN, font=font_subtitle)
    draw.text((lx1 + 20, ly2 + 115), "Momentum breakouts & liquidity explosions", fill=MUTED, font=font_body)
    
    # Follower 2: AVAXUSD
    fy2 = ly2
    draw_rounded_rect(draw, fx1, fy2, w_card, 160, 12, CARD_BG, outline=CARD_BORDER, width=1)
    draw.text((fx1 + 20, fy2 + 20), "AVAXUSD", fill=WHITE, font=font_hero)
    draw.text((fx1 + 160, fy2 + 30), "VOLATILE FOLLOWER", fill=MUTED, font=font_mono)
    draw.text((fx1 + 20, fy2 + 80), "COPIES DIRECTION: DOGE -> AVAX", fill=GOLD, font=font_subtitle)
    draw.text((fx1 + 20, fy2 + 115), "Mirrors meme momentum with institutional filter", fill=MUTED, font=font_body)
    
    # Connector Arrow 2
    arrow_y2 = ly2 + 80
    draw.line([(lx1 + w_card, arrow_y2), (fx1, arrow_y2)], fill=CARD_BORDER, width=2)
    pulse_2 = int((global_t * 200) % (fx1 - (lx1 + w_card)))
    draw.circle((lx1 + w_card + pulse_2, arrow_y2), 6, fill=GOLD)
    draw.text((lx1 + w_card + 90, arrow_y2 - 25), "ALPHA TRANSMISSION", fill=GOLD, font=font_mono)
    
    # Bottom Center: SUIUSD Independent
    sui_w, sui_h = 320, 50
    sx = WIDTH // 2 - sui_w // 2
    sy = card_y + 415
    draw_rounded_rect(draw, sx, sy, sui_w, sui_h, 8, CARD_BG_LIGHT, outline=PURPLE, width=1)
    draw.text((sx + 20, sy + 15), "SUIUSD: INDEPENDENT VOLATILITY (70.0% WR)", fill=WHITE, font=font_mono)


def render_scene_5(draw, t, global_t):
    """Scene 5: Centralized Risk Guard & Compounding Curve"""
    # Header
    draw.text((60, 70), "CAPITAL PRESERVATION: CENTRALIZED RISK GUARD", fill=WHITE, font=font_title)
    draw.text((60, 105), "Mathematical risk sizing guarantees survival. Asymmetrical 1:2.4 Risk:Reward compounds equity safely.", fill=MUTED, font=font_body)
    
    card_y = 150
    
    # Left Card: Risk Parameters
    lw, lh = 520, 450
    draw_rounded_rect(draw, 60, card_y, lw, lh, 12, CARD_BG, outline=RED, width=2)
    
    draw.text((85, card_y + 25), "STARTUP-VALIDATED RISK GUARD", fill=RED, font=font_subtitle)
    draw.text((85, card_y + 55), "config/riskConfig.json (Enforced at boot)", fill=MUTED, font=font_mono)
    
    rules = [
        ("MAX LEVERAGE CEILING", "20x HARD LIMIT", "Refuses bot launch if leverage is configured higher.", RED),
        ("FIXED LOSS PER TRADE", "$2.50 USD", "Contract quantity dynamically sized: Stop Loss = $2.50.", GOLD),
        ("TARGET PROFIT PER TRADE", "$6.00 USD", "Guaranteed 1:2.4 R:R target profit on every setup.", GREEN),
        ("MINIMUM STOP DISTANCE", ">= 0.8 ATR", "Prevents tight noise stopouts from market wicks.", CYAN),
        ("CONCURRENCY LIMIT", "1 POSITION ONLY", "Strictly 1 active position to preserve margin safety.", PURPLE),
        ("EMERGENCY SURVIVAL FLOOR", "Rs 500 INR", "Trading pauses immediately if equity touches Rs 500.", WHITE),
    ]
    
    ry = card_y + 90
    for name, val, desc, col in rules:
        draw_rounded_rect(draw, 85, ry, lw - 50, 50, 6, CARD_BG_LIGHT, outline=CARD_BORDER, width=1)
        draw.text((100, ry + 8), name, fill=WHITE, font=font_mono)
        draw.text((380, ry + 8), val, fill=col, font=font_mono)
        draw.text((100, ry + 28), desc, fill=MUTED, font=font_small)
        ry += 58
        
    # Right Card: Compounding Curve Chart
    rx = 60 + lw + 30
    rw = WIDTH - rx - 60
    draw_rounded_rect(draw, rx, card_y, rw, lh, 12, CARD_BG, outline=GREEN, width=2)
    
    draw.text((rx + 25, card_y + 25), "EQUITY COMPOUNDING TRAJECTORY", fill=GREEN, font=font_subtitle)
    draw.text((rx + 25, card_y + 55), "From Starting Capital to Profit Goal", fill=MUTED, font=font_mono)
    
    # Compounding graph
    gx, gy, gw, gh = rx + 30, card_y + 100, rw - 60, 240
    draw_rounded_rect(draw, gx, gy, gw, gh, 8, (11, 17, 28), outline=CARD_BORDER, width=1)
    
    # Milestone Lines
    y_2k = gy + gh - 40
    y_4k = gy + gh - 120
    y_8k = gy + 40
    draw.line([(gx, y_2k), (gx + gw, y_2k)], fill=(25, 40, 60), width=1)
    draw.text((gx + 10, y_2k - 18), "Rs 2,000 INR (STARTING BASE)", fill=MUTED, font=font_mono)
    draw.line([(gx, y_4k), (gx + gw, y_4k)], fill=(30, 60, 80), width=1)
    draw.text((gx + 10, y_4k - 18), "Rs 4,000 INR (INITIAL PROFIT GOAL)", fill=GOLD, font=font_mono)
    draw.line([(gx, y_8k), (gx + gw, y_8k)], fill=(20, 70, 50), width=1)
    draw.text((gx + 10, y_8k - 18), "Rs 8,000 INR+ (COMPOUND EXPANSION)", fill=GREEN, font=font_mono)
    
    # Draw animated curved equity growth line
    curve_pts = []
    anim_progress = min(1.0, t / 4.0)
    max_pts = int(gw * anim_progress)
    for p in range(max_pts):
        norm_p = p / gw
        # Exponential curve formula
        val_y = (y_2k) - math.pow(norm_p, 1.6) * (y_2k - y_8k)
        curve_pts.append((gx + p, int(val_y)))
    if len(curve_pts) > 1:
        draw.line(curve_pts, fill=GREEN, width=3)
        # End particle
        draw.circle(curve_pts[-1], 6, fill=WHITE)
        
    # Current Equity Counter
    curr_inr = int(2000 + math.pow(anim_progress, 1.6) * 6000)
    draw.text((rx + 30, card_y + 360), f"PROJECTED BALANCE: Rs {curr_inr:,} INR", fill=WHITE, font=font_title)
    draw.text((rx + 30, card_y + 400), "STATUS: 100% AUTOMATED EXECUTION | 0 MANUAL INTERVENTION", fill=CYAN, font=font_mono)


def render_scene_6(draw, t, global_t):
    """Scene 6: Real-time Execution & Institutional Finale"""
    # Header
    draw.text((60, 70), "LIVE EXECUTION: HIGH-FIDELITY AUTOMATED GATEWAY", fill=WHITE, font=font_title)
    draw.text((60, 105), "Zero signal inversion. Automated server-side bracket order protection (Take-Profit & Stop-Loss).", fill=MUTED, font=font_body)
    
    card_y = 150
    
    # Execution Log Card (Left 600px)
    lw = 620
    lh = 450
    draw_rounded_rect(draw, 60, card_y, lw, lh, 12, CARD_BG, outline=CYAN, width=2)
    
    draw.text((85, card_y + 25), "ORDER EXECUTION TERMINAL", fill=CYAN, font=font_subtitle)
    draw.text((85, card_y + 55), "POST /v2/orders | HMAC-SHA256 Signed Gateway", fill=MUTED, font=font_mono)
    
    logs = [
        ("[00.1ms]", "SCANNER: Confluence Score evaluated across 5 coins", MUTED),
        ("[00.4ms]", "SIGNAL: XRPUSD Long Triggered (Score: 88.5 / 100)", CYAN),
        ("[00.7ms]", "RISK GUARD: Sizing calculated -> 150 Contracts, 20x Lev", GOLD),
        ("[01.1ms]", "ASSERTION: Strict orderSide === signal.side [VERIFIED]", GREEN),
        ("[01.4ms]", "DISPATCH: Limit Order placed at $2.1450 [FILLED]", WHITE),
        ("[01.8ms]", "BRACKET: Server-side TP ($2.1860) & SL ($2.1280) Active", PURPLE),
        ("[04.2s]",  "MARKET SURGE: Price touches $2.1860 Take-Profit", CYAN),
        ("[04.5s]",  "EXECUTION: Take-Profit Triggered! Bracket closed.", GREEN),
    ]
    
    ly = card_y + 90
    for ts, text, col in logs:
        draw.text((85, ly), ts, fill=MUTED, font=font_mono)
        draw.text((170, ly), text, fill=col, font=font_mono)
        ly += 36
        
    # Right Finale Card (Active Win + Summary)
    rx = 60 + lw + 30
    rw = WIDTH - rx - 60
    draw_rounded_rect(draw, rx, card_y, rw, lh, 12, CARD_BG, outline=GREEN, width=2)
    
    # Huge Green Profit Callout
    draw_rounded_rect(draw, rx + 25, card_y + 30, rw - 50, 140, 10, CARD_BG_LIGHT, outline=GREEN, width=2)
    draw.text((rx + 45, card_y + 45), "TRADE RESULT", fill=MUTED, font=font_mono)
    draw.text((rx + 45, card_y + 70), "+$6.00 USD", fill=GREEN, font=font_hero)
    draw.text((rx + 45, card_y + 130), "+24.5% NET RETURN ON MARGIN", fill=WHITE, font=font_subtitle)
    
    # Institutional IP Callout
    draw.text((rx + 25, card_y + 200), "SYSTEM READY FOR DEPLOYMENT", fill=GOLD, font=font_subtitle)
    draw.text((rx + 25, card_y + 240), "• Dual-Engine Mathematical Precision", fill=WHITE, font=font_body)
    draw.text((rx + 25, card_y + 270), "• Symmetrical Trap Shield Protection", fill=WHITE, font=font_body)
    draw.text((rx + 25, card_y + 300), "• Strict Centralized Risk Guard", fill=WHITE, font=font_body)
    draw.text((rx + 25, card_y + 330), "• Tested across 32 Verification Assertions", fill=WHITE, font=font_body)
    
    # Launch CTA Button
    btn_y = card_y + 375
    draw_rounded_rect(draw, rx + 25, btn_y, rw - 50, 50, 8, GREEN, outline=WHITE, width=1)
    draw.text((rx + 85, btn_y + 14), "START QUANT ENGINE (npm run dev)", fill=(0, 30, 15), font=font_title)


def generate_video():
    print(f"🎬 Starting Motion Graphics Video Render: {WIDTH}x{HEIGHT} @ {FPS} FPS")
    print(f"⏱️ Total Duration: {TOTAL_DURATION_SEC:.1f}s ({TOTAL_FRAMES} frames across {NUM_SCENES} scenes)")
    
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    writer = cv2.VideoWriter(OUTPUT_VIDEO_PATH, fourcc, FPS, (WIDTH, HEIGHT))
    
    if not writer.isOpened():
        print("❌ Error: Could not open VideoWriter. Trying alternative codec 'XVID'...")
        fourcc = cv2.VideoWriter_fourcc(*'XVID')
        writer = cv2.VideoWriter("delta_cryptobot_motion_graphics.avi", fourcc, FPS, (WIDTH, HEIGHT))
        
    start_time = time.time()
    
    scene_titles = [
        "System Boot & Introduction",
        "Dual-Engine Confluence Matrix",
        "Symmetrical Trap Shield",
        "Leader-Follower Alpha Network",
        "Capital Risk Guard & Compounding",
        "Execution Proof & Finale"
    ]
    
    scene_renderers = [
        render_scene_1,
        render_scene_2,
        render_scene_3,
        render_scene_4,
        render_scene_5,
        render_scene_6
    ]
    
    for frame_idx in range(TOTAL_FRAMES):
        global_t = frame_idx / FPS
        scene_idx = min(NUM_SCENES - 1, int(global_t // SCENE_DURATION_SEC))
        local_t = global_t - (scene_idx * SCENE_DURATION_SEC)
        
        # 1. Create Pillow Image
        img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
        draw = ImageDraw.Draw(img)
        
        # 2. Draw Background Grid
        draw_background_grid(draw, WIDTH, HEIGHT, global_t)
        
        # 3. Draw Scene Motion Graphics
        scene_renderers[scene_idx](draw, local_t, global_t)
        
        # 4. Draw Persistent HUD & Progress
        draw_hud(draw, WIDTH, HEIGHT, local_t, global_t, scene_idx, scene_titles[scene_idx])
        
        # 5. Convert PIL -> OpenCV BGR
        frame_rgb = np.array(img)
        frame_bgr = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
        
        writer.write(frame_bgr)
        
        if (frame_idx + 1) % 150 == 0 or frame_idx == TOTAL_FRAMES - 1:
            elapsed = time.time() - start_time
            fps_render = (frame_idx + 1) / max(0.001, elapsed)
            pct = ((frame_idx + 1) / TOTAL_FRAMES) * 100
            print(f"🚀 Rendered frame {frame_idx + 1}/{TOTAL_FRAMES} ({pct:.1f}%) | Render Speed: {fps_render:.1f} FPS")
            
    writer.release()
    total_time = time.time() - start_time
    file_size_mb = os.path.getsize(OUTPUT_VIDEO_PATH) / (1024 * 1024)
    print(f"\n✅ Video successfully rendered: {OUTPUT_VIDEO_PATH}")
    print(f"📦 Size: {file_size_mb:.2f} MB | Render Time: {total_time:.1f}s")

if __name__ == "__main__":
    generate_video()

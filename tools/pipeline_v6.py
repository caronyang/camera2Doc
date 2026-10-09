"""
pipeline_v6.py —— 針對手機實測回饋的修正（Python 階段，先不碰原生）

v5 問題（實測）:
  [P1] 原色整體太亮、淡字被洗白
       v5: gain = clamp(255/bg, 1, 2.4) 對本來就亮的照片強行提亮到 255
  [P2] 原色紅字發灰（飽和度流失）
       v5: 三通道乘同一 gain 後，R 通道撞 255 被截斷，G/B 續漲 -> 紅變粉/灰
  [P3] 影印細字太淡
       v5: 白點 250/濃曲線不足 + 墨跡 blend 0.6/cap85 太保守

v6 修正:
  [F1] 提亮目標改 245 且「只在暗於目標時提亮」-> 亮照片不再過曝
  [F2] 逐像素防截斷增益 g = min(gain_field, 255/max(R,G,B)) -> 零色調流失（色相+飽和度都保留）
  [F3] 影印白點 250 歸一化 + 曲線中段更深 + 墨跡 blend 0.75 / cap 70
  [F4] unsharp 改 sigma 1.2（強化細筆畫）strength 提升
"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline_v5 import decode_rotated, detect, estimate_bg  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out_v6")

# ---------------- v6 曲線 ----------------

def _s_curve_v6():
    # 中段壓更深（細字變黑），淺灰仍推白；兩端壓縮
    xs = [0, 50, 90, 120, 150, 180, 205, 232, 255]
    ys = [0, 20, 42, 74, 120, 168, 218, 248, 255]
    lut = np.zeros(256, np.uint8)
    for v in range(256):
        i = 0
        while i < len(xs) - 2 and xs[i + 1] <= v:
            i += 1
        span = max(xs[i + 1] - xs[i], 1)
        t = min(max((v - xs[i]) / span, 0.0), 1.0)
        lut[v] = min(255, int(round(ys[i] + (ys[i + 1] - ys[i]) * t)))
    return lut


_S6 = _s_curve_v6()


# ---------------- 原色 v6 ----------------

def color_v6(bgr):
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    bg = estimate_bg(gray)
    # F1: 目標 245（留 headroom），只提亮不壓暗
    gain_field = np.clip(245.0 / bg, 1.0, 1.8).astype(np.float32)

    f = bgr.astype(np.float32)
    mx = np.maximum(np.maximum(f[..., 0], f[..., 1]), f[..., 2])
    # F2: 逐像素防截斷 -> 任何通道都不會撞 255 而流失色調
    head = np.where(mx > 1.0, 255.0 / np.maximum(mx, 1.0), 2.0)
    g = np.minimum(gain_field, head).astype(np.float32)
    out = np.clip(f * g[..., None], 0, 255).astype(np.uint8)

    # 紙面消彩：僅對真正近中性且很亮的像素（門檻收緊，避免碰到淡紅字/淡彩墨）
    hsv = cv2.cvtColor(out, cv2.COLOR_BGR2HSV).astype(np.float32)
    paper = (hsv[..., 2] > 205) & (hsv[..., 1] < 45)
    hsv[..., 1] = np.where(paper, hsv[..., 1] * 0.35, hsv[..., 1])
    out = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2BGR)

    # 亮度域 unsharp：sigma 1.2 強化細筆畫；delta 等量加三通道（色相不動）
    f2 = out.astype(np.float32)
    luma = 0.299 * f2[..., 2] + 0.587 * f2[..., 1] + 0.114 * f2[..., 0]
    b = cv2.GaussianBlur(luma, (0, 0), 1.2)
    delta = (luma - b) * 0.9
    for c in range(3):
        f2[..., c] = np.clip(f2[..., c] + delta, 0, 255)
    return f2.astype(np.uint8)


# ---------------- 影印 v6 ----------------

def copy_v6(bgr):
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    # F3: 以 97 分位白點歸一化（紙面 -> 250），比 gain 場更適合影印
    white = float(np.percentile(gray, 97))
    gain = 250.0 / max(white, 80.0)
    norm = np.clip(gray.astype(np.float32) * gain, 0, 250.0).astype(np.uint8)

    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    eq = clahe.apply(norm)
    toned = cv2.LUT(eq, _S6)

    # 墨跡軟填充：不做膨脹（筆畫不變粗），混合提高 -> 細字更實
    ink = (toned < 160).astype(np.uint8) * 255
    alpha = (cv2.GaussianBlur(ink, (0, 0), 1.2).astype(np.float32) / 255.0) * 0.75
    tf = toned.astype(np.float32)
    toned = np.clip(tf * (1 - alpha) + np.minimum(tf, 70.0) * alpha, 0, 255).astype(np.uint8)

    blur = cv2.GaussianBlur(toned, (0, 0), 1.2)
    sharp = np.clip(toned.astype(np.float32) * 2.2 - blur.astype(np.float32) * 1.2, 0, 255).astype(np.uint8)
    return cv2.cvtColor(sharp, cv2.COLOR_GRAY2BGR)


# ---------------- 執行 + 指標 ----------------

def simulate_bright(bgr, gamma=0.75):
    """模擬室內強光/曝光過度的拍攝（gamma<1 = 提亮）"""
    lut = np.array([min(255, int(round(255 * (i / 255.0) ** gamma))) for i in range(256)], np.uint8)
    return cv2.LUT(bgr, lut)


# ---------------- 影印 v7（合併 v5 的增益場 + v6 的深曲線/強填充） ----------------

def copy_v7(bgr):
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    # 逐像素背景增益（壓平光照漸變/陰影）—— 這是 v5 在新文件上勝過 v6 的關鍵
    bg = estimate_bg(gray)
    gain = np.clip(255.0 / bg, 1.0, 2.4).astype(np.float32)
    norm = np.clip(gray.astype(np.float32) * gain, 0, 255).astype(np.uint8)

    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    eq = clahe.apply(norm)
    toned = cv2.LUT(eq, _S6)  # v6 深曲線（中段更壓）

    # 墨跡軟填充：不膨脹（筆畫不變粗），混合提高 -> 細字更實
    ink = (toned < 160).astype(np.uint8) * 255
    alpha = (cv2.GaussianBlur(ink, (0, 0), 1.2).astype(np.float32) / 255.0) * 0.75
    tf = toned.astype(np.float32)
    toned = np.clip(tf * (1 - alpha) + np.minimum(tf, 70.0) * alpha, 0, 255).astype(np.uint8)

    blur = cv2.GaussianBlur(toned, (0, 0), 1.2)
    sharp = np.clip(toned.astype(np.float32) * 2.2 - blur.astype(np.float32) * 1.2, 0, 255).astype(np.uint8)
    return cv2.cvtColor(sharp, cv2.COLOR_GRAY2BGR)


def metrics(bgr, is_color):
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    p85 = float(np.percentile(g, 85))
    ink = g[g < 110]
    ink_mean = float(ink.mean()) if len(ink) else -1
    sharp = float(cv2.Laplacian(g, cv2.CV_32F).var())
    extra = ""
    if is_color:
        b = bgr[..., 0].astype(int); gg = bgr[..., 1].astype(int); r = bgr[..., 2].astype(int)
        m = (r > 110) & (r - b > 40) & (r - gg > 30)
        if m.sum() > 200:
            sat = (r[m] - np.minimum(gg[m], b[m])).mean()
            extra = f" red_sat={sat:.0f} (n={int(m.sum())})"
    return f"p85={p85:.0f} ink_mean={ink_mean:.0f} sharp={sharp:.0f}{extra}"


def warp_flat(path):
    corners = detect(decode_rotated(path, 1024))
    full = decode_rotated(path, 3200)
    h, w = full.shape[:2]
    src = corners * np.array([w, h], np.float32)
    tl, tr, br, bl = src
    W = int((np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2)
    H = int((np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2)
    M = cv2.getPerspectiveTransform(src, np.array([[0, 0], [W, 0], [W, H], [0, H]], np.float32))
    return cv2.warpPerspective(full, M, (W, H))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    test_dir = r"D:\AI_tool\opencode\camera2Doc\TEST_IMAGE"
    files = sorted(f for f in os.listdir(test_dir) if f.lower().endswith((".jpg", ".jpeg", ".png")))
    for fname in files:
        tag = os.path.splitext(fname)[0].replace("IMG_", "")
        flat = warp_flat(os.path.join(test_dir, fname))
        for variant, img in [("normal", flat), ("bright", simulate_bright(flat, 0.72))]:
            c6 = color_v6(img)
            k6 = copy_v7(img)
            print(f"{tag}[{variant}] COLOR {metrics(c6, True)}")
            print(f"{tag}[{variant}] COPY  {metrics(k6, False)}")
            cv2.imwrite(os.path.join(OUT, f"{tag}_{variant}_color_v6.jpg"), c6, [cv2.IMWRITE_JPEG_QUALITY, 93])
            cv2.imwrite(os.path.join(OUT, f"{tag}_{variant}_copy_v6.jpg"), k6, [cv2.IMWRITE_JPEG_QUALITY, 93])

"""
pipeline_v5.py —— 算法實驗（僅用 TEST_IMAGE 迭代，不動 Android/iOS）

v5 針對使用者回饋的三個問題：
  [P1] 影印文字不夠黑不够清晰
       -> 新方案：強 CLAHE + S 型 tone curve + 「墨跡擴增」（軟 mask 把字周边壓黑加粗）
  [P2] 原色文字不夠清晰
       -> 新方案：亮度域強 unsharp（delta 等量加三通道，色相零變動）
  [P3] 原色紅字變藍（灰世界 WB 被背景污染 -> B 通道被拉高）
       -> 撤除 gray-world WB；改用 HSV「紙面消彩」：只對 亮&低飽和 的紙面像素降飽和
          （黃cast/藍cast消失），高飽和像素（紅字）完全不動
"""
import math
import os
import sys

import cv2
import numpy as np

# ---------------- 基礎（與已驗證 v3b 相同） ----------------

def decode_rotated(path, max_dim):
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError(path)
    h, w = img.shape[:2]
    scale = 1.0
    while max(w, h) / scale > max_dim:
        scale *= 2
    if scale > 1:
        img = cv2.resize(img, (int(w / scale), int(h / scale)), interpolation=cv2.INTER_AREA)
    return img


def order_corners(pts):
    s = pts[:, 0] + pts[:, 1]
    d = pts[:, 0] - pts[:, 1]
    return np.array([pts[np.argmin(s)], pts[np.argmax(d)], pts[np.argmax(s)], pts[np.argmin(d)]], np.float32)


def detect(img):
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.medianBlur(gray, 5)
    edges = cv2.Canny(gray, 50, 150)
    edges = cv2.dilate(edges, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:12]
    for c in contours:
        if cv2.contourArea(c) < w * h * 0.12:
            break
        peri = cv2.arcLength(c, True)
        ap = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(ap) == 4 and cv2.isContourConvex(ap.reshape(-1, 2)):
            return order_corners(ap.reshape(-1, 2).astype(np.float32)) / np.array([w, h], np.float32)
    return None


def estimate_bg(gray):
    h, w = gray.shape
    sw, sh = max(w // 4, 2), max(h // 4, 2)
    small = cv2.resize(gray, (sw, sh), interpolation=cv2.INTER_AREA)
    k = max((min(sw, sh) // 8) | 1, 11)
    small = cv2.medianBlur(small, k)
    bg = cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)
    bg = cv2.GaussianBlur(bg, (0, 0), 12)
    return np.maximum(bg.astype(np.float32), 60.0)


def norm_by_bg(bgr):
    """共同亮度增益：三通道乘同一 g=255/bgY（色相零變動），回傳 8U BGR"""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    bg = estimate_bg(gray)
    g = np.clip(255.0 / bg, 1.0, 2.4)[..., None].astype(np.float32)
    return np.clip(bgr.astype(np.float32) * g, 0, 255).astype(np.uint8)


def unsharp_luma(bgr, sigma=2.0, strength=1.6):
    """亮度域 unsharp：delta 等量加於三通道 -> 色相/飽和完全保留"""
    f = bgr.astype(np.float32)
    luma = 0.299 * f[..., 2] + 0.587 * f[..., 1] + 0.114 * f[..., 0]
    blur = cv2.GaussianBlur(luma, (0, 0), sigma)
    delta = (luma - blur) * (strength - 1.0)
    for c in range(3):
        f[..., c] = np.clip(f[..., c] + delta, 0, 255)
    return f.astype(np.uint8)


# ---------------- v5 影印 ----------------

def _s_curve():
    # 單調 S：暗部(字)壓深、中段拉開、淺灰(皺痕)推白
    xs = [0, 60, 100, 130, 160, 185, 210, 235, 255]
    ys = [0, 28, 55, 92, 150, 195, 232, 252, 255]
    lut = np.zeros(256, np.uint8)
    for v in range(256):
        i = 0
        while i < len(xs) - 2 and xs[i + 1] <= v:
            i += 1
        span = max(xs[i + 1] - xs[i], 1)
        t = min(max((v - xs[i]) / span, 0.0), 1.0)
        lut[v] = min(255, int(round(ys[i] + (ys[i + 1] - ys[i]) * t)))
    return lut


_S_LUT = _s_curve()


def copy_v5(bgr, dilate_px=1, dark_cap=85.0, blend=0.6):
    """最終參數 = v5b（使用者選定：輕填充不加粗）"""
    normed = norm_by_bg(bgr)
    gray = cv2.cvtColor(normed, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    toned = cv2.LUT(gray, _S_LUT)
    # 墨跡軟填充（不膨脹）：羽化 mask 把筆畫灰邊壓黑，筆畫粗細不變
    if blend > 0:
        ink = (toned < 150).astype(np.uint8) * 255
        k = max(dilate_px | 1, 1)
        if k > 1:
            ink = cv2.dilate(ink, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
        alpha = cv2.GaussianBlur(ink, (0, 0), 1.2)[..., None].astype(np.float32) / 255.0 * blend
        tf = toned.astype(np.float32)[..., None]
        toned = (tf * (1 - alpha) + np.minimum(tf, dark_cap) * alpha).astype(np.uint8)
    sharp = unsharp_luma(cv2.cvtColor(toned, cv2.COLOR_GRAY2BGR), sigma=1.5, strength=2.0)
    return cv2.cvtColor(sharp, cv2.COLOR_BGR2GRAY)[:, :, None].repeat(3, 2)


# ---------------- v5 原色 ----------------

def color_v5(bgr):
    normed = norm_by_bg(bgr)  # 共同增益白化（零色偏）
    # 紙面消彩：亮(V>190)且低飽和(S<60)的像素 -> 飽和度打三折
    # 註：紅字(飽和~120)與紅字抗鋸齒邊(~77)都 >60，不會被誤消；黃紙(~36)/藍紙(~16)會被消彩
    hsv = cv2.cvtColor(normed, cv2.COLOR_BGR2HSV).astype(np.float32)
    paper = (hsv[..., 2] > 190) & (hsv[..., 1] < 60)
    sat = hsv[..., 1]
    sat = np.where(paper, sat * 0.35, sat)
    hsv[..., 1] = sat
    out = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2BGR)
    return unsharp_luma(out, sigma=2.0, strength=1.8)  # 文字清晰、色相不動


# ---------------- main ----------------

def run(path, outdir):
    base = os.path.splitext(os.path.basename(path))[0]
    corners = detect(decode_rotated(path, 1024))
    full = decode_rotated(path, 3200)
    if corners is None:
        corners = np.array([[0.06, 0.06], [0.94, 0.06], [0.94, 0.94], [0.06, 0.94]], np.float32)
    h, w = full.shape[:2]
    src = corners * np.array([w, h], np.float32)
    tl, tr, br, bl = src
    W = int((np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2)
    H = int((np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2)
    M = cv2.getPerspectiveTransform(src, np.array([[0, 0], [W, 0], [W, H], [0, H]], np.float32))
    flat = cv2.warpPerspective(full, M, (W, H))

    c5 = copy_v5(flat)
    o5 = color_v5(flat)
    cv2.imwrite(os.path.join(outdir, f"{base}_v5_copy.jpg"), c5, [cv2.IMWRITE_JPEG_QUALITY, 92])
    cv2.imwrite(os.path.join(outdir, f"{base}_v5_color.jpg"), o5, [cv2.IMWRITE_JPEG_QUALITY, 92])

    # 指標
    g5 = cv2.cvtColor(c5, cv2.COLOR_BGR2GRAY)
    print(f"{base}: COPY paper_p85={np.percentile(g5,85):.0f} ink_mean={g5[g5<100].mean() if (g5<100).any() else -1:.0f} "
          f"sharpness_lapvar={cv2.Laplacian(g5, cv2.CV_32F).var():.0f}")
    # 紅字色相檢查
    def redmask(img):
        b = img[..., 0].astype(int); gg = img[..., 1].astype(int); r = img[..., 2].astype(int)
        return (r > 110) & (r - b > 50) & (r - gg > 40)
    m0 = redmask(flat)
    # 用「原始紅字像素座標」直接量輸出（不膨脹，避免白紙像素稀釋），並要求輸出仍紅多於藍
    px_o = flat[m0]; px_5 = o5[m0]
    sat_o = (px_o[:, 2].astype(int) - np.minimum(px_o[:, 1], px_o[:, 0]).astype(int)).mean()
    sat_5 = (px_5[:, 2].astype(int) - np.minimum(px_5[:, 1], px_5[:, 0]).astype(int)).mean()
    rmb = (px_5[:, 2].astype(int) - px_5[:, 0].astype(int)).mean()  # R-B 均差（>0 偏紅, <0 偏藍）
    print(f"{base}: COLOR red px={int(m0.sum())} sat orig={sat_o:.0f} -> v5={sat_5:.0f} R-B={rmb:.0f} "
          f"{'RED-KEEP' if (sat_5 > sat_o * 0.8 and rmb > 30) else 'SHIFT-RISK'} | sharpness={cv2.Laplacian(cv2.cvtColor(o5, cv2.COLOR_BGR2GRAY), cv2.CV_32F).var():.0f}")


if __name__ == "__main__":
    outdir = os.path.dirname(os.path.abspath(__file__)) + os.sep + "out_v5"
    os.makedirs(outdir, exist_ok=True)
    for img in sorted(os.listdir(r"D:\AI_tool\opencode\camera2Doc\TEST_IMAGE")):
        if img.lower().endswith((".jpg", ".png")):
            run(r"D:\AI_tool\opencode\camera2Doc\TEST_IMAGE" + os.sep + img, outdir)

"""影印 ink-boost 強度變體比較：v5(現行) / v5b(輕) / v5c(無擴增)"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline_v5 import decode_rotated, detect, estimate_bg, norm_by_bg, unsharp_luma, _S_LUT

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out_v5")


def copy_variant(bgr, dilate_px=3, dark_cap=60.0, blend=1.0):
    normed = norm_by_bg(bgr)
    gray = cv2.cvtColor(normed, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
    toned = cv2.LUT(gray, _S_LUT)
    if dilate_px > 0 and blend > 0:
        ink = (toned < 150).astype(np.uint8) * 255
        k = max(dilate_px | 1, 1)
        ink = cv2.dilate(ink, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))) if k > 1 else ink
        alpha = cv2.GaussianBlur(ink, (0, 0), 1.2)[..., None].astype(np.float32) / 255.0 * blend
        tf = toned.astype(np.float32)[..., None]
        toned = (tf * (1 - alpha) + np.minimum(tf, dark_cap) * alpha).astype(np.uint8)
    sharp = unsharp_luma(cv2.cvtColor(toned, cv2.COLOR_GRAY2BGR), sigma=1.5, strength=2.0)
    return cv2.cvtColor(sharp, cv2.COLOR_BGR2GRAY)[:, :, None].repeat(3, 2)


def metrics(g):
    dark_ratio = float((g < 100).mean() * 100)  # 暗像素占比%
    return f"ink<100: {dark_ratio:.2f}%  p85={np.percentile(g, 85):.0f}"


paths = [
    ("101821", r"D:\AI_tool\opencode\camera2Doc\TEST_IMAGE\IMG_20261009_101821.jpg"),
    ("101825", r"D:\AI_tool\opencode\camera2Doc\TEST_IMAGE\IMG_20261009_101825.jpg"),
]

variants = {
    "v5a_heavy": dict(dilate_px=3, dark_cap=60.0, blend=1.0),   # 現行 v5
    "v5b_soft": dict(dilate_px=1, dark_cap=85.0, blend=0.6),    # 輕：不膨脹、壓得淺
    "v5c_none": dict(dilate_px=0, dark_cap=60.0, blend=0.0),    # 無墨跡擴增，純曲線
}

for tag, path in paths:
    corners = detect(decode_rotated(path, 1024))
    full = decode_rotated(path, 3200)
    h, w = full.shape[:2]
    src = corners * np.array([w, h], np.float32)
    tl, tr, br, bl = src
    W = int((np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2)
    H = int((np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2)
    M = cv2.getPerspectiveTransform(src, np.array([[0, 0], [W, 0], [W, H], [0, H]], np.float32))
    flat = cv2.warpPerspective(full, M, (W, H))
    for vn, kw in variants.items():
        out = copy_variant(flat, **kw)
        print(f"{tag} {vn:10s} {metrics(cv2.cvtColor(out, cv2.COLOR_BGR2GRAY))}")
        cv2.imwrite(os.path.join(OUT, f"{tag}_{vn}.jpg"), out, [cv2.IMWRITE_JPEG_QUALITY, 92])

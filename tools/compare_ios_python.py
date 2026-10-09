"""
iOS vs Python 逐項數值對比：使用 iOS CI 上 Vision 偵測出的同一組四角，
以 Python 參考實作 (color_v6 / copy_v7) 跑相同影像，比較指標。
用法: python compare_ios_python.py <samplesDir> <iosOutDir> <pythonOutDir>
"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline_v6 import color_v6, copy_v7  # noqa: E402

# CI 日誌中 Vision 偵測的四角（tl,tr,br,bl 歸一化）
CORNERS = {
    "sample1.jpg": [0.118, 0.113, 0.806, 0.074, 0.972, 0.895, 0.056, 0.918],
    "sample2.jpg": [0.174, 0.180, 0.771, 0.160, 0.972, 0.852, 0.042, 0.883],
    "sample3.jpg": [0.153, 0.090, 0.819, 0.062, 0.979, 0.836, 0.042, 0.848],
}

IOS_METRICS = {
    "sample1.jpg": {"original": (243, 73, 2.76), "copy": (255, 45, 11.54)},
    "sample2.jpg": {"original": (252, 82, 4.52), "copy": (255, 30, 10.69)},
    "sample3.jpg": {"original": (249, 62, 5.04), "copy": (255, 21, 8.78)},
}


def metrics(bgr):
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    total = g.size
    p85 = float(np.percentile(g, 85))
    dark = g[g < 110]
    ink_mean = float(dark.mean()) if dark.size else -1
    ink_pct = float((g < 100).sum()) / total * 100
    return p85, ink_mean, ink_pct


def warp(full, corners):
    h, w = full.shape[:2]
    src = np.array(corners, np.float32).reshape(4, 2) * np.array([w, h], np.float32)
    tl, tr, br, bl = src
    W = int(round((np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2))
    H = int(round((np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2))
    M = cv2.getPerspectiveTransform(src, np.array([[0, 0], [W, 0], [W, H], [0, H]], np.float32))
    return cv2.warpPerspective(full, M, (W, H))


def main():
    samples_dir, ios_dir, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out_dir, exist_ok=True)
    print(f"{'file':12s} {'mode':8s} {'platform':7s} {'p85':>5s} {'ink_mean':>8s} {'ink<100%':>8s}")
    for name, corners in CORNERS.items():
        full = cv2.imread(os.path.join(samples_dir, name))
        if full is None:
            print(f"{name}: cannot read")
            continue
        flat = warp(full, corners)
        py = {"original": color_v6(flat), "copy": copy_v7(flat)}
        for mode in ("original", "copy"):
            p85, ink, pct = metrics(py[mode])
            print(f"{name:12s} {mode:8s} {'python':7s} {p85:5.0f} {ink:8.0f} {pct:8.2f}")
            if mode in IOS_METRICS[name]:
                ip85, iink, ipct = IOS_METRICS[name][mode]
                print(f"{name:12s} {mode:8s} {'iOS':7s} {ip85:5.0f} {iink:8.0f} {ipct:8.2f}   "
                      f"(Δp85={p85-ip85:+.0f} Δink={ink-iink:+.0f} Δpct={pct-ipct:+.2f})")
            cv2.imwrite(os.path.join(out_dir, f"{os.path.splitext(name)[0]}_{mode}_python.jpg"),
                        py[mode], [cv2.IMWRITE_JPEG_QUALITY, 94])


if __name__ == "__main__":
    main()

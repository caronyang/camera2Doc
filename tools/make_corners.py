"""產生 tools/ios-verify/corners.json（Android/Python 偵測出的四角，供 iOS 驗證工具回退與交叉核對）"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline_v5 import decode_rotated, detect  # noqa: E402

TEST_DIR = r"D:\AI_tool\opencode\camera2Doc\TEST_IMAGE"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ios-verify", "corners.json")

result = {}
for f in sorted(os.listdir(TEST_DIR)):
    if not f.lower().endswith((".jpg", ".jpeg", ".png")):
        continue
    c = detect(decode_rotated(os.path.join(TEST_DIR, f), 1024))
    if c is None:
        print(f"{f}: detect failed")
        continue
    flat = [round(float(v), 5) for v in np.asarray(c).reshape(-1)]
    result[f] = flat
    print(f"{f}: {flat}")

with open(OUT, "w", encoding="utf-8") as fp:
    json.dump(result, fp, indent=2)
print("written", OUT)

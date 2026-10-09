# Camera2Doc

[![iOS CI](https://github.com/caronyang/camera2Doc/actions/workflows/ios.yml/badge.svg)](https://github.com/caronyang/camera2Doc/actions/workflows/ios.yml)
[![Android CI](https://github.com/caronyang/camera2Doc/actions/workflows/android.yml/badge.svg)](https://github.com/caronyang/camera2Doc/actions/workflows/android.yml)

![platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android-blue)
![Expo SDK](https://img.shields.io/badge/Expo%20SDK-57-000020)
![React Native](https://img.shields.io/badge/React%20Native-0.86-61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6)
![UI](https://img.shields.io/badge/UI-English%20%7C%20%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87-orange)
![license](https://img.shields.io/badge/license-MIT-green)

[English](README.md) | **繁體中文**

## 下載安裝（Android）

**[⬇️ 下載最新 APK](https://github.com/caronyang/camera2Doc/releases/latest)** —— 獨立安裝檔，不需要 Metro 開發伺服器。

* 套件 `com.caron.camera2doc` · `arm64-v8a` · minSdk 24（Android 7 以上）
* 安裝時請允許「安裝未知來源應用程式」；若手機上已有用其他簽名金鑰安裝的版本，請先解除安裝
* APK 以專案正式金鑰簽名，SHA-256 列於 release 說明中

Camera2Doc 是一個手機**文件掃描** App，以 React Native / Expo 加上本地原生模組實作
（Android 用 OpenCV，iOS 用 Vision + CoreImage）。功能刻意保持精簡，只做四件事：

1. **拍照轉文件**（相機拍攝或從相簿匯入）
2. **攤平 + 拉直**成 A4 比例、不歪斜的影像
3. **色調**：`原色`（背景白化、顏色貼近原稿）或 `影印`（影印機般的黑白輸出）
4. **匯出**：單張存成 JPEG 或 PDF；多張合併成**一份 A4 PDF**

<p align="center">
  <img src="screenshot/ertrance.jpg" width="24%" alt="首頁" />
  <img src="screenshot/detection.jpg" width="24%" alt="調整四角" />
  <img src="screenshot/edit.jpg" width="24%" alt="頁面清單與匯出" />
</p>
<p align="center"><em>首頁 · 拖曳四角微調偵測結果 · 頁面清單與一鍵匯出 PDF</em></p>

---

## 功能一覽

| | |
|---|---|
| 拍攝 / 匯入 | `expo-camera` 拍攝、相簿匯入 |
| 自動偵測邊界 | Android：OpenCV 輪廓管線 · iOS：`VNDetectDocumentSegmentationRequest` |
| 手動微調 | 四個可拖曳角點 |
| 攤平 | 透視校正，**單次重採樣**（見下） |
| 拉直 | 以行投影輪廓法搜索主要內容傾角，並**合併進同一次 warp** |
| 原色模式 | 逐像素背景增益場 + 防截斷 + 紙面消彩 + 亮度域銳化 |
| 影印模式 | 增益場歸一化 + 局部對比 + S 曲線 + 羽化墨跡填充 + 銳化 |
| 匯出 | 單張 JPEG／單張 PDF／多頁合併 A4 PDF（純 JS PDF 產生器，JPEG 以 DCTDecode 直接嵌入、不重編碼） |
| 語言 | 英文（預設）／繁體中文，可在 App 內切換並保存 |

輸出解析度：成品長邊最高 **3800 px**（預覽 2800 px），JPEG 品質 94。

---

## 影像管線說明

以下流程在兩個平台上實作一致，並以 Python 參考實作驗證
（`tools/pipeline_v5.py`、`tools/pipeline_v6.py`）。

### 1. 文件偵測

* **Android** — 縮至 1024 px → 灰階 → 中值濾波 → Canny → 膨脹 → `findContours`，
  取覆蓋畫面 > 12 % 的最大凸四邊形。
* **iOS** — Vision 文件分割請求直接回傳文件導向的四角（含文字正向）。

### 2. 攤平 + 拉直：只做一次重採樣

同一張影像重採樣兩次（先 warp 再旋轉）會讓文字明顯變糊，因此把拉直角**直接併入透視變換**：

1. 先攤平一張縮圖，搜索使「行投影輪廓」最集中的角度
   （粗掃 ±12°／步進 0.6°，再以 0.12° 細掃；Android 另以 Hough 長直線候選一起競爭，取分數最高者）。
2. 把**目標矩形旋轉**該角度後做**一次** `warpPerspective`（Android），
   或在 CoreImage 濾鏡鏈中一併旋轉（iOS）。
3. 護欄：角度 < 0.3° 或分數增益 < 1.5 % 時完全不旋轉 —— 不需要時零畫質損失。

### 3. 色調

**原色**（`original`）—— 背景白化但不偏色：

* 背景模型：¼ 解析度大核中值（取紙面亮度，可跳過文字）
* 增益場：`目標 245 / 背景亮度`，限制在 `[1.0, 1.8]`（對已經很亮的照片不再過度提亮）
* **逐像素防截斷**：`g = min(增益場, 255 / max(R, G, B))` —— 保證不會有單一通道先撞 255，
  這正是保住色相與飽和度的關鍵（單純乘同一個增益會讓紅色印刷被截斷成粉／灰）
* 紙面消彩：只有 `V > 205 且 S < 45` 的像素（真正接近純白的紙面）才把飽和度降為 35 %
* 亮度域銳化（σ 1.2、delta 0.9）：強化筆畫但完全不動色相

**影印**（`copy`）—— 影印機般的輸出：

* 增益場歸一化（限制在 `[1.0, 2.4]`）壓平光照漸層與陰影
* CLAHE 3.0 局部對比（Android；iOS 以局部對比處理近似）
* 9 點單調 S 曲線（例如 120 → 74、205 → 218）：壓深筆畫、把淺灰皺痕推白
* **墨跡軟填充**：低於 160 的像素以羽化遮罩壓到 ≤ 70（混合 0.75）——
  文字明顯更黑，但**不做膨脹**（筆畫不會被加粗變形）
* 亮度域銳化（σ 1.2、2.2）提升筆畫清晰度

### 4. 匯出

可選擇置中貼到 A4（1 : √2）白底畫布（預設開啟）。PDF 由一個純 TypeScript 產生器以
`/Filter /DCTDecode` 直接嵌入 JPEG，不重新編碼、不依賴原生套件。

---

## 架構

```
Expo SDK 57 · React Native 0.86 · TypeScript · expo-router
│
├─ src/                      App（TypeScript）
│  ├─ app/                   畫面：首頁 → 拍攝 → 邊界調整 → 色調 → 設定
│  ├─ components/            四角編輯器、UI 元件
│  ├─ lib/                   i18n、PDF 產生器、匯出、原生綁定、資料模型
│  └─ state/                 掃描工作階段狀態（React context）
│
└─ modules/camera2doc/       本地 Expo 原生模組（自動連結，免設定）
   ├─ android/               Kotlin + OpenCV：偵測、複合 warp、濾鏡
   ├─ ios/
   │  ├─ ScannerAlgorithms.swift   純演算法層（不依賴 Expo/UIKit）
   │  └─ Camera2DocModule.swift    Expo 膠水層：Vision 偵測、I/O、呼叫濾鏡
   └─ src/                   TypeScript 綁定
```

iOS 演算法集中在 `ScannerAlgorithms.swift`，因此**同一個檔案**既編譯進 App，
也編譯進 macOS 驗證工具（`tools/ios-verify/main.swift`）—— CI 驗證的程式碼就是上線的程式碼。

---

## 開發環境

### 需求

* Node.js 22+
* Android：Android Studio（SDK 36、build-tools 36）、JDK 17+
* iOS：macOS + Xcode 16 + CocoaPods

### Android

```bash
npm install
npx expo run:android
```

`android/gradle.properties` 設定了 `reactNativeArchitectures=arm64-v8a` 以縮短建置時間；
若需要 x86_64 模擬器請移除該行。

### iOS（需 macOS）

```bash
npm install
npx expo prebuild -p ios      # ios/ 目錄刻意不入庫
npx expo run:ios
```

### 正式版建置（簽名 APK）

```bash
# 一次性：建立 keystore（不入版控）與 android/keystore.properties
keytool -genkeypair -v -keystore android/app/camera2doc-release.keystore \
  -alias camera2doc -keyalg RSA -keysize 2048 -validity 10000
# android/keystore.properties（已 gitignore）：
#   storeFile=camera2doc-release.keystore
#   storePassword=... keyAlias=camera2doc keyPassword=...

cd android && ./gradlew :app:assembleRelease
# -> android/app/build/outputs/apk/release/app-release.apk（arm64-v8a，已簽名）
```

⚠️ **請務必備份 keystore 與密碼。** 日後要更新已安裝的 App，必須用同一把金鑰簽名，否則 Android 會拒絕覆蓋安裝。

### 只改 JS 時的迭代

```bash
npx expo start          # Metro；重整已安裝的 dev build
npx tsc --noEmit        # 型別檢查
npx expo lint
```

---

## 演算法開發與驗證

演算法先在 Python 參考實作上調校，再移植到原生端；iOS 端不需 Mac 也能在 CI 驗證：

| 工具 | 用途 |
|---|---|
| `tools/pipeline_v5.py` | 參考實作（色調 v5 基準） |
| `tools/pipeline_v6.py` | 現行參考：`color_v6`、`copy_v6`、`copy_v7`（正式出貨演算法） |
| `tools/ios-verify/main.swift` | 在 macOS 上執行**同一份 Swift 演算法**：`./verify <輸入目錄> <輸出目錄>`，另有 `--make-synthetic` |
| `tools/make_corners.py` | 產生 `tools/ios-verify/corners.json`（驗證工具的四角備援） |
| `.github/workflows/ios.yml` | 工作 1：prebuild + `pod install` + `xcodebuild`（編譯檢查）。工作 2：編譯驗證工具、對合成圖與 `samples/` 照片執行，上傳 JPEG 產物 |

```bash
# macOS / Linux
swiftc -O tools/ios-verify/main.swift modules/camera2doc/ios/ScannerAlgorithms.swift -o verify
./verify --make-synthetic ci-out/synth
./verify ci-out/synth ci-out/out_synth ci-out/synth/corners.json
```

---

## 隱私

本專案**不會**把任何個人資料提交進版控。

* `TEST_IMAGE/`（開發時使用的私人照片）已列入 `.gitignore`，永不推送。
* `samples/` 只放不含敏感內容的測試圖，供 CI 與文件使用。
* `screenshot/` 內的操作截圖不含個人資料。

## 現況

| | |
|---|---|
| Android | **已發布並在實機驗證** —— 從 [Releases](https://github.com/caronyang/camera2Doc/releases) 下載的簽名 APK 已安裝於 POCO X6 Pro（Android 15）實測：偵測、攤平、拉直、兩種色調、JPEG/PDF 匯出 |
| iOS | 程式碼完成；編譯與演算法驗證在 CI 執行（本機無 Mac）。實機測試待進行 |
| 已知 iOS 差異 | 無 CLAHE（以局部對比近似）；拉直只用投影法（無 Hough 候補） |

## 後續規劃

* iOS 實機驗證（EAS Build 或側載）
* 頁面排序、單頁重拍
* OCR 文字層
* 針對嚴重彎曲頁面的網格展平（decurve）

## 授權

MIT — 詳見 [LICENSE](LICENSE)。

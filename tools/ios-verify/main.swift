// Camera2Doc iOS 演算法驗證工具（在 macOS 上執行，使用與 App 完全相同的 ScannerAlgorithms）
//
// 用法: verify <inputDir> <outputDir> [corners.json]
//   - 逐張讀取測試照片 -> Vision 偵測四角（失敗則用 corners.json）-> 攤平+拉直
//     -> original/copy 濾鏡 -> A4 -> 輸出 JPEG，並印出量化指標
//
// 這是「不需 Mac 也能驗證 iOS 演算法」的核心：GitHub Actions(macOS) 跑本工具，
// 把 out/*.jpg 上傳成 artifact，即可與 Android 成品並排比較。

import Foundation
import CoreGraphics
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import Vision

// MARK: - 工具

func loadCG(_ path: String) -> CGImage? {
  return CGImage.decodeOriented(path: path)
}

func writeJPEG(_ cg: CGImage, _ path: String, quality: Double = 0.94) -> Bool {
  let url = URL(fileURLWithPath: path)
  guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { return false }
  CGImageDestinationAddImage(dest, cg, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
  return CGImageDestinationFinalize(dest)
}

func metrics(_ cg: CGImage) -> String {
  guard let rgba = cg.rgbaBytes() else { return "n/a" }
  let total = cg.width * cg.height
  let gray = ScanAlgorithms.toGray(rgba, total)
  let p85 = ScanAlgorithms.percentile(gray, 85.0)
  var inkSum = 0.0
  var inkCount = 0
  var dark = 0
  for v in gray where v < 110 {
    inkSum += Double(v)
    inkCount += 1
  }
  for v in gray where v < 100 { dark += 1 }
  let inkMean = inkCount > 0 ? inkSum / Double(inkCount) : -1
  return String(format: "size=%dx%d paper_p85=%.0f ink_mean=%.0f ink<100=%.2f%%",
                cg.width, cg.height, p85, inkMean, Double(dark) / Double(total) * 100)
}

func detectCornersVision(_ cg: CGImage) -> [Double]? {
  guard #available(macOS 12.0, *) else { return nil }
  let W = Double(cg.width), H = Double(cg.height)
  let maxDim = max(W, H)
  var ci = CIImage(cgImage: cg)
  let s = min(1.0, 1024.0 / maxDim)
  if s < 1.0 { ci = ci.transformed(by: CGAffineTransform(scaleX: s, y: s)) }
  let request = VNDetectDocumentSegmentationRequest()
  let handler = VNImageRequestHandler(ciImage: ci, options: [:])
  do { try handler.perform([request]) } catch { return nil }
  guard let obs = request.results?.first as? VNRectangleObservation else { return nil }
  func flip(_ p: CGPoint) -> [Double] { [Double(p.x), 1.0 - Double(p.y)] }
  return flip(obs.topLeft) + flip(obs.topRight) + flip(obs.bottomRight) + flip(obs.bottomLeft)
}

// MARK: - 合成測試圖（CI 無隱私照片時使用；也作為工具自測）
// 產生兩張「文件感」測試圖：米白紙面 + 黑色文字筆畫 + 紅色標題塊 + 藍色塊 + 角落陰影漸層
// 這樣 CI 可以驗證：背景白化、逐像素防截斷（紅/藍塊顏色必須保持）、字被壓黑、陰影被壓平。

func makeSynthetic(_ dir: String) {
  try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
  let specs: [(name: String, w: Int, h: Int)] = [
    ("synthetic_portrait.jpg", 900, 1200),
    ("synthetic_landscape.jpg", 1200, 900),
  ]
  var corners: [String: [Double]] = [:]
  for s in specs {
    guard let sRGB = CGColorSpace(name: CGColorSpace.sRGB),
          let ctx = CGContext(data: nil, width: s.w, height: s.h, bitsPerComponent: 8,
                              bytesPerRow: 0, space: sRGB,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { continue }
    let W = Double(s.w), H = Double(s.h)
    // 紙面（米白，模擬偏黃紙）
    ctx.setFillColor(CGColor(red: 0.96, green: 0.94, blue: 0.88, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
    // 左上到右下的陰影漸層（測背景白化）
    let n = 10
    for i in 0..<n {
      let t = Double(i) / Double(n)
      ctx.setFillColor(CGColor(red: 0.55 + 0.4 * t, green: 0.55 + 0.4 * t, blue: 0.5 + 0.4 * t, alpha: 0.25))
      ctx.fill(CGRect(x: 0, y: 0, width: W * (1 - t), height: H * (1 - t)))
    }
    // 紅色標題塊 + 藍色塊（顏色保真測試）
    ctx.setFillColor(CGColor(red: 0.85, green: 0.1, blue: 0.12, alpha: 1))
    ctx.fill(CGRect(x: W * 0.08, y: H * 0.9, width: W * 0.5, height: H * 0.03))
    ctx.setFillColor(CGColor(red: 0.12, green: 0.25, blue: 0.8, alpha: 1))
    ctx.fill(CGRect(x: W * 0.08, y: H * 0.85, width: W * 0.35, height: H * 0.025))
    // 文字筆畫（黑，隨機長條）
    ctx.setFillColor(CGColor(red: 0.05, green: 0.05, blue: 0.05, alpha: 1))
    var y = H * 0.80
    var seed: UInt64 = 12345
    func rnd() -> Double {
      seed = seed &* 6364136223846793005 &+ 1442695040888963407
      return Double((seed >> 33) & 0xFFFFFF) / Double(0xFFFFFF)
    }
    while y > H * 0.08 {
      let lineW = W * (0.55 + 0.3 * rnd())
      ctx.fill(CGRect(x: W * 0.08, y: y, width: lineW, height: max(2, H * 0.006)))
      y -= H * 0.022
    }
    guard let img = ctx.makeImage() else { continue }
    _ = writeJPEG(img, (dir as NSString).appendingPathComponent(s.name), quality: 0.95)
    corners[s.name] = [0.02, 0.02, 0.98, 0.02, 0.98, 0.98, 0.02, 0.98]
    print("[synthetic] \(s.name) \(s.w)x\(s.h) written")
  }
  if let data = try? JSONSerialization.data(withJSONObject: corners, options: .prettyPrinted) {
    try? data.write(to: URL(fileURLWithPath: (dir as NSString).appendingPathComponent("corners.json")))
  }
}

// MARK: - main

let args = CommandLine.arguments
if args.count >= 3, args[1] == "--make-synthetic" {
  makeSynthetic(args[2])
  exit(0)
}
guard args.count >= 3 else {
  print("usage: verify <inputDir> <outputDir> [corners.json]")
  print("       verify --make-synthetic <outDir>")
  exit(2)
}
let inDir = args[1]
let outDir = args[2]
var cornerMap: [String: [Double]] = [:]
if args.count >= 4, let data = FileManager.default.contents(atPath: args[3]),
   let obj = try? JSONSerialization.jsonObject(with: data) as? [String: [Double]] {
  cornerMap = obj
}
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

let files = (try? FileManager.default.contentsOfDirectory(atPath: inDir))?
  .filter { $0.lowercased().hasSuffix(".jpg") || $0.lowercased().hasSuffix(".jpeg") || $0.lowercased().hasSuffix(".png") }
  .sorted() ?? []

print("== Camera2Doc iOS algorithm verification ==")
print("input: \(inDir)  files: \(files.count)")

for f in files {
  let path = (inDir as NSString).appendingPathComponent(f)
  guard let cg = loadCG(path) else {
    print("[\(f)] SKIP (decode failed)")
    continue
  }
  var corners = detectCornersVision(cg)
  let src = corners != nil ? "vision" : "corners.json"
  if corners == nil { corners = cornerMap[f] }
  guard let c = corners else {
    print("[\(f)] SKIP (no corners)")
    continue
  }
  print("[\(f)] corners from \(src): \(c.map { String(format: "%.3f", $0) }.joined(separator: ","))")

  let base = (f as NSString).deletingPathExtension
  for mode in ["original", "copy"] {
    guard let flat = ScanAlgorithms.warpAndStraighten(cg: cg, corners: c, maxDim: 3800) else {
      print("[\(f)] \(mode): warp failed")
      continue
    }
    var rgba = flat.rgbaBytes() ?? []
    if mode == "copy" {
      ScanAlgorithms.copyEnhance(&rgba, flat.width, flat.height)
    } else {
      ScanAlgorithms.colorWhite(&rgba, flat.width, flat.height)
    }
    let filtered = ScanAlgorithms.makeCGFromRGBA(rgba, flat.width, flat.height) ?? flat
    let out = ScanAlgorithms.padToA4(filtered)
    let outPath = (outDir as NSString).appendingPathComponent("\(base)_\(mode)_ios.jpg")
    let ok = writeJPEG(out, outPath)
    print("[\(f)] \(mode): \(metrics(out))  -> \(ok ? "written" : "WRITE FAILED")")
  }
}
print("== done ==")

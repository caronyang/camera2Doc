import Foundation
import CoreGraphics
import CoreImage
import Accelerate

/**
 * Camera2Doc 純算法層（不依賴 ExpoModulesCore / UIKit）
 *
 * 這個檔案是「iOS 版演算法」的唯一實作，App 模組（Camera2DocModule.swift）與
 * 命令行驗證工具（tools/ios-verify/main.swift）都引用它 —— 保證「驗證的程式碼」
 * 就是「上線的程式碼」，不會有兩份實作漂移。
 *
 * 管線與 Android/Kotlin 版一致（v6/v7 定案）：
 *   original: 增益場白化(245/1.8) + 逐像素防截斷 + HSV 紙面消彩(205/45) + 亮度域 unsharp(σ1.2, 0.9)
 *   copy    : 增益場歸一化(255/2.4) + CLAHE 近似 + S 曲線 + 墨跡軟填充(160/0.75/70) + unsharp(σ1.2, 2.2)
 */
public enum ScanAlgorithms {

  public static let ciContext = CIContext(options: [.useSoftwareRenderer: false])

  // MARK: - 基礎工具

  public static func toGray(_ rgba: [UInt8], _ total: Int) -> [UInt8] {
    var gray = [UInt8](repeating: 0, count: total)
    for i in 0..<total {
      let o = i * 4
      gray[i] = UInt8(
        (UInt32(rgba[o]) * 299 + UInt32(rgba[o + 1]) * 587 + UInt32(rgba[o + 2]) * 115 + 500) / 1000)
    }
    return gray
  }

  public static func percentile(_ data: [UInt8], _ p: Double) -> Double {
    if data.isEmpty { return 255 }
    var counts = [Int](repeating: 0, count: 256)
    for v in data { counts[Int(v)] += 1 }
    let target = Int(Double(data.count) * p / 100.0)
    var acc = 0
    for v in 0..<256 {
      acc += counts[v]
      if acc >= target { return Double(v) }
    }
    return 255
  }

  /// 1/4 降採樣 + 大核中值（vImage 無中值，以閉運算近似）+ 上採樣平滑 -> 紙面亮度模型
  public static func estimateBG(_ gray: [UInt8], _ w: Int, _ h: Int) -> [Float]? {
    let sw = max(w / 4, 2)
    let sh = max(h / 4, 2)
    var small = [UInt8](repeating: 255, count: sw * sh)
    for y in 0..<sh {
      let y0 = y * 4
      let y1 = min(y0 + 4, h)
      for x in 0..<sw {
        let x0 = x * 4
        let x1 = min(x0 + 4, w)
        var sum = 0
        var cnt = 0
        for yy in y0..<y1 {
          let row = yy * w
          for xx in x0..<x1 {
            sum += Int(gray[row + xx])
            cnt += 1
          }
        }
        small[y * sw + x] = cnt > 0 ? UInt8(sum / cnt) : 255
      }
    }
    var k = max((min(sw, sh) / 8) | 1, 11)
    k = min(k, 255)
    if k % 2 == 0 { k += 1 }

    var smallBuf = vImage_Buffer(data: &small, height: vImagePixelCount(sh), width: vImagePixelCount(sw), rowBytes: sw)
    var dilBuf = [UInt8](repeating: 0, count: sw * sh)
    var workBuf = vImage_Buffer(data: &dilBuf, height: vImagePixelCount(sh), width: vImagePixelCount(sw), rowBytes: sw)
    var ok = false
    var kernel = [UInt8](repeating: 1, count: k * k)
    kernel.withUnsafeBufferPointer { kp in
      var ks = vImageConvolutionKernel_u8(kp.baseAddress, Int32(k), Int32(k))
      let e1 = vImageDilate_Planar8(&smallBuf, &workBuf, 0, 0, UInt8(k), UInt8(k), &ks, kvImageExpandEdge)
      let e2 = vImageErode_Planar8(&workBuf, &smallBuf, 0, 0, UInt8(k), UInt8(k), &ks, kvImageExpandEdge)
      ok = (e1 == kvImageNoError) && (e2 == kvImageNoError)
    }
    guard ok else { return nil }

    var bg = [UInt8](repeating: 255, count: w * h)
    var bgBlur = [UInt8](repeating: 255, count: w * h)
    var bgBuf = vImage_Buffer(data: &bg, height: vImagePixelCount(h), width: vImagePixelCount(w), rowBytes: w)
    var blurBuf = vImage_Buffer(data: &bgBlur, height: vImagePixelCount(h), width: vImagePixelCount(w), rowBytes: w)
    guard vImageScale_Planar8(&smallBuf, &bgBuf, nil, kvImageNoFlags) == kvImageNoError,
          vImageGaussianBlur_Planar8(&bgBuf, &blurBuf, 12, 0, kvImageEdgeExtend) == kvImageNoError
    else { return nil }
    return bgBlur.map { max(Float($0), 60.0) }
  }

  /// 亮度域 unsharp：delta=(luma-blur)*(strength-amount)，等量加三通道（色相零變動）
  public static func unsharpRGBA(_ rgba: inout [UInt8], _ w: Int, _ h: Int, radius: UInt, strength: Double, amount: Double) {
    let total = w * h
    var gray = toGray(rgba, total)
    var blurred = [UInt8](repeating: 0, count: total)
    var srcBuf = vImage_Buffer(data: &gray, height: vImagePixelCount(h), width: vImagePixelCount(w), rowBytes: w)
    var dstBuf = vImage_Buffer(data: &blurred, height: vImagePixelCount(h), width: vImagePixelCount(w), rowBytes: w)
    guard vImageGaussianBlur_Planar8(&srcBuf, &dstBuf, radius, 0, kvImageEdgeExtend) == kvImageNoError else { return }
    let k = strength - amount
    for i in 0..<total {
      let delta = (Double(gray[i]) - Double(blurred[i])) * k
      let o = i * 4
      for c in 0..<3 {
        rgba[o + c] = UInt8(max(0.0, min(255.0, Double(rgba[o + c]) + delta)))
      }
    }
  }

  // MARK: - 原色（v6）

  public static func colorWhite(_ rgba: inout [UInt8], _ w: Int, _ h: Int) {
    let total = w * h
    let gray = toGray(rgba, total)
    guard let bg = estimateBG(gray, w, h) else { return }
    for i in 0..<total {
      let o = i * 4
      let r = Double(rgba[o])
      let g = Double(rgba[o + 1])
      let b = Double(rgba[o + 2])
      let gainField = min(max(245.0 / Double(bg[i]), 1.0), 1.8) // target 245, cap 1.8
      let mx = max(r, max(g, b))
      let head = mx > 1.0 ? 255.0 / mx : 2.0 // 逐像素防截斷
      let gain = min(gainField, head)
      rgba[o] = UInt8(min(255.0, r * gain))
      rgba[o + 1] = UInt8(min(255.0, g * gain))
      rgba[o + 2] = UInt8(min(255.0, b * gain))
    }
    // 紙面消彩：V>205 且 (mx-mn) < mx*0.18（等價 HSV S<45/255）
    for i in 0..<total {
      let o = i * 4
      let r = Double(rgba[o])
      let g = Double(rgba[o + 1])
      let b = Double(rgba[o + 2])
      let mx = max(r, max(g, b))
      let mn = min(r, min(g, b))
      if mx > 205 && (mx - mn) < mx * 0.18 {
        rgba[o] = UInt8(min(255.0, mx - (mx - r) * 0.35))
        rgba[o + 1] = UInt8(min(255.0, mx - (mx - g) * 0.35))
        rgba[o + 2] = UInt8(min(255.0, mx - (mx - b) * 0.35))
      }
    }
    unsharpRGBA(&rgba, w, h, radius: 3, strength: 1.9, amount: 0.9)
  }

  // MARK: - 影印（v7）

  public static func buildSCurve() -> [UInt8] {
    let xs = [0, 50, 90, 120, 150, 180, 205, 232, 255]
    let ys = [0, 20, 42, 74, 120, 168, 218, 248, 255]
    var curve = [UInt8](repeating: 0, count: 256)
    for v in 0...255 {
      var i = 0
      while i < xs.count - 2 && xs[i + 1] <= v { i += 1 }
      let x0 = xs[i]; let y0 = ys[i]; let x1 = xs[i + 1]; let y1 = ys[i + 1]
      let t = min(max(Double(v - x0) / Double(x1 - x0), 0.0), 1.0)
      curve[v] = UInt8(min(255.0, (Double(y0) + Double(y1 - y0) * t).rounded()))
    }
    return curve
  }

  /// CLAHE 近似：vImage 無 CLAHE，以「局部對比增強」替代（大核 unsharp 的差值作為局部對比）
  /// 與 Android 的 CLAHE(3.0) 目標一致：拉開局部明暗，讓細字更實
  private static func localContrast(_ gray: inout [UInt8], _ w: Int, _ h: Int) {
    let total = w * h
    var blurred = [UInt8](repeating: 0, count: total)
    var srcBuf = vImage_Buffer(data: &gray, height: vImagePixelCount(h), width: vImagePixelCount(w), rowBytes: w)
    var dstBuf = vImage_Buffer(data: &blurred, height: vImagePixelCount(h), width: vImagePixelCount(w), rowBytes: w)
    let r = max(vImagePixelCount(min(w, h) / 40), 8)
    guard vImageGaussianBlur_Planar8(&srcBuf, &dstBuf, r, 0, kvImageEdgeExtend) == kvImageNoError else { return }
    for i in 0..<total {
      let v = Double(gray[i])
      let local = Double(blurred[i])
      let boosted = v + (v - local) * 0.6 // 局部對比
      gray[i] = UInt8(max(0.0, min(255.0, boosted)))
    }
  }

  public static func copyEnhance(_ rgba: inout [UInt8], _ w: Int, _ h: Int) {
    let total = w * h
    let gray0 = toGray(rgba, total)
    guard let bg = estimateBG(gray0, w, h) else { return }
    var norm = [UInt8](repeating: 0, count: total)
    for i in 0..<total {
      let gain = min(max(255.0 / Double(bg[i]), 1.0), 2.4)
      norm[i] = UInt8(min(255.0, Double(gray0[i]) * gain))
    }
    localContrast(&norm, w, h) // CLAHE 近似
    let curve = buildSCurve()
    var toned = [UInt8](repeating: 0, count: total)
    for i in 0..<total {
      toned[i] = curve[Int(norm[i])]
    }
    // 墨跡軟填充：不膨脹，羽化 mask 把筆畫灰邊壓到 <=70（blend 0.75）
    var ink = [UInt8](repeating: 0, count: total)
    for i in 0..<total { ink[i] = toned[i] < 160 ? 255 : 0 }
    var alpha = [UInt8](repeating: 0, count: total)
    var inkBuf = vImage_Buffer(data: &ink, height: vImagePixelCount(h), width: vImagePixelCount(w), rowBytes: w)
    var alphaBuf = vImage_Buffer(data: &alpha, height: vImagePixelCount(h), width: vImagePixelCount(w), rowBytes: w)
    if vImageGaussianBlur_Planar8(&inkBuf, &alphaBuf, 2, 0, kvImageEdgeExtend) == kvImageNoError {
      for i in 0..<total {
        let a = Double(alpha[i]) / 255.0 * 0.75
        let t = Double(toned[i])
        let dark = min(t, 70.0)
        toned[i] = UInt8(max(0.0, min(255.0, t * (1 - a) + dark * a)))
      }
    }
    for i in 0..<total {
      let o = i * 4
      rgba[o] = toned[i]
      rgba[o + 1] = toned[i]
      rgba[o + 2] = toned[i]
    }
    unsharpRGBA(&rgba, w, h, radius: 3, strength: 2.2, amount: 1.2)
  }

  // MARK: - 拉直（投影輪廓法，與 Python/Kotlin 同一取樣式）

  public static func projectionScore(_ bin: [UInt8], _ bw: Int, _ bh: Int, angleDeg: Double) -> Double {
    let a = angleDeg * .pi / 180
    let cosA = cos(a)
    let sinA = sin(a)
    let cx = Double(bw) / 2.0
    let cy = Double(bh) / 2.0
    let nw = Int(Double(bw) * abs(cosA) + Double(bh) * abs(sinA)) + 2
    let nh = Int(Double(bw) * abs(sinA) + Double(bh) * abs(cosA)) + 2
    let ncx = Double(nw) / 2.0
    let ncy = Double(nh) / 2.0
    var rows = [Double](repeating: 0, count: nh)
    for dy in 0..<nh {
      var sum = 0.0
      for dx in 0..<nw {
        let sx = (Double(dx) - ncx) * cosA - (Double(dy) - ncy) * sinA + cx
        let sy = (Double(dx) - ncx) * sinA + (Double(dy) - ncy) * cosA + cy
        if sx >= 0, sx < Double(bw - 1), sy >= 0, sy < Double(bh - 1) {
          let idx = Int(sy) * bw + Int(sx)
          if bin[idx] != 0 { sum += 1 }
        }
      }
      rows[dy] = sum
    }
    return rows.reduce(0) { $0 + $1 * $1 }
  }

  /// 在已攤平縮圖 RGBA 上搜索最佳拉直角（視覺逆時針為正）
  public static func searchAngle(rgba: [UInt8], _ w: Int, _ h: Int) -> Double {
    let scale = min(1.0, 700.0 / Double(max(w, h)))
    let sw = max(Int(Double(w) * scale), 64)
    let sh = max(Int(Double(h) * scale), 64)
    var gray = [UInt8](repeating: 0, count: sw * sh)
    for y in 0..<sh {
      let sy = min(Int(Double(y) / scale), h - 1)
      for x in 0..<sw {
        let sx = min(Int(Double(x) / scale), w - 1)
        let o = (sy * w + sx) * 4
        gray[y * sw + x] = UInt8(
          (UInt32(rgba[o]) * 299 + UInt32(rgba[o + 1]) * 587 + UInt32(rgba[o + 2]) * 115 + 500) / 1000)
      }
    }
    let paper = percentile(gray, 85.0)
    let th = paper * 0.6
    var bin = [UInt8](repeating: 0, count: sw * sh)
    for i in 0..<gray.count where Double(gray[i]) < th {
      bin[i] = 1
    }
    let s0 = projectionScore(bin, sw, sh, 0.0)
    var best = 0.0
    var bestScore = s0
    var ang = -12.0
    while ang <= 12.0 {
      let sc = projectionScore(bin, sw, sh, ang)
      if sc > bestScore {
        bestScore = sc
        best = ang
      }
      ang += 0.6
    }
    var a2 = best - 0.6
    while a2 <= best + 0.6 {
      let sc = projectionScore(bin, sw, sh, a2)
      if sc > bestScore {
        bestScore = sc
        best = a2
      }
      a2 += 0.12
    }
    if abs(best) < 0.3 || bestScore < 1.015 * s0 {
      return 0.0
    }
    return best
  }

  // MARK: - 影像 I/O 與轉換

  public static func makeCGFromRGBA(_ rgba: [UInt8], _ w: Int, _ h: Int) -> CGImage? {
    guard let sRGB = CGColorSpace(name: CGColorSpace.sRGB),
          let ctx = CGContext(
            data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: sRGB,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
          ) else { return nil }
    var copy = rgba
    copy.withUnsafeMutableBytes { ptr in
      ctx.data?.copyMemory(from: ptr.baseAddress!, byteCount: w * h * 4)
    }
    return ctx.makeImage()
  }

  public static func filledWhite(_ src: CGImage) -> CGImage? {
    guard let sRGB = CGColorSpace(name: CGColorSpace.sRGB),
          let ctx = CGContext(
            data: nil, width: src.width, height: src.height, bitsPerComponent: 8, bytesPerRow: 0, space: sRGB,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
          ) else { return nil }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: src.width, height: src.height))
    ctx.draw(src, in: CGRect(x: 0, y: 0, width: src.width, height: src.height))
    return ctx.makeImage()
  }

  /// 置中貼到 A4 比例（1:√2）白色畫布
  public static func padToA4(_ cg: CGImage) -> CGImage {
    let w = Double(cg.width)
    let h = Double(cg.height)
    let ar = 1.4142
    var cw = w
    var ch = h
    if h >= w {
      if h / w < ar { ch = w * ar } else { cw = h / ar }
    } else {
      if w / h < ar { cw = h * ar } else { ch = w / ar }
    }
    cw = cw.rounded()
    ch = ch.rounded()
    let rect = CGRect(x: 0, y: 0, width: cw, height: ch)
    let imgRect = CGRect(x: (cw - w) / 2.0, y: (ch - h) / 2.0, width: w, height: h)
    guard let ctx = CGContext(
      data: nil,
      width: Int(cw),
      height: Int(ch),
      bitsPerComponent: 8,
      bytesPerRow: 0,
      space: CGColorSpace(name: CGColorSpace.sRGB)!,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return cg }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(rect)
    ctx.draw(cg, in: imgRect)
    return ctx.makeImage() ?? cg
  }

  /// 透視攤平 + 拉直（單次複合，與 Android 的單次 warpPerspective 設計對應）
  public static func warpAndStraighten(cg: CGImage, corners: [Double], maxDim: Double, deskew: Bool = true) -> CGImage? {
    let W = Double(cg.width)
    let H = Double(cg.height)
    let full = CIImage(cgImage: cg)
    func px(_ i: Int) -> CGPoint {
      CGPoint(x: corners[i * 2] * W, y: H - corners[i * 2 + 1] * H) // 轉 CI 座標（左下原點）
    }
    let tl = px(0), tr = px(1), br = px(2), bl = px(3)
    func dist(_ a: CGPoint, _ b: CGPoint) -> Double { Double(hypot(a.x - b.x, a.y - b.y)) }
    let outW = max((dist(tl, tr) + dist(bl, br)) / 2.0, 64).rounded()
    let outH = max((dist(tl, bl) + dist(tr, br)) / 2.0, 64).rounded()

    guard let warp = CIFilter(name: "CIPerspectiveCorrection") else { return nil }
    warp.setValue(full, forKey: kCIInputImageKey)
    warp.setValue(CIVector(cgPoint: tl), forKey: "inputCornerTopLeft")
    warp.setValue(CIVector(cgPoint: tr), forKey: "inputCornerTopRight")
    warp.setValue(CIVector(cgPoint: bl), forKey: "inputCornerBottomLeft")
    warp.setValue(CIVector(cgPoint: br), forKey: "inputCornerBottomRight")
    warp.setValue(NSNumber(value: outW), forKey: "inputWidth")
    warp.setValue(NSNumber(value: outH), forKey: "inputHeight")
    guard var out = warp.outputImage else { return nil }
    out = out.cropped(to: CGRect(x: 0, y: 0, width: outW, height: outH))

    let scale = min(1.0, maxDim / max(outW, outH))
    if scale < 1.0 {
      out = out.transformed(by: CGAffineTransform(scaleX: CGFloat(scale), y: CGFloat(scale)))
    }

    if deskew {
      let sScale = min(1.0, 700.0 / Double(max(out.extent.width, out.extent.height)))
      let small = sScale < 1.0
        ? out.transformed(by: CGAffineTransform(scaleX: CGFloat(sScale), y: CGFloat(sScale)))
        : out
      if let smallCg = ciContext.createCGImage(small, from: small.extent.integral),
         let smallRGBA = smallCg.rgbaBytes() {
        let angle = searchAngle(rgba: smallRGBA, Int(smallCg.width), Int(smallCg.height))
        if abs(angle) >= 0.3 {
          let rad = CGFloat(angle * .pi / 180)
          let ext = out.extent
          let center = CGPoint(x: ext.midX, y: ext.midY)
          let t = CGAffineTransform(translationX: center.x, y: center.y)
            .rotated(by: rad)
            .translatedBy(x: -center.x, y: -center.y)
          let rotated = out.transformed(by: t)
          if let raw = ciContext.createCGImage(rotated, from: rotated.extent.integral) {
            return filledWhite(raw) ?? raw
          }
        }
      }
    }
    return ciContext.createCGImage(out, from: out.extent)
  }
}

public extension CGImage {
  /// 解碼為 top-down RGBA 緩衝
  func rgbaBytes() -> [UInt8]? {
    let w = width
    let h = height
    guard let sRGB = CGColorSpace(name: CGColorSpace.sRGB),
          let ctx = CGContext(
            data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: sRGB,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
          ) else { return nil }
    ctx.draw(self, in: CGRect(x: 0, y: 0, width: w, height: h))
    guard let ptr = ctx.data else { return nil }
    return [UInt8](UnsafeBufferPointer(start: ptr.bindMemory(to: UInt8.self, capacity: w * h * 4), count: w * h * 4))
  }

  /// 由檔案解碼（含 EXIF 方向，使用 ImageIO，iOS/macOS 通用）
  static func decodeOriented(path: String) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
    let opts: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
    ]
    return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
  }
}

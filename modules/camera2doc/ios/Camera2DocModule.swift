import ExpoModulesCore
import UIKit
import Vision
import CoreImage

/**
 * Camera2Doc 原生模組（iOS）—— Expo 膠水層
 *
 * 演算法實作全部在 ScannerAlgorithms.swift（純演算法、可被命令行工具獨立編譯驗證），
 * 本檔案只負責：權限/參數轉換、Vision 文件偵測、影像載入與存檔。
 */
public class Camera2DocModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Camera2Doc")

    AsyncFunction("detectCorners") { (uri: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let result = try ScannerCore.detectCorners(uri: uri)
          promise.tryResolve(result)
        } catch {
          promise.tryReject(code: "E_DETECT", message: "\(error)")
        }
      }
    }

    AsyncFunction("process") { (uri: String, corners: [Double], options: [String: Any], promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          guard corners.count == 8 else {
            throw ScannerError.badInput("corners must contain 8 numbers")
          }
          let mode = (options["mode"] as? String) ?? "original"
          let preview = (options["preview"] as? Bool) ?? false
          let toA4 = (options["toA4"] as? Bool) ?? true
          let result = try ScannerCore.process(
            uri: uri, corners: corners, mode: mode, preview: preview, toA4: toA4
          )
          promise.tryResolve(result)
        } catch {
          promise.tryReject(code: "E_PROCESS", message: "\(error)")
        }
      }
    }
  }
}

enum ScannerError: Error {
  case decode(String)
  case badInput(String)
  case render(String)
}

enum ScannerCore {
  static func toPath(_ uri: String) -> String {
    if uri.hasPrefix("file://"), let url = URL(string: uri) {
      return url.path
    }
    return uri
  }

  /// 解碼並依 EXIF 方向正規化（UIKit 處理方向，回傳 up 朝向的 CGImage）
  static func normalizedCGImage(path: String) throws -> CGImage {
    guard let img = UIImage(contentsOfFile: path), let cg = img.cgImage else {
      throw ScannerError.decode("Cannot decode image: \(path)")
    }
    guard img.imageOrientation != .up else { return cg }
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 1
    let size = CGSize(width: cg.width, height: cg.height)
    let renderer = UIGraphicsImageRenderer(size: size, format: fmt)
    let normalized = renderer.image { _ in
      img.draw(in: CGRect(origin: .zero, size: size))
    }
    guard let out = normalized.cgImage else { throw ScannerError.decode("orientation normalize failed") }
    return out
  }

  // MARK: - detectCorners（Vision）

  static func detectCorners(uri: String) throws -> [String: Any] {
    let path = toPath(uri)
    let cg = try normalizedCGImage(path: path)
    let pixelW = cg.width
    let pixelH = cg.height

    var ci = CIImage(cgImage: cg)
    let maxDim = Double(max(pixelW, pixelH))
    let s = min(1.0, 1024.0 / maxDim)
    if s < 1.0 {
      ci = ci.transformed(by: CGAffineTransform(scaleX: CGFloat(s), y: CGFloat(s)))
    }

    let request = VNDetectDocumentSegmentationRequest()
    let handler = VNImageRequestHandler(ciImage: ci, options: [:])
    try handler.perform([request])

    if let obs = request.results?.first as? VNRectangleObservation {
      func flip(_ p: CGPoint) -> [Double] { [Double(p.x), 1.0 - Double(p.y)] }
      let corners =
        flip(obs.topLeft) + flip(obs.topRight) + flip(obs.bottomRight) + flip(obs.bottomLeft)
      return ["corners": corners, "detected": true, "width": pixelW, "height": pixelH]
    }
    return ["corners": [Double](), "detected": false, "width": pixelW, "height": pixelH]
  }

  // MARK: - process（攤平+拉直 -> 濾鏡 -> A4）

  static func process(uri: String, corners: [Double], mode: String, preview: Bool, toA4: Bool) throws -> [String: Any] {
    let path = toPath(uri)
    let cg = try normalizedCGImage(path: path)

    let maxDim: Double = preview ? 2800 : 3800
    guard var outCg = ScanAlgorithms.warpAndStraighten(cg: cg, corners: corners, maxDim: maxDim) else {
      throw ScannerError.render("warp failed")
    }

    if var rgba = outCg.rgbaBytes() {
      let w = outCg.width
      let h = outCg.height
      if mode == "copy" {
        ScanAlgorithms.copyEnhance(&rgba, w, h)
      } else {
        ScanAlgorithms.colorWhite(&rgba, w, h)
      }
      if let filtered = ScanAlgorithms.makeCGFromRGBA(rgba, w, h) {
        outCg = filtered
      }
    }

    if toA4 {
      outCg = ScanAlgorithms.padToA4(outCg)
    }

    guard let jpeg = UIImage(cgImage: outCg).jpegData(compressionQuality: 0.94) else {
      throw ScannerError.render("jpeg encode failed")
    }
    let fileURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("c2d_\(Int(Date().timeIntervalSince1970 * 1000))_\(preview ? "p" : "f").jpg")
    try jpeg.write(to: fileURL)
    return ["path": fileURL.path, "width": outCg.width, "height": outCg.height]
  }
}

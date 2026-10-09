package expo.modules.camera2doc

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.opencv.android.OpenCVLoader
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.MatOfPoint
import org.opencv.core.MatOfPoint2f
import org.opencv.core.Point
import org.opencv.core.Scalar
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Camera2Doc 原生模組（Android / OpenCV）
 * - detectCorners: 文件四角偵測
 * - process: 攤平+拉直（單次 warpPerspective 複合變換）+ 濾鏡
 *   · original: 逐通道背景歸一化（去黃casts、白化背景、保留字色）+ 輕度銳化
 *   · copy: 除法歸一化 + 曝光補償 + 高光提升(保護暗部文字) + CLAHE + unsharp
 */
class Camera2DocModule : Module() {
  private val executor = Executors.newSingleThreadExecutor()
  private var opencvReady = false

  private fun ensureOpenCv() {
    if (!opencvReady) {
      opencvReady = OpenCVLoader.initLocal()
      if (!opencvReady) error("OpenCV native library init failed")
    }
  }

  override fun definition() = ModuleDefinition {
    Name("Camera2Doc")

    AsyncFunction("detectCorners") { uri: String, promise: Promise ->
      executor.execute {
        try {
          ensureOpenCv()
          promise.resolve(detectCorners(toPath(uri)))
        } catch (e: Throwable) {
          promise.reject("E_DETECT", e.message, e)
        }
      }
    }

    AsyncFunction("process") { uri: String, corners: List<Any?>, options: Map<String, Any?>, promise: Promise ->
      executor.execute {
        try {
          ensureOpenCv()
          require(corners.size == 8) { "corners must contain 8 numbers" }
          val pts = corners.map { (it as Number).toDouble() }
          val mode = options["mode"] as? String ?: "original"
          val preview = options["preview"] as? Boolean ?: false
          val toA4 = options["toA4"] as? Boolean ?: true
          promise.resolve(process(toPath(uri), pts, mode, preview, toA4))
        } catch (e: Throwable) {
          promise.reject("E_PROCESS", e.message, e)
        }
      }
    }
  }

  // ---------- 共用工具 ----------

  private fun toPath(uri: String): String =
    if (uri.startsWith("file://")) uri.removePrefix("file://") else uri

  private fun decodeRotated(path: String, maxDim: Int): Bitmap {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    // 取最小 2 次幂採樣，使解碼尺寸「不低於」maxDim，再用精確縮放收尾。
    // 舊寫法 max/sample > maxDim 會把 4096px 原圖直接砍半成 2048px（解析度腰斬）。
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxDim) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    var bmp = BitmapFactory.decodeFile(path, opts) ?: error("Cannot decode image: $path")
    val longest = max(bmp.width, bmp.height)
    if (longest > maxDim) {
      val s = maxDim.toDouble() / longest
      bmp = Bitmap.createScaledBitmap(bmp, (bmp.width * s).roundToInt(), (bmp.height * s).roundToInt(), true)
    }
    val rot = ExifInterface(path).getAttributeInt(
      ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL
    )
    val deg = when (rot) {
      ExifInterface.ORIENTATION_ROTATE_90 -> 90f
      ExifInterface.ORIENTATION_ROTATE_180 -> 180f
      ExifInterface.ORIENTATION_ROTATE_270 -> 270f
      else -> 0f
    }
    if (deg != 0f) {
      bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(deg) }, true)
    }
    return bmp
  }

  private fun orderCorners(pts: List<Point>): List<Point> {
    val s = pts.sortedBy { it.x + it.y }
    val d = pts.sortedBy { it.x - it.y }
    return listOf(s.first(), d.last(), s.last(), d.first())
  }

  private fun dist(a: Point, b: Point) = hypot(a.x - b.x, a.y - b.y)

  /**
   * 顯式 Bitmap(ARGB_8888) -> CV_8UC4 Mat，通道順序明確定義為 BGRA（ch0=B, ch1=G, ch2=R, ch3=255）。
   * 不使用 Utils.bitmapToMat：其通道順序約定在不同版本/文檔描述間存在歧義，
   * 曾導致原色模式紅藍翻轉的實測問題。getPixels 給出標準 0xAARRGGBB 整數，逐通道拆裝零歧義。
   */
  private fun bitmapToBgra(bmp: Bitmap): Mat {
    val w = bmp.width
    val h = bmp.height
    val px = IntArray(w * h)
    bmp.getPixels(px, 0, w, 0, 0, w, h)
    val bytes = ByteArray(w * h * 4)
    var i = 0
    for (p in px) {
      bytes[i] = (p and 0xFF).toByte()           // B
      bytes[i + 1] = ((p shr 8) and 0xFF).toByte()   // G
      bytes[i + 2] = ((p shr 16) and 0xFF).toByte()  // R
      bytes[i + 3] = 0xFF.toByte()               // A
      i += 4
    }
    val mat = Mat(h, w, CvType.CV_8UC4)
    mat.put(0, 0, bytes)
    return mat
  }

  /** 顯式 CV_8UC4(BGRA) Mat -> Bitmap(ARGB_8888)，與 bitmapToBgra 嚴格互逆 */
  private fun bgraToBitmap(mat: Mat): Bitmap {
    val w = mat.width()
    val h = mat.height()
    require(mat.depth() == CvType.CV_8U && mat.channels() == 4) { "expect CV_8UC4" }
    val bytes = ByteArray(w * h * 4)
    mat.get(0, 0, bytes)
    val px = IntArray(w * h)
    var i = 0
    for (p in 0 until w * h) {
      val b = bytes[i].toInt() and 0xFF
      val g = bytes[i + 1].toInt() and 0xFF
      val r = bytes[i + 2].toInt() and 0xFF
      px[p] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
      i += 4
    }
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    bmp.setPixels(px, 0, w, 0, 0, w, h)
    return bmp
  }

  /** 8-bit 單通道 Mat 取百分位（直方圖）；非 8U 單通道自動轉換 */
  private fun percentile(mat: Mat, p: Double): Double {
    val src = if (mat.depth() == CvType.CV_8U && mat.channels() == 1) {
      mat
    } else {
      val t = Mat()
      mat.convertTo(t, CvType.CV_8UC1)
      t
    }
    val total = src.total().toInt()
    if (total == 0) return 255.0
    val bytes = ByteArray(total)
    src.get(0, 0, bytes)
    val counts = IntArray(256)
    for (b in bytes) counts[b.toInt() and 0xFF]++
    val target = (total * p / 100.0).toInt().coerceAtMost(total - 1)
    var acc = 0
    for (v in 0..255) {
      acc += counts[v]
      if (acc >= target) return v.toDouble()
    }
    return 255.0
  }

  // ---------- 偵測 ----------

  private fun detectCorners(path: String): Map<String, Any?> {
    val bmp = decodeRotated(path, 1024)
    val w = bmp.width
    val h = bmp.height

    val mat = bitmapToBgra(bmp)
    val gray = Mat()
    Imgproc.cvtColor(mat, gray, Imgproc.COLOR_BGRA2GRAY)
    Imgproc.medianBlur(gray, gray, 5)

    val edges = Mat()
    Imgproc.Canny(gray, edges, 50.0, 150.0)
    val kernel = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(3.0, 3.0))
    Imgproc.dilate(edges, edges, kernel)

    val contours = ArrayList<MatOfPoint>()
    Imgproc.findContours(edges, contours, Mat(), Imgproc.RETR_LIST, Imgproc.CHAIN_APPROX_SIMPLE)
    contours.sortByDescending { Imgproc.contourArea(it) }

    val imgArea = w.toDouble() * h
    for (c in contours.take(12)) {
      val area = Imgproc.contourArea(c)
      if (area < imgArea * 0.12) continue
      val c2 = MatOfPoint2f(*c.toArray())
      val peri = Imgproc.arcLength(c2, true)
      val approx = MatOfPoint2f()
      Imgproc.approxPolyDP(c2, approx, 0.02 * peri, true)
      val pts = approx.toList()
      if (pts.size == 4 && Imgproc.isContourConvex(MatOfPoint(*approx.toArray()))) {
        val ordered = orderCorners(pts)
        val flat = ordered.flatMap { listOf(it.x / w, it.y / h) }
        return mapOf("corners" to flat, "detected" to true, "width" to w, "height" to h)
      }
    }
    return mapOf("corners" to emptyList<Double>(), "detected" to false, "width" to w, "height" to h)
  }

  // ---------- 拉直（deskew）----------

  /**
   * 將二值圖按「OpenCV getRotationMatrix2D(+angle)=視覺逆時針」旋轉後取样，
   * 回傳行投影平方和（文字行/框線越水平 -> 峰越尖）
   */
  private fun projectionScore(bin: ByteArray, bw: Int, bh: Int, angleDeg: Double): Double {
    val a = Math.toRadians(angleDeg)
    val cosA = cos(a)
    val sinA = sin(a)
    val cx = bw / 2.0
    val cy = bh / 2.0
    val nw = (bw * abs(cosA) + bh * abs(sinA)).toInt() + 2
    val nh = (bw * abs(sinA) + bh * abs(cosA)).toInt() + 2
    val ncx = nw / 2.0
    val ncy = nh / 2.0
    val rows = LongArray(nh)
    for (dy in 0 until nh) {
      var sum = 0L
      for (dx in 0 until nw) {
        // 與 Python 驗證版一致：src = R(a)(dst-c)+c，峰值角度 a 即套用的 CCW 修正角
        val sx = (dx - ncx) * cosA - (dy - ncy) * sinA + cx
        val sy = (dx - ncx) * sinA + (dy - ncy) * cosA + cy
        if (sx >= 0 && sx < bw - 1 && sy >= 0 && sy < bh - 1) {
          val idx = sy.toInt() * bw + sx.toInt()
          if (bin[idx].toInt() != 0) sum++
        }
      }
      rows[dy] = sum
    }
    var score = 0.0
    for (r in rows) score += r.toDouble() * r.toDouble()
    return score
  }

  /** 在已攤平的縮圖上搜索最佳旋轉角（CCW 正，套用於複合 warp） */
  private fun searchAngle(flatBmp: Bitmap): Double {
    val scale = min(1.0, 700.0 / max(flatBmp.width, flatBmp.height))
    val sw = max((flatBmp.width * scale).toInt(), 64)
    val sh = max((flatBmp.height * scale).toInt(), 64)
    val small = if (scale < 1.0) Bitmap.createScaledBitmap(flatBmp, sw, sh, true) else flatBmp

    val mat = bitmapToBgra(small)
    val gray = Mat()
    Imgproc.cvtColor(mat, gray, Imgproc.COLOR_BGRA2GRAY)
    val paper = percentile(gray, 85.0)
    val binMat = Mat()
    Imgproc.threshold(gray, binMat, paper * 0.6, 1.0, Imgproc.THRESH_BINARY_INV)
    val bin = ByteArray(sw * sh)
    // threshold 輸出與 gray 同型（8UC1），保險起見校驗後再讀
    val binSrc = if (binMat.depth() == CvType.CV_8U && binMat.channels() == 1) binMat else {
      Mat().also { binMat.convertTo(it, CvType.CV_8UC1) }
    }
    binSrc.get(0, 0, bin)

    val s0 = projectionScore(bin, sw, sh, 0.0)
    var best = 0.0
    var bestScore = s0
    var ang = -12.0
    while (ang <= 12.0) {
      val sc = projectionScore(bin, sw, sh, ang)
      if (sc > bestScore) {
        bestScore = sc
        best = ang
      }
      ang += 0.6
    }
    var a2 = best - 0.6
    while (a2 <= best + 0.6) {
      val sc = projectionScore(bin, sw, sh, a2)
      if (sc > bestScore) {
        bestScore = sc
        best = a2
      }
      a2 += 0.12
    }

    // Hough 長近水平線角度作為第二候選（框線型文件更穩）
    val candidates = mutableListOf(best)
    val blurred = Mat()
    Imgproc.GaussianBlur(gray, blurred, Size(3.0, 3.0), 0.0)
    val edges = Mat()
    Imgproc.Canny(blurred, edges, 50.0, 150.0)
    // OpenCV 5 的 HoughLinesP 輸出為 float，改用通用 Mat + double[] 讀取（兼容 int/float）
    val lines = Mat()
    try {
      Imgproc.HoughLinesP(edges, lines, 1.0, Math.PI / 720.0, 60, sw * 0.35, 8.0)
      val segs = ArrayList<Pair<Double, Double>>() // (angle, length)
      for (i in 0 until lines.rows()) {
        val l = lines.get(i, 0) ?: continue
        val x1 = l[0]
        val y1 = l[1]
        val x2 = l[2]
        val y2 = l[3]
        val aImg = Math.toDegrees(Math.atan2(y2 - y1, x2 - x1))
        if (abs(aImg) < 12.0) segs.add(Pair(aImg, hypot(x2 - x1, y2 - y1)))
      }
      if (segs.isNotEmpty()) {
        segs.sortByDescending { it.second }
        val top = segs.subList(0, max(1, (segs.size * 0.6).toInt()))
        var wsum = 0.0
        var asum = 0.0
        for ((a, w) in top) {
          wsum += w
          asum += a * w
        }
        if (wsum > 0) candidates.add(asum / wsum)  // y-down atan2 與 CCW 修正角同號
      }
    } finally {
      lines.release()
    }

    var best2 = 0.0
    var score2 = s0
    for (c in candidates) {
      val sc = projectionScore(bin, sw, sh, c)
      if (sc > score2) {
        score2 = sc
        best2 = c
      }
    }
    // 保護：角度過小或增益不足時不旋轉，避免無謂重採樣
    if (abs(best2) < 0.3 || score2 < 1.015 * s0) return 0.0
    return best2
  }

  /** 內容矩形繞中心「逆時針 ccwDeg」旋轉後的外接四角（tl,tr,br,bl）與尺寸 */
  private fun rotatedDstQuad(W: Int, H: Int, ccwDeg: Double): Triple<Array<Point>, Int, Int> {
    if (abs(ccwDeg) < 0.15) {
      val corners = arrayOf(Point(0.0, 0.0), Point(W.toDouble(), 0.0), Point(W.toDouble(), H.toDouble()), Point(0.0, H.toDouble()))
      return Triple(corners, W, H)
    }
    val rad = Math.toRadians(ccwDeg)
    val alpha = cos(rad)
    val beta = sin(rad)
    val cx = W / 2.0
    val cy = H / 2.0
    val pts = arrayOf(Point(0.0, 0.0), Point(W.toDouble(), 0.0), Point(W.toDouble(), H.toDouble()), Point(0.0, H.toDouble()))
    val rot = pts.map { p ->
      Point(
        cx + alpha * (p.x - cx) + beta * (p.y - cy),
        cy - beta * (p.x - cx) + alpha * (p.y - cy)
      )
    }
    val minX = rot.minOf { it.x }
    val minY = rot.minOf { it.y }
    val moved = rot.map { Point(it.x - minX, it.y - minY) }
    val nw = moved.maxOf { it.x }.roundToInt() + 1
    val nh = moved.maxOf { it.y }.roundToInt() + 1
    return Triple(moved.toTypedArray(), nw, nh)
  }

  // ---------- 背景估計 ----------

  /** 1/4 降採樣 + 大核中值（robust 跳過文字與皺褶）+ 平滑 -> 紙面亮度模型（float, >=60） */
  private fun estimateBg(src8: Mat): Mat {
    val w = src8.width()
    val h = src8.height()
    val small = Mat()
    Imgproc.resize(src8, small, Size(), 0.25, 0.25, Imgproc.INTER_AREA)
    var k = ((min(small.width(), small.height()) / 8) or 1).coerceIn(11, 255)
    if (k % 2 == 0) k += 1
    Imgproc.medianBlur(small, small, k)
    val bg = Mat()
    Imgproc.resize(small, bg, Size(w.toDouble(), h.toDouble()), 0.0, 0.0, Imgproc.INTER_CUBIC)
    Imgproc.GaussianBlur(bg, bg, Size(0.0, 0.0), 12.0)
    Core.max(bg, Scalar(60.0), bg)
    return bg
  }

  private fun toFloat(mat8: Mat): Mat {
    val f = Mat()
    mat8.convertTo(f, CvType.CV_32FC1)
    return f
  }

  private fun applyGain(plane: Mat, gain: Mat): Mat {
    // plane、gain 皆 CV_32FC1 -> clip(p*g, 0, 255) -> 8U
    val r = Mat()
    Core.multiply(plane, gain, r)
    Core.min(r, Mat(r.size(), r.type(), Scalar(255.0)), r)
    val out = Mat()
    r.convertTo(out, CvType.CV_8UC1)
    return out
  }

  // ---------- 濾鏡 ----------

  /** S 型走勢表（v6 定案）：中段壓更深、淺灰推白，對齊 Python _s_curve_v6 */
  private fun buildToneCurve(): ByteArray {
    val xs = intArrayOf(0, 50, 90, 120, 150, 180, 205, 232, 255)
    val ys = intArrayOf(0, 20, 42, 74, 120, 168, 218, 248, 255)
    val lut = ByteArray(256)
    for (v in 0..255) {
      var i = 0
      while (i < xs.size - 2 && xs[i + 1] <= v) i++
      val x0 = xs[i]; val y0 = ys[i]; val x1 = xs[i + 1]; val y1 = ys[i + 1]
      val t = ((v - x0).toDouble() / (x1 - x0)).coerceIn(0.0, 1.0)
      lut[v] = (y0 + (y1 - y0) * t).roundToInt().coerceIn(0, 255).toByte()
    }
    return lut
  }

  /** 共同亮度增益場 g = clamp(target/背景亮度, 1.0, cap)。三通道乘同一 gain => 色相不變 */
  private fun sharedLumaGain(gray: Mat, target: Double = 255.0, cap: Double = 2.4): Mat {
    val bg = estimateBg(gray)
    val bgF = toFloat(bg)
    val g = Mat()
    Core.divide(Mat(bgF.size(), CvType.CV_32FC1, Scalar(target)), bgF, g)
    Core.max(g, Mat(g.size(), g.type(), Scalar(1.0)), g)
    Core.min(g, Mat(g.size(), g.type(), Scalar(cap)), g)
    bgF.release(); bg.release()
    return g
  }

  /**
   * 原色 v6（Python 定案）：
   *  1. 增益場白化：target 245（留 headroom，不再無腦推到 255 造成過曝）、只提亮不壓暗、上限 1.8
   *  2. 逐像素防截斷 g = min(增益場, 255/max(R,G,B))：任何通道都不會先撞 255，
   *     因此色相與飽和度完整保留（解決「紅字變灰」）
   *  3. HSV 紙面消彩：僅 V>205 且 S<45（真正近白紙面）才降飽和，淡彩字/淺紅字不誤傷
   *  4. 亮度域 unsharp σ1.2 delta 0.9：delta 等量加三通道，強化細筆畫且色相不動
   */
  private fun applyColorWhite(bgra: Mat): Mat {
    val total = bgra.total().toInt()
    val bgr = Mat()
    Imgproc.cvtColor(bgra, bgr, Imgproc.COLOR_BGRA2BGR)
    val gray = Mat()
    Imgproc.cvtColor(bgr, gray, Imgproc.COLOR_BGR2GRAY)

    // 1) 增益場（target 245, cap 1.8）
    val gainF = sharedLumaGain(gray, 245.0, 1.8)

    // 2) 逐像素防截斷增益
    val planes = ArrayList<Mat>()
    Core.split(bgr, planes)
    val fB = toFloat(planes[0])
    val fG = toFloat(planes[1])
    val fR = toFloat(planes[2])
    val mx = Mat()
    Core.max(fB, fG, mx)
    Core.max(mx, fR, mx)
    Core.max(mx, Mat(mx.size(), mx.type(), Scalar(1.0)), mx) // 防除零
    val head = Mat()
    Core.divide(Mat(mx.size(), CvType.CV_32FC1, Scalar(255.0)), mx, head)
    val g = Mat()
    Core.min(gainF, head, g)

    val gainPlanes = ArrayList<Mat>()
    for (f in listOf(fB, fG, fR)) {
      val r = Mat()
      Core.multiply(f, g, r)
      val u = Mat()
      r.convertTo(u, CvType.CV_8UC1) // saturate clip
      gainPlanes.add(u)
    }
    val normed = Mat()
    Core.merge(gainPlanes, normed) // BGR

    // 3) 紙面消彩：V>205 且 S<45 -> S*=0.35
    val hsv = Mat()
    Imgproc.cvtColor(normed, hsv, Imgproc.COLOR_BGR2HSV)
    val hp = ArrayList<Mat>()
    Core.split(hsv, hp)
    val sBytes = ByteArray(total)
    val vBytes = ByteArray(total)
    hp[1].get(0, 0, sBytes)
    hp[2].get(0, 0, vBytes)
    for (i in 0 until total) {
      val v = vBytes[i].toInt() and 0xFF
      val s = sBytes[i].toInt() and 0xFF
      if (v > 205 && s < 45) sBytes[i] = (s * 0.35).roundToInt().toByte()
    }
    hp[1].put(0, 0, sBytes)
    Core.merge(hp, hsv)
    val desat = Mat()
    Imgproc.cvtColor(hsv, desat, Imgproc.COLOR_HSV2BGR)

    // 4) 亮度域 unsharp（σ1.2, delta=(luma-blur)*0.9）
    val luma = Mat()
    Imgproc.cvtColor(desat, luma, Imgproc.COLOR_BGR2GRAY)
    val lF = toFloat(luma)
    val bF = Mat()
    Imgproc.GaussianBlur(lF, bF, Size(0.0, 0.0), 1.2)
    val dF = Mat()
    Core.subtract(lF, bF, dF)
    Core.multiply(dF, Scalar(0.9), dF)
    val dp = ArrayList<Mat>()
    Core.split(desat, dp)
    val outP = ArrayList<Mat>()
    for (c in 0..2) {
      val pf = toFloat(dp[c])
      val r = Mat()
      Core.add(pf, dF, r)
      val u = Mat()
      r.convertTo(u, CvType.CV_8UC1)
      outP.add(u)
      pf.release()
    }
    val sharpBgr = Mat()
    Core.merge(outP, sharpBgr)
    val rgba = Mat()
    Imgproc.cvtColor(sharpBgr, rgba, Imgproc.COLOR_BGR2BGRA)
    return rgba
  }

  /** 影印 v7（Python 定案）：增益場歸一化 -> CLAHE(3.0) -> S 曲線 -> 墨跡軟填充(不加粗) -> unsharp(σ1.2) */
  private fun applyCopyFilter(bgra: Mat): Mat {
    val gray0 = Mat()
    Imgproc.cvtColor(bgra, gray0, Imgproc.COLOR_BGRA2GRAY)
    val gain = sharedLumaGain(gray0, 255.0, 2.4)
    val gF = toFloat(gray0)
    val nF = Mat()
    Core.multiply(gF, gain, nF)
    val norm = Mat()
    nF.convertTo(norm, CvType.CV_8UC1)

    val clahe = Imgproc.createCLAHE(3.0, Size(8.0, 8.0))
    val eq = Mat()
    clahe.apply(norm, eq)

    val lut = Mat(1, 256, CvType.CV_8UC1)
    lut.put(0, 0, buildToneCurve())
    val toned = Mat()
    Core.LUT(eq, lut, toned)

    // 墨跡軟填充（無膨脹）：羽化 mask 把筆畫灰邊壓到 <=70，blend 0.75 —— 細字更實、筆畫不變粗
    val ink = Mat()
    Imgproc.threshold(toned, ink, 160.0, 255.0, Imgproc.THRESH_BINARY_INV)
    val aF = Mat()
    Imgproc.GaussianBlur(ink, aF, Size(0.0, 0.0), 1.2)
    aF.convertTo(aF, CvType.CV_32FC1) // 8U -> 32F，否則與 32F 的 diff 做 multiply 拋類型異常
    Core.multiply(aF, Scalar(0.75 / 255.0), aF)
    val tF = toFloat(toned)
    val dark = Mat()
    Core.min(tF, Mat(tF.size(), tF.type(), Scalar(70.0)), dark)
    val diff = Mat()
    Core.subtract(dark, tF, diff)
    val add = Mat()
    Core.multiply(diff, aF, add)
    val outF = Mat()
    Core.add(tF, add, outF)
    val boosted = Mat()
    outF.convertTo(boosted, CvType.CV_8UC1)

    val blur = Mat()
    Imgproc.GaussianBlur(boosted, blur, Size(0.0, 0.0), 1.2)
    val sharpened = Mat()
    Core.addWeighted(boosted, 2.2, blur, -1.2, 0.0, sharpened)

    val rgba = Mat()
    Imgproc.cvtColor(sharpened, rgba, Imgproc.COLOR_GRAY2BGRA)
    return rgba
  }

  // ---------- 主流程 ----------

  private fun process(path: String, corners: List<Double>, mode: String, preview: Boolean, toA4: Boolean): Map<String, Any?> {
    val bmp = decodeRotated(path, if (preview) 2800 else 3800)
    val w = bmp.width
    val h = bmp.height

    val raw = listOf(
      Point(corners[0] * w, corners[1] * h),
      Point(corners[2] * w, corners[3] * h),
      Point(corners[4] * w, corners[5] * h),
      Point(corners[6] * w, corners[7] * h),
    )
    val srcPts = orderCorners(raw)
    val outW = max(((dist(srcPts[0], srcPts[1]) + dist(srcPts[3], srcPts[2])) / 2.0).roundToInt(), 64)
    val outH = max(((dist(srcPts[0], srcPts[3]) + dist(srcPts[1], srcPts[2])) / 2.0).roundToInt(), 64)

    // 1) 小圖先攤平 -> 搜索拉直角（只在縮圖做一次）
    val angle: Double = try {
      val small = if (max(w, h) > 1200) {
        val s = 1200.0 / max(w, h)
        Bitmap.createScaledBitmap(bmp, (w * s).roundToInt(), (h * s).roundToInt(), true)
      } else {
        bmp
      }
      val sw = max(((dist(srcPts[0], srcPts[1]) + dist(srcPts[3], srcPts[2])) / 2.0 * small.width / w).roundToInt(), 64)
      val sh = max(((dist(srcPts[0], srcPts[3]) + dist(srcPts[1], srcPts[2])) / 2.0 * small.height / h).roundToInt(), 64)
      val smallScale = small.width.toDouble() / w
      val srcSmall = srcPts.map { Point(it.x * smallScale, it.y * smallScale) }
      val srcMat = MatOfPoint2f(*srcSmall.toTypedArray())
      val dstMat = MatOfPoint2f(Point(0.0, 0.0), Point(sw.toDouble(), 0.0), Point(sw.toDouble(), sh.toDouble()), Point(0.0, sh.toDouble()))
      val m0 = Imgproc.getPerspectiveTransform(srcMat, dstMat)
      val bgr0 = bitmapToBgra(small)
      val flat0 = Mat()
      Imgproc.warpPerspective(bgr0, flat0, m0, Size(sw.toDouble(), sh.toDouble()))
      val flat0Bmp = bgraToBitmap(flat0)
      searchAngle(flat0Bmp)
    } catch (e: Throwable) {
      0.0
    }

    // 2) 複合單次 warp：攤平 + 拉直（避免二次重採樣模糊）
    val (dstCorners, nw, nh) = rotatedDstQuad(outW, outH, angle)
    val src = MatOfPoint2f(*srcPts.toTypedArray())
    val dst = MatOfPoint2f(*dstCorners)
    val bgr = bitmapToBgra(bmp)
    val m = Imgproc.getPerspectiveTransform(src, dst)
    val warped = Mat()
    Imgproc.warpPerspective(bgr, warped, m, Size(nw.toDouble(), nh.toDouble()),
      Imgproc.INTER_LINEAR, Core.BORDER_CONSTANT, Scalar(255.0, 255.0, 255.0, 255.0))

    // 3) 濾鏡
    val processed = if (mode == "copy") applyCopyFilter(warped) else applyColorWhite(warped)

    val outBmp = bgraToBitmap(processed)
    val finalBmp = if (toA4) padToA4(outBmp) else outBmp

    val dir = appContext.reactContext?.cacheDir ?: error("No cache dir")
    val file = File(dir, "c2d_${System.currentTimeMillis()}_${if (preview) "p" else "f"}.jpg")
    FileOutputStream(file).use { finalBmp.compress(Bitmap.CompressFormat.JPEG, 94, it) }
    return mapOf("path" to file.absolutePath, "width" to finalBmp.width, "height" to finalBmp.height)
  }

  /** 置中貼到 A4 比例（1:√2）白色畫布 */
  private fun padToA4(bmp: Bitmap): Bitmap {
    val w = bmp.width
    val h = bmp.height
    val ar = 1.4142
    var cw = w
    var ch = h
    if (h >= w) {
      if (h.toDouble() / w < ar) ch = (w * ar).roundToInt() else cw = (h / ar).roundToInt()
    } else {
      if (w.toDouble() / h < ar) cw = (h * ar).roundToInt() else ch = (w / ar).roundToInt()
    }
    val canvasBmp = Bitmap.createBitmap(cw, ch, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(canvasBmp)
    canvas.drawColor(Color.WHITE)
    canvas.drawBitmap(bmp, ((cw - w) / 2.0f), ((ch - h) / 2.0f), null)
    return canvasBmp
  }
}

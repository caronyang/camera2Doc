// Camera2Doc 原生模組型別

export type FilterMode = 'original' | 'copy';

export interface DetectResult {
  /** 四角歸一化座標 [x0,y0, x1,y1, x2,y2, x3,y3]，順序 tl→tr→br→bl；未偵測到時為空陣列 */
  corners: number[];
  /** 是否成功偵測到文件 */
  detected: boolean;
  /** 已依 EXIF 正規化後的圖片像素寬 */
  width: number;
  /** 已依 EXIF 正規化後的圖片像素高 */
  height: number;
}

export interface ProcessOptions {
  mode: FilterMode;
  /** true 為快速預覽（較低解析度），false 為全解析度輸出 */
  preview?: boolean;
  /** true 時置中貼到 A4 比例白底畫布（預設 true） */
  toA4?: boolean;
}

export interface ProcessResult {
  /** 輸出 JPEG 的絕對路徑（app cache 目錄） */
  path: string;
  width: number;
  height: number;
}

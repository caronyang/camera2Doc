// Camera2Doc 資料模型

export type FilterMode = 'original' | 'copy';

/** 一頁掃描結果 */
export interface ScanPage {
  id: string;
  /** 原始照片（app cache）file uri */
  sourceUri: string;
  /** 原始照片經 EXIF 正規化後的像素尺寸 */
  width: number;
  height: number;
  /** 文件四角歸一化座標 [tl, tr, br, bl] 共 8 個 0..1 數值 */
  corners: number[];
  /** 套用的色調模式 */
  mode: FilterMode;
  /** 全解析度攤平+濾鏡輸出的 JPEG（file uri） */
  processedUri?: string;
  processedWidth?: number;
  processedHeight?: number;
}

/** 拍攝/匯入後、尚未存為頁面的草稿 */
export interface DraftPage {
  sourceUri: string;
  width: number;
  height: number;
  /** null 代表尚未偵測 */
  corners: number[] | null;
  /** 重新編輯既有頁面時帶入 */
  mode?: FilterMode;
  editingId?: string;
}

export const DEFAULT_CORNERS = [0.06, 0.06, 0.94, 0.06, 0.94, 0.94, 0.06, 0.94];

export const MODE_LABEL: Record<FilterMode, string> = {
  original: '原色',
  copy: '影印',
};

export function makeId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function toFileUri(pathOrUri: string): string {
  return pathOrUri.startsWith('file://') ? pathOrUri : `file://${pathOrUri}`;
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

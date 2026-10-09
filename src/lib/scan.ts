// 對原生模組的高階封裝：偵測、攤平輸出
import { Image as RNImage } from 'react-native';

import * as Camera2Doc from '../../modules/camera2doc/src/Camera2DocModule';
import { DEFAULT_CORNERS, type DraftPage, type FilterMode } from './model';

export interface AutoDetectResult {
  corners: number[];
  /** 是否成功自動偵測到文件（false 時 corners 為預設內縮框） */
  detected: boolean;
  width: number;
  height: number;
}

/** RN 原生 Image.getSize 封裝成 Promise（detectCorners 異常時備援取尺寸） */
function getSizeAsync(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    RNImage.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve({ width: 0, height: 0 })
    );
  });
}

/** 自動偵測文件四角；失敗時回傳預設框（讓使用者手動拖） */
export async function autoDetect(uri: string): Promise<AutoDetectResult> {
  const result = await Camera2Doc.detectCorners(uri);
  const valid = !!result && result.detected && result.corners.length === 8;
  let width = result?.width ?? 0;
  let height = result?.height ?? 0;
  if (!width || !height) {
    const size = await getSizeAsync(uri);
    width = size.width;
    height = size.height;
  }
  return {
    corners: valid ? result.corners : DEFAULT_CORNERS,
    detected: valid,
    width,
    height,
  };
}

/** 依草稿的四角與模式產生攤平輸出 */
export async function renderProcessed(
  draft: Pick<DraftPage, 'sourceUri' | 'corners'>,
  mode: FilterMode,
  opts: { preview: boolean; toA4: boolean }
): Promise<Camera2Doc.ProcessResult> {
  return await Camera2Doc.process(draft.sourceUri, draft.corners ?? DEFAULT_CORNERS, {
    mode,
    preview: opts.preview,
    toA4: opts.toA4,
  });
}

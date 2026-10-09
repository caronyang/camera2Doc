import { NativeModule, requireNativeModule } from 'expo';

import type {
  DetectResult,
  FilterMode,
  ProcessOptions,
  ProcessResult,
} from './Camera2Doc.types';

declare class Camera2DocNative extends NativeModule {
  detectCorners(uri: string): Promise<DetectResult>;
  process(uri: string, corners: number[], options: ProcessOptions): Promise<ProcessResult>;
}

const native = requireNativeModule<Camera2DocNative>('Camera2Doc');

/**
 * 偵測文件四角。回傳歸一化座標（tl→tr→br→bl）；找不到文件時 corners 為 null。
 * 失败或不可用（例如 web）時同樣回傳 null，讓上層改用預設框。
 */
export async function detectCorners(uri: string): Promise<DetectResult | null> {
  try {
    return await native.detectCorners(uri);
  } catch {
    return null;
  }
}

/**
 * 依四角做透視攤平 + 濾鏡，回傳輸出 JPEG 路徑與尺寸。
 */
export async function process(
  uri: string,
  corners: number[],
  options: ProcessOptions
): Promise<ProcessResult> {
  return await native.process(uri, corners, options);
}

export type { DetectResult, FilterMode, ProcessOptions, ProcessResult };

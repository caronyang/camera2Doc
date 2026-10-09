import type { DetectResult, FilterMode, ProcessOptions, ProcessResult } from './Camera2Doc.types';

// Camera2Doc 依賴原生（OpenCV / Vision），網頁環境不提供。
export async function detectCorners(_uri: string): Promise<DetectResult | null> {
  return null;
}

export async function process(
  _uri: string,
  _corners: number[],
  _options: ProcessOptions
): Promise<ProcessResult> {
  throw new Error('Camera2Doc is not supported on web');
}

export type { DetectResult, FilterMode, ProcessOptions, ProcessResult };

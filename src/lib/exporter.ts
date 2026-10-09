// 匯出：單頁存照片／PDF、多頁合併一份 PDF
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

import { renderProcessed } from './scan';
import { base64ToBytes, buildPdf } from './pdf';
import { toFileUri, type ScanPage } from './model';

async function readJpeg(uri: string): Promise<Uint8Array> {
  const file = new File(uri);
  const b64 = await file.base64();
  return base64ToBytes(b64);
}

/** 確保頁面已完成全解析度攤平輸出；回傳（可能更新過的）頁面 */
export async function ensureProcessed(page: ScanPage): Promise<ScanPage> {
  if (page.processedUri && page.processedWidth && page.processedHeight) {
    return page;
  }
  const result = await renderProcessed(page, page.mode, { preview: false, toA4: true });
  return {
    ...page,
    processedUri: toFileUri(result.path),
    processedWidth: result.width,
    processedHeight: result.height,
  };
}

async function shareFile(uri: string, mimeType: string, dialogTitle: string): Promise<void> {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType,
      dialogTitle,
      UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : 'public.jpeg',
    });
  }
}

function stamp(): string {
  const d = new Date();
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 一頁：存成照片（分享／另存，可選儲存到相簿） */
export async function exportImage(page: ScanPage, options?: { saveToGallery?: boolean }): Promise<string> {
  const done = await ensureProcessed(page);
  const uri = done.processedUri!;
  if (options?.saveToGallery) {
    await saveToPhotoLibrary(uri);
  }
  await shareFile(uri, 'image/jpeg', '儲存掃描照片');
  return uri;
}

/** 一頁：存成 PDF */
export async function exportSinglePdf(page: ScanPage): Promise<string> {
  return exportPdf([page]);
}

/** 多頁：合併成一份 A4 PDF（依頁面順序） */
export async function exportPdf(pages: ScanPage[]): Promise<string> {
  const images: { bytes: Uint8Array; width: number; height: number }[] = [];
  for (const page of pages) {
    const done = await ensureProcessed(page);
    const bytes = await readJpeg(done.processedUri!);
    images.push({ bytes, width: done.processedWidth!, height: done.processedHeight! });
  }
  const pdfBytes = buildPdf(images);

  const name = `camera2doc_${stamp()}.pdf`;
  const target = new File(Paths.document, name);
  target.create({ overwrite: true });
  target.write(pdfBytes);

  await shareFile(target.uri, 'application/pdf', '儲存掃描文件 PDF');
  return target.uri;
}

/** 嘗試儲存到系統相簿；Android 13+ / iOS 皆用 media library */
export async function saveToPhotoLibrary(uri: string): Promise<boolean> {
  try {
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (!permission.granted) return false;
    await MediaLibrary.saveToLibraryAsync(uri);
    return true;
  } catch {
    return false;
  }
}

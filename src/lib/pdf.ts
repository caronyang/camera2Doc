/**
 * 極簡 PDF 產生器（純 JS，無第三方依賴）
 * - 每頁為 A4（595.28 x 841.89 pt）
 * - JPEG 以 DCTDecode 直接嵌入（不重編碼，速度快、零失真）
 * - 圖片依比例置中縮放，留 24pt 邊距
 */

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 24;

export interface PdfImage {
  /** JPEG 原始位元組 */
  bytes: Uint8Array;
  /** 像素寬 */
  width: number;
  /** 像素高 */
  height: number;
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_VALUES: number[] = (() => {
  const table: number[] = new Array(128).fill(0);
  for (let i = 0; i < B64_ALPHABET.length; i++) table[B64_ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/** 不依賴 atob（Hermes 不保證）的 base64 解碼 */
export function base64ToBytes(base64: string): Uint8Array {
  const src = base64;
  let outLen = Math.floor((src.length * 3) / 4);
  // 扣除補字元
  if (src.endsWith('==')) outLen -= 2;
  else if (src.endsWith('=')) outLen -= 1;
  const out = new Uint8Array(outLen);
  let o = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src.charCodeAt(i);
    if (ch === 61 /* '=' */ || ch === 10 /* \n */ || ch === 13 /* \r */) continue;
    if (ch > 127) continue;
    const v = B64_VALUES[ch];
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return o === outLen ? out : out.slice(0, o);
}

export function buildPdf(images: PdfImage[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let pos = 0;
  const offsets: number[] = [];

  const put = (s: string) => {
    const b = encoder.encode(s);
    chunks.push(b);
    pos += b.length;
  };
  const putBytes = (b: Uint8Array) => {
    chunks.push(b);
    pos += b.length;
  };
  const startObj = (n: number) => {
    offsets[n] = pos;
  };
  const num = (v: number) => v.toFixed(2);

  put('%PDF-1.4\n');

  const n = images.length;
  // 物件編號：1=catalog 2=pages，每頁 i(0-based)：page=3+3i image=4+3i content=5+3i
  startObj(1);
  put('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const kids = images.map((_, i) => `${3 + 3 * i} 0 R`).join(' ');
  startObj(2);
  put(`2 0 obj\n<< /Type /Pages /Count ${n} /Kids [${kids}] >>\nendobj\n`);

  images.forEach((img, i) => {
    const pageN = 3 + 3 * i;
    const imgN = 4 + 3 * i;
    const conN = 5 + 3 * i;

    const scale = Math.min((A4_W - 2 * MARGIN) / img.width, (A4_H - 2 * MARGIN) / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (A4_W - w) / 2;
    const y = (A4_H - h) / 2;

    startObj(pageN);
    put(
      `${pageN} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(A4_W)} ${num(A4_H)}] ` +
        `/Resources << /XObject << /Im${i} ${imgN} 0 R >> >> /Contents ${conN} 0 R >>\nendobj\n`
    );

    startObj(imgN);
    put(
      `${imgN} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`
    );
    putBytes(img.bytes);
    put('\nendstream\nendobj\n');

    startObj(conN);
    const content = `q\n${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm\n/Im${i} Do\nQ\n`;
    put(`${conN} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
  });

  const total = 2 + 3 * n;
  const xrefPos = pos;
  put(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= total; i++) {
    put(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  put(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let cursor = 0;
  for (const c of chunks) {
    out.set(c, cursor);
    cursor += c.length;
  }
  return out;
}

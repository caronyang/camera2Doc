// 輕量級 i18n：英文（預設）/ 繁體中文，設定持久化於 document/settings.json
import { File, Paths } from 'expo-file-system';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

export type Language = 'en' | 'zh';

const en = {
  home: {
    subtitle: 'Scan photos · Flatten to A4 · Copier quality',
    emptyTitle: 'No scans yet',
    emptyHint: 'Point your camera at a document — edges are detected automatically and pages are flattened to A4.',
    startScan: 'Start scanning',
    pagesHint: (n: number) => `${n} page${n === 1 ? '' : 's'} · tap a card to re-adjust borders & tone`,
    addScan: '+ Add scan',
    exportPdf: (n: number) => `Export ${n}-page PDF`,
    pageLabel: (i: number) => `Page ${i}`,
    menuTitle: 'Page actions',
    savePhoto: 'Save as photo (JPEG)',
    savePdf: 'Save as PDF (this page)',
    deletePage: 'Delete this page',
    cancel: 'Cancel',
    busyPdf: 'Building PDF…',
    busyProcess: 'Processing…',
    exportFailed: 'Export failed',
    settings: 'Settings',
  },
  capture: {
    title: 'Scan document',
    permissionHint: 'Camera2Doc needs camera access to scan documents.',
    allowCamera: 'Allow camera access',
    back: 'Back',
    detecting: 'Detecting document…',
    album: 'Album',
    flip: 'Flip',
  },
  crop: {
    hint: 'Drag the corners to align with the document edges',
    retake: 'Retake',
    cancel: 'Cancel',
    redetect: 'Re-detect',
    next: 'Next',
  },
  filters: {
    title: 'Choose tone',
    updateTitle: 'Update page',
    backToCrop: '‹ Borders',
    scanAnother: 'Scan another',
    back: '‹ Back',
    done: 'Done',
    saveChanges: 'Save changes',
    processing: 'Processing…',
    generatingPreview: 'Rendering preview…',
    failed: 'Processing failed',
  },
  settings: {
    title: 'Settings',
    language: 'Language',
    languageHint: 'Applies to the entire app immediately.',
  },
  mode: {
    original: 'Original',
    copy: 'B&W copy',
  },
};

export type Strings = typeof en;

const zh: Strings = {
  home: {
    subtitle: '拍照掃描 · 攤平 A4 · 影印品質',
    emptyTitle: '還沒有掃描頁面',
    emptyHint: '對準文件拍照，自動偵測邊界並攤平成 A4',
    startScan: '開始掃描',
    pagesHint: (n: number) => `共 ${n} 頁 · 點卡片可重新調整邊界與色調`,
    addScan: '+ 新增掃描',
    exportPdf: (n: number) => `匯出 ${n} 頁 PDF`,
    pageLabel: (i: number) => `第 ${i} 頁`,
    menuTitle: '頁面操作',
    savePhoto: '存成照片（JPEG）',
    savePdf: '存成 PDF（單頁）',
    deletePage: '刪除這一頁',
    cancel: '取消',
    busyPdf: '產生 PDF 中…',
    busyProcess: '處理中…',
    exportFailed: '匯出失敗',
    settings: '設定',
  },
  capture: {
    title: '掃描文件',
    permissionHint: 'Camera2Doc 需要使用相機來掃描文件',
    allowCamera: '允許相機權限',
    back: '返回',
    detecting: '自動偵測文件中…',
    album: '相簿',
    flip: '翻轉',
  },
  crop: {
    hint: '拖動四角對齊文件邊緣',
    retake: '重拍',
    cancel: '取消',
    redetect: '重新偵測',
    next: '下一步',
  },
  filters: {
    title: '選擇色調',
    updateTitle: '更新頁面',
    backToCrop: '‹ 調整邊界',
    scanAnother: '再掃一頁',
    back: '‹ 返回',
    done: '完成',
    saveChanges: '儲存變更',
    processing: '處理中…',
    generatingPreview: '產生預覽…',
    failed: '處理失敗',
  },
  settings: {
    title: '設定',
    language: '語言',
    languageHint: '立即套用於整個 App。',
  },
  mode: {
    original: '原色',
    copy: '影印',
  },
};

export const STRINGS: Record<Language, Strings> = { en, zh };

export const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '繁體中文' },
];

interface LanguageValue {
  lang: Language;
  strings: Strings;
  setLanguage: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageValue | null>(null);

function settingsFile(): File {
  return new File(Paths.document, 'settings.json');
}

export function LanguageProvider({ children }: PropsWithChildren) {
  const [lang, setLang] = useState<Language>('en');

  useEffect(() => {
    void Promise.resolve().then(async () => {
      try {
        const file = settingsFile();
        if (!file.exists) return;
        const parsed = JSON.parse(await file.text());
        if (parsed?.language === 'zh' || parsed?.language === 'en') {
          setLang(parsed.language as Language);
        }
      } catch {
        // 讀取失敗時保持預設英文
      }
    });
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLang(next);
    try {
      const file = settingsFile();
      file.create({ overwrite: true });
      file.write(JSON.stringify({ language: next }));
    } catch {
      // 寫入失敗不影響當次使用
    }
  }, []);

  const value = useMemo<LanguageValue>(
    () => ({ lang, strings: STRINGS[lang], setLanguage }),
    [lang, setLanguage]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useApp(): LanguageValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useApp must be used within a LanguageProvider');
  }
  return ctx;
}

export function useStrings(): Strings {
  return useApp().strings;
}

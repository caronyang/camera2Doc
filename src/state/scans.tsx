// 掃描頁面清單與目前草稿的狀態管理
import React, { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';

import type { DraftPage, ScanPage } from '@/lib/model';

interface ScansValue {
  pages: ScanPage[];
  draft: DraftPage | null;
  setDraft: (draft: DraftPage | null) => void;
  addPage: (page: ScanPage) => void;
  updatePage: (id: string, patch: Partial<ScanPage>) => void;
  removePage: (id: string) => void;
  clearAll: () => void;
}

const ScansContext = createContext<ScansValue | null>(null);

export function ScanProvider({ children }: PropsWithChildren) {
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [draft, setDraftState] = useState<DraftPage | null>(null);

  const setDraft = useCallback((next: DraftPage | null) => setDraftState(next), []);
  const addPage = useCallback((page: ScanPage) => setPages((prev) => [...prev, page]), []);
  const updatePage = useCallback(
    (id: string, patch: Partial<ScanPage>) =>
      setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p))),
    []
  );
  const removePage = useCallback((id: string) => setPages((prev) => prev.filter((p) => p.id !== id)), []);
  const clearAll = useCallback(() => setPages([]), []);

  const value = useMemo(
    () => ({ pages, draft, setDraft, addPage, updatePage, removePage, clearAll }),
    [pages, draft, setDraft, addPage, updatePage, removePage, clearAll]
  );

  return <ScansContext.Provider value={value}>{children}</ScansContext.Provider>;
}

export function useScans(): ScansValue {
  const ctx = useContext(ScansContext);
  if (!ctx) {
    throw new Error('useScans must be used within a ScanProvider');
  }
  return ctx;
}

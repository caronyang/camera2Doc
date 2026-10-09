// 色調畫面：選擇「原色 / 影印」並預覽；完成後產生全解析度攤平輸出
import { Image } from 'expo-image';
import { Redirect, router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, colors, SpinnerOverlay } from '@/components/ui';
import { useStrings } from '@/lib/i18n';
import { renderProcessed } from '@/lib/scan';
import { makeId, toFileUri, type FilterMode, type ScanPage } from '@/lib/model';
import { useScans } from '@/state/scans';

export default function FiltersScreen() {
  const insets = useSafeAreaInsets();
  const s = useStrings();
  const { draft, setDraft, addPage, updatePage } = useScans();
  const [mode, setMode] = useState<FilterMode>(draft?.mode ?? 'copy');
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(true);
  const [busy, setBusy] = useState(false);
  const previewSeq = useRef(0);

  useEffect(() => {
    if (!draft) return;
    const seq = ++previewSeq.current;
    void Promise.resolve().then(async () => {
      if (seq !== previewSeq.current) return;
      setPreviewBusy(true);
      try {
        const r = await renderProcessed(draft, mode, { preview: true, toA4: false });
        if (seq === previewSeq.current) setPreviewUri(toFileUri(r.path));
      } catch (e) {
        console.warn('preview failed', e);
      } finally {
        if (seq === previewSeq.current) setPreviewBusy(false);
      }
    });
  }, [draft, mode]);

  if (!draft) {
    return <Redirect href="/" />;
  }

  const commit = async (then: 'home' | 'again') => {
    if (busy || previewBusy || !draft) return;
    setBusy(true);
    try {
      const result = await renderProcessed(draft, mode, { preview: false, toA4: true });
      const page: ScanPage = {
        id: draft.editingId ?? makeId(),
        sourceUri: draft.sourceUri,
        width: draft.width,
        height: draft.height,
        corners: draft.corners ?? [],
        mode,
        processedUri: toFileUri(result.path),
        processedWidth: result.width,
        processedHeight: result.height,
      };
      if (draft.editingId) {
        updatePage(draft.editingId, page);
      } else {
        addPage(page);
      }
      setDraft(null);
      if (then === 'again') {
        // 返回（已在堆疊中的）拍攝畫面續掃
        router.dismissTo('/capture');
      } else {
        router.dismissTo('/');
      }
    } catch (e) {
      Alert.alert(s.filters.failed, `${e}`);
    } finally {
      setBusy(false);
    }
  };

  const editing = !!draft.editingId;

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>{s.filters.backToCrop}</Text>
        </Pressable>
        <Text style={styles.title}>{editing ? s.filters.updateTitle : s.filters.title}</Text>
      </View>

      <View style={styles.previewBox}>
        {previewUri ? (
          <Image source={{ uri: previewUri }} style={styles.preview} contentFit="contain" transition={150} />
        ) : (
          <View style={styles.previewPlaceholder} />
        )}
      </View>

      <View style={styles.modeRow}>
        {(['original', 'copy'] as FilterMode[]).map((m) => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            style={[styles.modeChip, mode === m && styles.modeChipActive]}
          >
            <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>{s.mode[m]}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.actions}>
        {!editing && <Button label={s.filters.scanAnother} variant="ghost" onPress={() => commit('again')} disabled={busy || previewBusy} />}
        <Button label={s.filters.back} variant="ghost" onPress={() => router.back()} disabled={busy || previewBusy} />
        <Button label={editing ? s.filters.saveChanges : s.filters.done} onPress={() => commit('home')} disabled={busy || previewBusy} />
      </View>

      <SpinnerOverlay visible={busy || previewBusy} text={previewBusy ? s.filters.generatingPreview : s.filters.processing} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  back: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  previewBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  preview: { width: '100%', height: '100%' },
  previewPlaceholder: { width: '100%', height: '100%', borderRadius: 12, backgroundColor: colors.card },
  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 12 },
  modeChip: { paddingHorizontal: 22, paddingVertical: 10, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  modeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeText: { color: colors.subtle, fontSize: 15, fontWeight: '600' },
  modeTextActive: { color: '#fff' },
  actions: { flexDirection: 'row', gap: 12, padding: 16 },
});

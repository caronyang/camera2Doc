// 首頁：掃描頁面清單、頁面操作（編輯/刪單頁圖或 PDF）、全部匯出
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, colors } from '@/components/ui';
import { exportImage, exportPdf, exportSinglePdf } from '@/lib/exporter';
import { useStrings } from '@/lib/i18n';
import type { ScanPage } from '@/lib/model';
import { useScans } from '@/state/scans';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const s = useStrings();
  const { pages, setDraft, removePage } = useScans();
  const [busyText, setBusyText] = useState<string | null>(null);
  const [menuPage, setMenuPage] = useState<ScanPage | null>(null);

  const editPage = (page: ScanPage) => {
    setDraft({
      sourceUri: page.sourceUri,
      width: page.width,
      height: page.height,
      corners: page.corners,
      mode: page.mode,
      editingId: page.id,
    });
    router.push('/crop');
  };

  const runExportPdf = async () => {
    if (!pages.length) return;
    setBusyText(s.home.busyPdf);
    try {
      await exportPdf(pages);
    } catch (e) {
      Alert.alert(s.home.exportFailed, `${e}`);
    } finally {
      setBusyText(null);
    }
  };

  const saveAsImage = async (page: ScanPage) => {
    setMenuPage(null);
    setBusyText(s.home.busyProcess);
    try {
      await exportImage(page);
    } catch (e) {
      Alert.alert(s.home.exportFailed, `${e}`);
    } finally {
      setBusyText(null);
    }
  };

  const saveAsPdf = async (page: ScanPage) => {
    setMenuPage(null);
    setBusyText(s.home.busyPdf);
    try {
      await exportSinglePdf(page);
    } catch (e) {
      Alert.alert(s.home.exportFailed, `${e}`);
    } finally {
      setBusyText(null);
    }
  };

  const renderItem = ({ item, index }: { item: ScanPage; index: number }) => (
    <View style={[styles.card, index % 2 === 1 && { marginLeft: 12 }]}>
      <Pressable style={styles.cardHit} onPress={() => editPage(item)}>
        <Image
          source={{ uri: item.processedUri ?? item.sourceUri }}
          style={[styles.thumb, { aspectRatio: (item.processedWidth ?? item.width) / (item.processedHeight ?? item.height) || 0.707 }]}
          contentFit="cover"
          transition={120}
        />
        <View style={styles.cardFooter}>
          <Text style={styles.cardTitle}>{s.home.pageLabel(index + 1)}</Text>
          <Text style={styles.cardMode}>{s.mode[item.mode]}</Text>
        </View>
      </Pressable>
      <Pressable onPress={() => setMenuPage(item)} hitSlop={8} style={styles.moreBtn}>
        <Text style={styles.moreBtnText}>⋯</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.logo}>Camera2Doc</Text>
          <Text style={styles.subtitle}>{s.home.subtitle}</Text>
        </View>
        <Pressable onPress={() => router.push('/settings')} hitSlop={10} style={styles.gear}>
          <Text style={styles.gearText}>⚙</Text>
        </Pressable>
      </View>

      {pages.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📄</Text>
          <Text style={styles.emptyTitle}>{s.home.emptyTitle}</Text>
          <Text style={styles.emptyHint}>{s.home.emptyHint}</Text>
          <Button label={s.home.startScan} style={styles.emptyBtn} onPress={() => router.push('/capture')} />
        </View>
      ) : (
        <>
          <FlatList
            data={pages}
            keyExtractor={(p) => p.id}
            numColumns={2}
            contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingBottom: 8 }}
            renderItem={renderItem}
            ListHeaderComponent={<Text style={styles.listHint}>{s.home.pagesHint(pages.length)}</Text>}
          />
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 14 }]}>
            <Button label={s.home.addScan} variant="ghost" onPress={() => router.push('/capture')} />
            <Button label={s.home.exportPdf(pages.length)} onPress={runExportPdf} />
          </View>
        </>
      )}

      {/* 單頁操作選單 */}
      <Modal transparent visible={!!menuPage} animationType="fade" onRequestClose={() => setMenuPage(null)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuPage(null)}>
          <View style={[styles.menuCard, { marginBottom: insets.bottom + 24 }]}>
            <Text style={styles.menuTitle}>{s.home.menuTitle}</Text>
            <MenuItem label={s.home.savePhoto} onPress={() => menuPage && saveAsImage(menuPage)} />
            <MenuItem label={s.home.savePdf} onPress={() => menuPage && saveAsPdf(menuPage)} />
            <MenuItem
              label={s.home.deletePage}
              danger
              onPress={() => {
                if (menuPage) removePage(menuPage.id);
                setMenuPage(null);
              }}
            />
            <MenuItem label={s.home.cancel} onPress={() => setMenuPage(null)} />
          </View>
        </Pressable>
      </Modal>

      {busyText && (
        <View style={styles.busyBar}>
          <Text style={styles.busyText}>{busyText}</Text>
        </View>
      )}
    </View>
  );
}

function MenuItem({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuItem, pressed && { opacity: 0.7 }]}>
      <Text style={[styles.menuItemText, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 10 },
  gear: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  gearText: { color: colors.subtle, fontSize: 24 },
  logo: { color: colors.text, fontSize: 26, fontWeight: '800' },
  subtitle: { color: colors.subtle, fontSize: 13, marginTop: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyIcon: { fontSize: 44 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  emptyHint: { color: colors.subtle, fontSize: 14, textAlign: 'center' },
  emptyBtn: { marginTop: 18, minWidth: 160 },
  listHint: { color: colors.subtle, fontSize: 12, paddingHorizontal: 4, paddingBottom: 6 },
  card: { flex: 1, backgroundColor: colors.card, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: colors.line },
  cardHit: { flex: 1 },
  thumb: { width: '100%', minHeight: 120, backgroundColor: '#000' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10 },
  cardTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
  cardMode: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  moreBtn: { position: 'absolute', top: 6, right: 6, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  moreBtnText: { color: '#fff', fontSize: 16, marginTop: -6 },
  bottomBar: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.line },
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', alignItems: 'center' },
  menuCard: { width: '86%', backgroundColor: colors.card, borderRadius: 18, paddingVertical: 10, borderWidth: 1, borderColor: colors.line },
  menuTitle: { color: colors.subtle, fontSize: 12, textAlign: 'center', paddingVertical: 8 },
  menuItem: { paddingVertical: 14, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.line },
  menuItemText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  busyBar: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  busyText: { color: '#fff', fontSize: 15, backgroundColor: colors.card, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
});

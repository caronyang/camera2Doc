// 設定畫面：語言切換（English / 繁體中文）
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/components/ui';
import { LANGUAGE_OPTIONS, useApp, useStrings } from '@/lib/i18n';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { lang, setLanguage } = useApp();
  const s = useStrings();

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>{s.settings.title}</Text>
        <View style={styles.backSpace} />
      </View>

      <Text style={styles.section}>{s.settings.language}</Text>
      <View style={styles.card}>
        {LANGUAGE_OPTIONS.map((opt, idx) => (
          <Pressable
            key={opt.value}
            onPress={() => setLanguage(opt.value)}
            style={[styles.row, idx > 0 && styles.rowBorder]}
          >
            <Text style={[styles.rowLabel, lang === opt.value && styles.rowLabelActive]}>{opt.label}</Text>
            <Text style={[styles.check, lang === opt.value ? styles.checkOn : styles.checkOff]}>✓</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>{s.settings.languageHint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  back: { color: colors.primary, fontSize: 28, lineHeight: 30, width: 36 },
  backSpace: { width: 36 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  section: { color: colors.subtle, fontSize: 13, fontWeight: '600', marginLeft: 20, marginTop: 12, marginBottom: 8, textTransform: 'uppercase' },
  card: { marginHorizontal: 16, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 16 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.line },
  rowLabel: { color: colors.text, fontSize: 16 },
  rowLabelActive: { color: colors.primary, fontWeight: '700' },
  check: { fontSize: 17, fontWeight: '700' },
  checkOn: { color: colors.primary },
  checkOff: { color: 'transparent' },
  hint: { color: colors.subtle, fontSize: 12, marginLeft: 24, marginTop: 10 },
});

// 攤平編輯畫面：拖曳四角校準文件邊界
import { Image } from 'expo-image';
import { Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import CornerEditor from '@/components/CornerEditor';
import { Button, colors } from '@/components/ui';
import { useStrings } from '@/lib/i18n';
import { autoDetect } from '@/lib/scan';
import { DEFAULT_CORNERS } from '@/lib/model';
import { useScans } from '@/state/scans';

export default function CropScreen() {
  const insets = useSafeAreaInsets();
  const s = useStrings();
  const { draft, setDraft } = useScans();
  const [corners, setCorners] = useState<number[]>(draft?.corners ?? DEFAULT_CORNERS);
  const [busy, setBusy] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // 無草稿（如提交後返回）：宣告式重導向，避免 render 期間 setState
  if (!draft) {
    return <Redirect href="/" />;
  }

  const aspect = draft.height > 0 ? draft.width / draft.height : 1;
  // contain 縮放：圖片在 box 內的實際顯示尺寸
  const fitW = Math.min(box.w, box.h * aspect);
  const fitH = fitW / aspect;

  const redetect = async () => {
    setBusy(true);
    try {
      const r = await autoDetect(draft.sourceUri);
      setCorners(r.corners);
      setDraft({ ...draft, corners: r.corners });
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setDraft({ ...draft, corners });
    router.push('/filters');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Text style={styles.header}>{s.crop.hint}</Text>

      <View style={styles.stage} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {box.w > 0 && (
          <View style={{ width: fitW, height: fitH }}>
            <Image
              source={{ uri: draft.sourceUri }}
              style={StyleSheet.absoluteFill}
              contentFit="fill"
              transition={150}
            />
            <CornerEditor displayW={fitW} displayH={fitH} corners={corners} onChange={setCorners} />
          </View>
        )}
        {busy && (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <Button label={draft.editingId ? s.crop.cancel : s.crop.retake} variant="ghost" onPress={() => router.back()} />
        <Button label={s.crop.redetect} variant="ghost" onPress={redetect} disabled={busy} />
        <Button label={s.crop.next} onPress={next} disabled={busy} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center', paddingVertical: 14 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  busy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  actions: { flexDirection: 'row', gap: 12, padding: 16, justifyContent: 'space-between' },
});

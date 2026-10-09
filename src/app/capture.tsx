// 拍攝畫面：相機取景 → 拍照 → 自動偵測文件四角 → 進入攤平編輯
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, colors } from '@/components/ui';
import { useStrings } from '@/lib/i18n';
import { autoDetect } from '@/lib/scan';
import { useScans } from '@/state/scans';

export default function CaptureScreen() {
  const insets = useSafeAreaInsets();
  const s = useStrings();
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const { setDraft } = useScans();

  if (!permission) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (!permission.granted) {
    return (
      <View style={[styles.center, { paddingBottom: insets.bottom }]}>
        <Text style={styles.hint}>{s.capture.permissionHint}</Text>
        <Button label={s.capture.allowCamera} onPress={requestPermission} />
        <Button label={s.capture.back} variant="ghost" style={styles.mt} onPress={() => router.back()} />
      </View>
    );
  }

  const finishCapture = async (uri: string) => {
    const detected = await autoDetect(uri);
    setDraft({
      sourceUri: uri,
      width: detected.width,
      height: detected.height,
      corners: detected.corners,
    });
    router.push('/crop');
  };

  const takePicture = async () => {
    if (busy || !cameraRef.current) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.95 });
      if (!photo?.uri) return;
      await finishCapture(photo.uri);
    } finally {
      setBusy(false);
    }
  };

  // 從相簿匯入既有照片（編輯需求可事後進行）
  const importFromLibrary = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsMultipleSelection: false,
      });
      if (result.canceled || !result.assets?.length) return;
      await finishCapture(result.assets[0].uri);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />

      {/* 頂列 */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.topAction}>✕</Text>
        </Pressable>
        <Text style={styles.title}>{s.capture.title}</Text>
        <Text style={styles.topAction}> </Text>
      </View>

      {/* 底列 */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable onPress={importFromLibrary} disabled={busy} hitSlop={8} style={styles.sideBtn}>
          <Text style={styles.sideBtnText}>{s.capture.album}</Text>
        </Pressable>
        <Pressable onPress={takePicture} disabled={busy} style={({ pressed }) => [styles.shutter, pressed && { opacity: 0.7 }]}>
          <View style={styles.shutterInner} />
        </Pressable>
        <Pressable onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} hitSlop={8} style={styles.sideBtn}>
          <Text style={styles.sideBtnText}>{s.capture.flip}</Text>
        </Pressable>
      </View>
      {busy && (
        <View style={styles.busyOverlay}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.hint}>{s.capture.detecting}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: colors.bg, padding: 24 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  topAction: { color: '#fff', fontSize: 24, width: 36, textAlign: 'center' },
  title: { color: '#fff', fontSize: 16, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 32 },
  sideBtn: { width: 64, alignItems: 'center', paddingVertical: 8 },
  sideBtnText: { color: '#fff', fontSize: 14, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  busyOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', gap: 12 },
  hint: { color: colors.text, fontSize: 14 },
  mt: { marginTop: 4 },
});

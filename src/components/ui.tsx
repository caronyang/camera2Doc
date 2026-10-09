// 共用小型 UI 元件與設計色票
import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

export const colors = {
  bg: '#101418',
  card: '#1b2026',
  line: '#2a3138',
  primary: '#2b8cff',
  danger: '#ff5d5d',
  text: '#f4f6f8',
  subtle: '#9aa4b2',
};

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  style?: object;
};

export function Button({ label, onPress, variant = 'primary', disabled, style }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        variant === 'ghost' && styles.btnGhost,
        variant === 'danger' && styles.btnDanger,
        disabled && styles.btnDisabled,
        pressed && styles.btnPressed,
        style,
      ]}
    >
      <Text style={[styles.btnText, variant === 'ghost' && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export function SpinnerOverlay({ visible, text }: { visible: boolean; text?: string }) {
  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.overlayCard}>
          <ActivityIndicator size="large" color={colors.primary} />
          {!!text && <Text style={styles.overlayText}>{text}</Text>}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line },
  btnDanger: { backgroundColor: colors.danger },
  btnDisabled: { opacity: 0.4 },
  btnPressed: { opacity: 0.85 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    minWidth: 140,
  },
  overlayText: { color: colors.text, marginTop: 12, fontSize: 14 },
});

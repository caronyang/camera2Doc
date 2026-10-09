import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';

import { LanguageProvider } from '@/lib/i18n';
import { ScanProvider } from '@/state/scans';

export const unstable_settings = {
  anchor: 'index',
};

export default function RootLayout() {
  return (
    <LanguageProvider>
      <ScanProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#101418' },
          }}
        >
          <Stack.Screen name="index" options={{ animation: 'fade' }} />
          <Stack.Screen name="capture" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="crop" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="filters" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
        </Stack>
      </ScanProvider>
    </LanguageProvider>
  );
}

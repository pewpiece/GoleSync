import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useConnection } from '../src/store/connection';
import { colors } from '../src/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Boot() {
  const router = useRouter();
  const hydrated = useConnection((s) => s.hydrated);
  const { hasShareIntent } = useShareIntentContext();

  useEffect(() => {
    void useConnection.getState().hydrate();
  }, []);

  useEffect(() => {
    if (hydrated) SplashScreen.hideAsync().catch(() => {});
  }, [hydrated]);

  // Android suspends sockets in the background; reconnect and refresh when we come back.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        const st = useConnection.getState();
        st.reconnectNow();
        void st.refresh();
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (hasShareIntent && hydrated) router.push('/share');
  }, [hasShareIntent, hydrated, router]);

  return null;
}

export default function RootLayout() {
  return (
    <ShareIntentProvider>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="light" />
        <Boot />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="pair" options={{ title: 'Pair with laptop', presentation: 'modal' }} />
          <Stack.Screen name="share" options={{ title: 'Send to laptop', presentation: 'modal' }} />
        </Stack>
      </GestureHandlerRootView>
    </ShareIntentProvider>
  );
}

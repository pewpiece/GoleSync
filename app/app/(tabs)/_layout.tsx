import { Tabs } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';

import { colors } from '../../src/theme';

// Plain glyphs: avoids an icon-font dependency.
const icon = (glyph: string) =>
  function TabIcon({ color, size }: { color: string | import('react-native').OpaqueColorValue; size: number }) {
    return <Text style={{ color, fontSize: size - 2 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerTitle: 'Gsync',
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '800', letterSpacing: 0.5 },
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Inbox', tabBarIcon: icon('\u2193') }} />
      <Tabs.Screen name="send" options={{ title: 'Send', tabBarIcon: icon('\u27A4') }} />
      <Tabs.Screen name="remote" options={{ title: 'Remote', tabBarIcon: icon('\u25CE') }} />
      <Tabs.Screen name="commands" options={{ title: 'Commands', tabBarIcon: icon('>_') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('\u2699') }} />
    </Tabs>
  );
}

import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useConnection } from '../store/connection';
import { colors, spacing } from '../theme';

export function bannerFor(link: string, paused: boolean, lastError: string | null) {
  if (link === 'unpaired') return { text: 'Not paired. Tap to scan your laptop’s QR code.', tone: colors.warn, action: 'pair' as const };
  if (link === 'auth_failed') return { text: 'Laptop rejected this phone. Tap to pair again.', tone: colors.danger, action: 'pair' as const };
  if (link === 'offline') return { text: 'Laptop unreachable. Retrying… (tap to retry now)', tone: colors.danger, action: 'retry' as const };
  if (link === 'connecting') return { text: 'Connecting…', tone: colors.warn, action: null };
  if (paused) return { text: 'Paused on laptop: remote control and commands are off.', tone: colors.warn, action: null };
  if (lastError) return { text: lastError, tone: colors.warn, action: null };
  return null;
}

export function ConnectionBanner() {
  const router = useRouter();
  const { link, paused, lastError, reconnectNow, refresh } = useConnection();
  const b = bannerFor(link, paused, lastError);
  if (!b) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        if (b.action === 'pair') router.push('/pair');
        else if (b.action === 'retry') {
          reconnectNow();
          void refresh();
        }
      }}
      style={[styles.bar, { borderColor: b.tone }]}
    >
      <View style={[styles.dot, { backgroundColor: b.tone }]} />
      <Text style={styles.text}>{b.text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    margin: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: colors.card,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  text: { color: colors.text, flex: 1, fontSize: 13 },
});

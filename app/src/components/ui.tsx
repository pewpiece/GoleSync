import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radius, spacing } from '../theme';

export function tap(kind: 'light' | 'medium' | 'heavy' = 'light') {
  const style = {
    light: Haptics.ImpactFeedbackStyle.Light,
    medium: Haptics.ImpactFeedbackStyle.Medium,
    heavy: Haptics.ImpactFeedbackStyle.Heavy,
  }[kind];
  Haptics.impactAsync(style).catch(() => {});
}

type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  label: string;
  variant?: 'primary' | 'ghost' | 'danger';
  busy?: boolean;
  haptic?: boolean;
  big?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, variant = 'primary', busy, haptic = true, big, style, onPress, disabled, ...rest }: ButtonProps) {
  const bg = variant === 'primary' ? colors.accent : variant === 'danger' ? colors.danger : colors.raised;
  const fg = variant === 'ghost' ? colors.text : colors.onAccent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={(e) => {
        if (haptic) tap();
        onPress?.(e);
      }}
      style={({ pressed }) => [
        styles.btn,
        big && styles.big,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        style,
      ]}
      {...rest}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.btnText, big && styles.bigText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Empty({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.muted}>{hint}</Text> : null}
      {children}
    </View>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}>
      <View style={[styles.fill, { width: `${Math.max(0, Math.min(1, value)) * 100}%` }]} />
    </View>
  );
}

export const text = StyleSheet.create({
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  body: { color: colors.text, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 13 },
});

const styles = StyleSheet.create({
  btn: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  big: { minHeight: 84, borderRadius: radius.lg },
  btnText: { fontSize: 15, fontWeight: '700' },
  bigText: { fontSize: 18 },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.md },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  muted: { color: colors.muted, fontSize: 14, textAlign: 'center' },
  track: { height: 6, backgroundColor: colors.raised, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.accent },
});

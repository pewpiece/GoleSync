import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../../components/ui';
import { colors, spacing } from '../../theme';
import { Trackpad } from './Trackpad';

type Send = (ev: object) => unknown;
export type Mode = 'slides' | 'media' | 'pad' | 'keys';

const MODES: { id: Mode; label: string }[] = [
  { id: 'slides', label: 'Slides' },
  { id: 'media', label: 'Media' },
  { id: 'pad', label: 'Trackpad' },
  { id: 'keys', label: 'Keys' },
];

const key = (k: string) => ({ type: 'key', key: k });
const media = (a: string) => ({ type: 'media', action: a });

export function Remote({ send, disabled }: { send: Send; disabled?: boolean }) {
  const [mode, setMode] = useState<Mode>('slides');
  return (
    <View style={styles.root}>
      <View style={styles.seg}>
        {MODES.map((m) => (
          <Text
            key={m.id}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === m.id }}
            onPress={() => setMode(m.id)}
            style={[styles.segItem, mode === m.id && styles.segActive]}
          >
            {m.label}
          </Text>
        ))}
      </View>
      {mode === 'slides' ? <Slides send={send} disabled={disabled} /> : null}
      {mode === 'media' ? <Media send={send} disabled={disabled} /> : null}
      {mode === 'pad' ? <Pad send={send} disabled={disabled} /> : null}
      {mode === 'keys' ? <Keys send={send} disabled={disabled} /> : null}
    </View>
  );
}

type PanelProps = { send: Send; disabled?: boolean };

function Slides({ send, disabled }: PanelProps) {
  return (
    <View style={styles.panel}>
      <View style={styles.row}>
        <Button big label="Previous" variant="ghost" disabled={disabled} onPress={() => send(key('left'))} style={styles.flex} />
        <Button big label="Next" disabled={disabled} onPress={() => send(key('right'))} style={styles.flex} />
      </View>
      <View style={styles.row}>
        <Button big label="Page Up" variant="ghost" disabled={disabled} onPress={() => send(key('pageup'))} style={styles.flex} />
        <Button big label="Page Down" variant="ghost" disabled={disabled} onPress={() => send(key('pagedown'))} style={styles.flex} />
      </View>
      <View style={styles.row}>
        <Button big label="Start (F5)" disabled={disabled} onPress={() => send(key('f5'))} style={styles.flex} />
        <Button big label="Stop (Esc)" variant="danger" disabled={disabled} onPress={() => send(key('escape'))} style={styles.flex} />
      </View>
    </View>
  );
}

function Media({ send, disabled }: PanelProps) {
  return (
    <View style={styles.panel}>
      <Button big label="Play / Pause" disabled={disabled} onPress={() => send(media('play_pause'))} />
      <View style={styles.row}>
        <Button big label="Previous" variant="ghost" disabled={disabled} onPress={() => send(media('previous'))} style={styles.flex} />
        <Button big label="Next" variant="ghost" disabled={disabled} onPress={() => send(media('next'))} style={styles.flex} />
      </View>
      <View style={styles.row}>
        <Button big label="Vol −" variant="ghost" disabled={disabled} onPress={() => send(media('volume_down'))} style={styles.flex} />
        <Button big label="Vol +" variant="ghost" disabled={disabled} onPress={() => send(media('volume_up'))} style={styles.flex} />
      </View>
      <Button big label="Mute" variant="ghost" disabled={disabled} onPress={() => send(media('mute'))} />
    </View>
  );
}

function Pad({ send, disabled }: PanelProps) {
  return (
    <View style={[styles.panel, { flex: 1 }]}>
      <Trackpad send={send} disabled={disabled} />
      <View style={styles.row}>
        <Button label="Left click" variant="ghost" disabled={disabled} onPress={() => send({ type: 'mouse_click', button: 'left', count: 1 })} style={styles.flex} />
        <Button label="Double" variant="ghost" disabled={disabled} onPress={() => send({ type: 'mouse_click', button: 'left', count: 2 })} style={styles.flex} />
        <Button label="Right click" variant="ghost" disabled={disabled} onPress={() => send({ type: 'mouse_click', button: 'right', count: 1 })} style={styles.flex} />
      </View>
    </View>
  );
}

const SPECIAL: [string, string][] = [
  ['Enter', 'enter'],
  ['Backspace', 'backspace'],
  ['Tab', 'tab'],
  ['Esc', 'escape'],
  ['←', 'left'],
  ['↑', 'up'],
  ['↓', 'down'],
  ['→', 'right'],
];

function Keys({ send, disabled }: PanelProps) {
  const [value, setValue] = useState('');
  const submit = () => {
    if (!value) return;
    send({ type: 'text', text: value });
    setValue('');
  };
  return (
    <ScrollView contentContainerStyle={styles.panel} keyboardShouldPersistTaps="handled">
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder="Type here, then Send to type it on the laptop"
        placeholderTextColor={colors.muted}
        style={styles.input}
        editable={!disabled}
        onSubmitEditing={submit}
        accessibilityLabel="Text to type on laptop"
        multiline
      />
      <Button label="Type on laptop" disabled={disabled || !value} onPress={submit} />
      <View style={styles.wrap}>
        {SPECIAL.map(([label, k]) => (
          <Button key={k} label={label} variant="ghost" disabled={disabled} onPress={() => send(key(k))} style={styles.special} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.md, gap: spacing.md },
  seg: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 10, padding: 4 },
  segItem: { flex: 1, textAlign: 'center', color: colors.muted, paddingVertical: 10, borderRadius: 8, overflow: 'hidden', fontWeight: '600' },
  segActive: { backgroundColor: colors.raised, color: colors.text },
  panel: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  special: { minWidth: 76, flexGrow: 1 },
  input: { minHeight: 90, color: colors.text, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: spacing.md, textAlignVertical: 'top' },
});

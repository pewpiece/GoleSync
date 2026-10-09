import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ConnectionBanner } from '../../src/components/ConnectionBanner';
import { Button, Card, ProgressBar } from '../../src/components/ui';
import { sendAsset, sendText, formatBytes } from '../../src/features/send/send';
import { describeError } from '../../src/services/api';
import { useConnection } from '../../src/store/connection';
import { colors, spacing } from '../../src/theme';

type Upload = { key: string; name: string; progress: number; error?: string; done?: boolean };

export default function SendScreen() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const maxBytes = useConnection((s) => s.status?.max_file_bytes ?? null);

  async function onSendText() {
    const api = useConnection.getState().api();
    if (!api || !text.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const { copied } = await sendText(api, text);
      setText('');
      setMsg(copied ? 'Sent. Copied to the laptop clipboard.' : 'Sent.');
    } catch (e) {
      setMsg(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onPickFiles() {
    const api = useConnection.getState().api();
    if (!api) return setMsg('Not paired yet.');
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return;
    for (const a of res.assets) {
      const key = `${a.uri}-${Date.now()}`;
      setUploads((u) => [...u, { key, name: a.name, progress: 0 }]);
      const patch = (p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)));
      try {
        await sendAsset(api, { uri: a.uri, name: a.name, size: a.size }, maxBytes, (sent, total) => patch({ progress: total ? sent / total : 0 }));
        patch({ progress: 1, done: true });
      } catch (e) {
        patch({ error: describeError(e) });
      }
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ConnectionBanner />
        <Card>
          <Text style={styles.h}>Send text or a link</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Type or paste here. It lands on the laptop clipboard."
            placeholderTextColor={colors.muted}
            multiline
            style={styles.input}
            accessibilityLabel="Text to send"
          />
          <View style={styles.row}>
            <Button label="Paste" variant="ghost" onPress={async () => setText(await Clipboard.getStringAsync())} />
            <Button label="Send to laptop" busy={busy} disabled={!text.trim()} onPress={onSendText} style={{ flex: 1 }} />
          </View>
          {msg ? <Text style={styles.msg}>{msg}</Text> : null}
        </Card>
        <Card>
          <Text style={styles.h}>Send files</Text>
          <Text style={styles.muted}>Saved to ~/GoleSync/Inbox on the laptop{maxBytes ? ` (max ${formatBytes(maxBytes)} each)` : ''}.</Text>
          <Button label="Choose files…" onPress={onPickFiles} />
          {uploads.map((u) => (
            <View key={u.key} style={{ gap: 4 }}>
              <Text style={styles.name}>
                {u.name} {u.done ? '✓' : ''}
              </Text>
              {u.error ? <Text style={[styles.msg, { color: colors.danger }]}>{u.error}</Text> : <ProgressBar value={u.progress} />}
            </View>
          ))}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.md, gap: spacing.md },
  h: { color: colors.text, fontSize: 16, fontWeight: '700' },
  input: { minHeight: 110, color: colors.text, backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: spacing.md, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: spacing.sm },
  msg: { color: colors.muted, fontSize: 13 },
  muted: { color: colors.muted, fontSize: 13 },
  name: { color: colors.text, fontSize: 14 },
});

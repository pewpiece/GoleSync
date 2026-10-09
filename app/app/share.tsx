import { useShareIntentContext } from 'expo-share-intent';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, ProgressBar } from '../src/components/ui';
import { formatBytes, sendAsset, sendText } from '../src/features/send/send';
import { describeError } from '../src/services/api';
import { useConnection } from '../src/store/connection';
import { colors, spacing } from '../src/theme';

type Row = { name: string; progress: number; done?: boolean; error?: string };

/** Target of the Android share sheet: sends shared text/links/files to the laptop. */
export default function ShareScreen() {
  const router = useRouter();
  const { shareIntent, resetShareIntent } = useShareIntentContext();
  const link = useConnection((s) => s.link);
  const maxBytes = useConnection((s) => s.status?.max_file_bytes ?? null);
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const text = shareIntent.webUrl ?? shareIntent.text ?? null;
  const files = shareIntent.files ?? [];

  async function send() {
    const api = useConnection.getState().api();
    if (!api) return setMsg('Not paired yet. Open Settings to pair with your laptop.');
    setBusy(true);
    setMsg(null);
    try {
      if (text) {
        const { copied } = await sendText(api, shareIntent.text && shareIntent.webUrl && shareIntent.text !== shareIntent.webUrl ? shareIntent.text : text);
        setMsg(copied ? 'Sent. Copied to the laptop clipboard.' : 'Sent.');
      }
      for (const [i, f] of files.entries()) {
        const patch = (p: Partial<Row>) =>
          setRows((r) => {
            const next = [...r];
            next[i] = { ...(next[i] ?? { name: f.fileName, progress: 0 }), ...p };
            return next;
          });
        try {
          await sendAsset(api, { uri: f.path, name: f.fileName, size: f.size }, maxBytes, (s, t) => patch({ progress: t ? s / t : 0 }));
          patch({ progress: 1, done: true });
        } catch (e) {
          patch({ error: describeError(e) });
        }
      }
    } catch (e) {
      setMsg(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // Send immediately when we can: sharing should be one tap.
    if (!started.current && link === 'connected' && (text || files.length)) {
      started.current = true;
      void send();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, text, files.length]);

  function done() {
    resetShareIntent();
    router.replace('/');
  }

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Card>
        <Text style={styles.h}>Sending to laptop</Text>
        {text ? <Text selectable numberOfLines={6} style={styles.text}>{text}</Text> : null}
        {files.map((f, i) => (
          <View key={f.path} style={{ gap: 4 }}>
            <Text style={styles.text}>{f.fileName} <Text style={styles.muted}>{formatBytes(f.size)}</Text></Text>
            {rows[i]?.error ? <Text style={[styles.muted, { color: colors.danger }]}>{rows[i]?.error}</Text> : <ProgressBar value={rows[i]?.progress ?? 0} />}
          </View>
        ))}
        {!text && files.length === 0 ? <Text style={styles.muted}>Nothing to send.</Text> : null}
        {link !== 'connected' ? <Text style={styles.muted}>Waiting for the laptop ({link})…</Text> : null}
        {msg ? <Text style={styles.muted}>{msg}</Text> : null}
      </Card>
      <View style={styles.row}>
        <Button label="Send again" variant="ghost" busy={busy} disabled={link !== 'connected'} onPress={send} style={{ flex: 1 }} />
        <Button label="Done" onPress={done} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.md, gap: spacing.md },
  h: { color: colors.text, fontSize: 16, fontWeight: '700' },
  text: { color: colors.text, fontSize: 14 },
  muted: { color: colors.muted, fontSize: 13 },
  row: { flexDirection: 'row', gap: spacing.md },
});

import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Card, ProgressBar, tap } from '../../components/ui';
import { describeError, type Item } from '../../services/api';
import { downloadFile } from '../../services/transfer';
import { useConnection } from '../../store/connection';
import { colors, spacing } from '../../theme';
import { formatBytes } from '../send/send';

export function timeLabel(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function ItemRow({ item }: { item: Item }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const incoming = item.direction === 'to_phone';

  async function copy() {
    await Clipboard.setStringAsync(item.text ?? '');
    tap('medium');
    setNote('Copied');
    setTimeout(() => setNote(null), 1500);
  }

  async function download() {
    const api = useConnection.getState().api();
    if (!api) return;
    setNote(null);
    setProgress(0);
    try {
      const uri = await downloadFile(api, item, (done, total) => setProgress(total > 0 ? done / total : 0));
      setProgress(null);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { dialogTitle: item.filename ?? 'File' });
      else setNote(`Saved to app storage: ${uri}`);
    } catch (e) {
      setProgress(null);
      setNote(describeError(e));
    }
  }

  return (
    <Card>
      <View style={styles.head}>
        <Text style={styles.meta}>{incoming ? 'From laptop' : 'Sent to laptop'}</Text>
        <Text style={styles.meta}>{timeLabel(item.created_at)}</Text>
      </View>
      {item.kind === 'text' ? (
        <Text selectable style={styles.text}>
          {item.text}
        </Text>
      ) : (
        <Text style={styles.text}>
          {item.filename} <Text style={styles.meta}>{formatBytes(item.size)}</Text>
        </Text>
      )}
      {progress !== null ? <ProgressBar value={progress} /> : null}
      <View style={styles.actions}>
        {item.kind === 'text' ? <Button label="Copy" variant="ghost" onPress={copy} /> : null}
        {item.kind === 'file' && incoming ? (
          <Button label={progress === null ? 'Download / share' : 'Downloading…'} busy={progress !== null} onPress={download} />
        ) : null}
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between' },
  meta: { color: colors.muted, fontSize: 12 },
  text: { color: colors.text, fontSize: 15 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  note: { color: colors.muted, fontSize: 13, flexShrink: 1 },
});

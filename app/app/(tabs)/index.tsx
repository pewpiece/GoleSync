import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ConnectionBanner } from '../../src/components/ConnectionBanner';
import { Button, Empty } from '../../src/components/ui';
import { ItemRow } from '../../src/features/inbox/ItemRow';
import { useConnection } from '../../src/store/connection';
import { colors, spacing } from '../../src/theme';

export default function InboxScreen() {
  const router = useRouter();
  const { link, inbox, sent, refresh } = useConnection();
  const [tab, setTab] = useState<'inbox' | 'sent'>('inbox');
  const [refreshing, setRefreshing] = useState(false);
  const items = [...(tab === 'inbox' ? inbox : sent)].reverse();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  return (
    <View style={styles.root}>
      <ConnectionBanner />
      <View style={styles.seg}>
        {(['inbox', 'sent'] as const).map((t) => (
          <Text key={t} accessibilityRole="button" onPress={() => setTab(t)} style={[styles.segItem, tab === t && styles.segActive]}>
            {t === 'inbox' ? 'From laptop' : 'Sent'}
          </Text>
        ))}
      </View>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <ItemRow item={item} />}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListEmptyComponent={
          link === 'unpaired' ? (
            <Empty title="Pair with your laptop" hint="Run `golesync pair` on the laptop and scan the QR code.">
              <Button label="Scan QR code" onPress={() => router.push('/pair')} />
            </Empty>
          ) : tab === 'inbox' ? (
            <Empty title="Inbox is empty" hint={'Send something from the laptop:\ngolesync send "hello"\ngolesync send-file photo.jpg'} />
          ) : (
            <Empty title="Nothing sent yet" hint="Texts and files you send to the laptop show up here." />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { padding: spacing.md, flexGrow: 1 },
  seg: { flexDirection: 'row', marginHorizontal: spacing.md, backgroundColor: colors.card, borderRadius: 10, padding: 4 },
  segItem: { flex: 1, textAlign: 'center', color: colors.muted, paddingVertical: 8, borderRadius: 8, overflow: 'hidden', fontWeight: '600' },
  segActive: { backgroundColor: colors.raised, color: colors.text },
});

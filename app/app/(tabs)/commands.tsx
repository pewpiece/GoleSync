import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';

import { ConnectionBanner } from '../../src/components/ConnectionBanner';
import { Button, Card, Empty } from '../../src/components/ui';
import { ApiError, describeError, type CommandInfo, type CommandResult } from '../../src/services/api';
import { useConnection } from '../../src/store/connection';
import { colors, spacing } from '../../src/theme';

export default function CommandsScreen() {
  const link = useConnection((s) => s.link);
  const paused = useConnection((s) => s.paused);
  const [commands, setCommands] = useState<CommandInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, CommandResult>>({});

  const load = useCallback(async () => {
    const api = useConnection.getState().api();
    if (!api) return;
    try {
      setCommands(await api.commands());
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, []);

  useEffect(() => {
    if (link === 'connected') void load();
  }, [link, load]);

  async function run(cmd: CommandInfo, confirmed: boolean) {
    const api = useConnection.getState().api();
    if (!api) return;
    setRunning(cmd.id);
    try {
      const res = await api.runCommand(cmd.id, confirmed);
      setResults((r) => ({ ...r, [cmd.id]: res }));
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'confirmation_required') return ask(cmd);
      setResults((r) => ({
        ...r,
        [cmd.id]: { id: cmd.id, exit_code: null, timed_out: false, detached: false, pid: null, output: describeError(e) },
      }));
    } finally {
      setRunning(null);
    }
  }

  function ask(cmd: CommandInfo) {
    Alert.alert(`Run "${cmd.label}"?`, 'This runs on your laptop.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Run', style: 'destructive', onPress: () => void run(cmd, true) },
    ]);
  }

  return (
    <View style={{ flex: 1 }}>
      <ConnectionBanner />
      <FlatList
        data={commands ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListEmptyComponent={
          error ? (
            <Empty title="Couldn’t load commands" hint={error}>
              <Button label="Retry" onPress={load} />
            </Empty>
          ) : commands ? (
            <Empty title="No commands yet" hint="Add some to ~/.config/golesync/commands.yaml on the laptop (see commands.example.yaml)." />
          ) : link === 'connected' ? (
            <Empty title="Loading…" />
          ) : (
            <Empty title="Connect to your laptop to see its commands" />
          )
        }
        renderItem={({ item }) => {
          const r = results[item.id];
          return (
            <Card>
              <Button
                label={item.label + (item.confirm ? '  (asks first)' : '')}
                busy={running === item.id}
                disabled={paused || link !== 'connected' || running !== null}
                onPress={() => (item.confirm ? ask(item) : void run(item, false))}
              />
              {r ? (
                <View style={{ gap: 4 }}>
                  <Text style={[styles.status, { color: r.exit_code === 0 || r.detached ? colors.ok : colors.danger }]}>
                    {r.detached ? `Started (pid ${r.pid})` : r.timed_out ? 'Timed out' : r.exit_code === null ? 'Failed' : `Exit code ${r.exit_code}`}
                  </Text>
                  {r.output ? (
                    <Text selectable style={styles.out}>
                      {r.output}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </Card>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.md, flexGrow: 1 },
  status: { fontWeight: '700', fontSize: 13 },
  out: { color: colors.text, fontFamily: 'monospace', fontSize: 12, backgroundColor: colors.bg, padding: spacing.sm, borderRadius: 8 },
});

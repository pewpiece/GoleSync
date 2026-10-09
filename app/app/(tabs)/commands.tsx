import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ConnectionBanner } from '../../src/components/ConnectionBanner';
import { Button, Card, Empty, tap } from '../../src/components/ui';
import { groupBySection } from '../../src/features/commands/grouping';
import { ApiError, describeError, type CommandInfo, type CommandResult } from '../../src/services/api';
import { useConnection } from '../../src/store/connection';
import { colors, radius, spacing } from '../../src/theme';

type Last = { label: string; result: CommandResult };

function CommandBox({ cmd, busy, disabled, onPress }: { cmd: CommandInfo; busy: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={cmd.label + (cmd.confirm ? '  (asks first)' : '')}
      disabled={disabled}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [styles.box, { opacity: disabled && !busy ? 0.4 : pressed ? 0.7 : 1 }, busy && styles.boxBusy]}
    >
      {busy ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.boxLabel} numberOfLines={3}>{cmd.label}</Text>}
      {cmd.confirm && !busy ? <Text style={styles.boxHint}>asks first</Text> : null}
    </Pressable>
  );
}

async function fetchCommands() {
  const api = useConnection.getState().api();
  if (!api) return null;
  try {
    return { commands: await api.commands() };
  } catch (e) {
    return { error: describeError(e) };
  }
}

export default function CommandsScreen() {
  const link = useConnection((s) => s.link);
  const paused = useConnection((s) => s.paused);
  const [commands, setCommands] = useState<CommandInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [last, setLast] = useState<Last | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const apply = useCallback((r: { commands: CommandInfo[] } | { error: string } | null) => {
    if (!r) return;
    if ('commands' in r) {
      setCommands(r.commands);
      setError(null);
    } else {
      setError(r.error);
    }
  }, []);

  const load = useCallback(async () => apply(await fetchCommands()), [apply]);

  useEffect(() => {
    if (link !== 'connected') return;
    let cancelled = false;
    void fetchCommands().then((r) => {
      if (!cancelled) apply(r);
    });
    return () => {
      cancelled = true;
    };
  }, [link, apply]);

  async function run(cmd: CommandInfo, confirmed: boolean) {
    const api = useConnection.getState().api();
    if (!api) return;
    setRunning(cmd.id);
    try {
      const result = await api.runCommand(cmd.id, confirmed);
      setLast({ label: cmd.label, result });
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'confirmation_required') return ask(cmd);
      setLast({
        label: cmd.label,
        result: { id: cmd.id, exit_code: null, timed_out: false, detached: false, pid: null, output: describeError(e) },
      });
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

  const sections = useMemo(() => groupBySection(commands ?? []), [commands]);
  const locked = paused || link !== 'connected' || running !== null;

  return (
    <View style={{ flex: 1 }}>
      <ConnectionBanner />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accent}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {last ? <ResultCard last={last} onDismiss={() => setLast(null)} /> : null}
        {sections.map((section) => (
          <View key={section.title} style={styles.section} accessibilityLabel={`Section ${section.title}`}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.grid}>
              {section.items.map((cmd) => (
                <CommandBox
                  key={cmd.id}
                  cmd={cmd}
                  busy={running === cmd.id}
                  disabled={locked}
                  onPress={() => (cmd.confirm ? ask(cmd) : void run(cmd, false))}
                />
              ))}
            </View>
          </View>
        ))}
        {sections.length === 0 ? (
          error ? (
            <Empty title="Couldn't load commands" hint={error}>
              <Button label="Retry" onPress={load} />
            </Empty>
          ) : commands ? (
            <Empty title="No commands yet" hint="Add some to ~/.config/golesync/commands.yaml on the laptop (see commands.example.yaml)." />
          ) : link === 'connected' ? (
            <Empty title="Loading…" />
          ) : (
            <Empty title="Connect to your laptop to see its commands" />
          )
        ) : null}
      </ScrollView>
    </View>
  );
}

function ResultCard({ last, onDismiss }: { last: Last; onDismiss: () => void }) {
  const r = last.result;
  const ok = r.exit_code === 0 || r.detached;
  const status = r.detached && r.exit_code == null ? `Started (pid ${r.pid})` : r.timed_out ? 'Timed out' : r.exit_code === null ? 'Failed' : r.detached ? 'Started' : `Exit code ${r.exit_code}`;
  return (
    <Card>
      <View style={styles.resultHead}>
        <Text style={styles.resultTitle}>{last.label}</Text>
        <Text accessibilityRole="button" onPress={onDismiss} style={styles.dismiss}>
          Dismiss
        </Text>
      </View>
      <Text style={[styles.status, { color: ok ? colors.ok : colors.danger }]}>{status}</Text>
      {r.output ? (
        <Text selectable style={styles.out}>
          {r.output}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.md, gap: spacing.lg, flexGrow: 1 },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.sm, rowGap: spacing.sm },
  box: {
    width: '31.5%',
    minHeight: 84,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  boxBusy: { borderColor: colors.accent },
  boxLabel: { color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  boxHint: { color: colors.warn, fontSize: 10 },
  resultHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultTitle: { color: colors.text, fontWeight: '700', fontSize: 15, flexShrink: 1 },
  dismiss: { color: colors.accent, fontSize: 13, padding: 4 },
  status: { fontWeight: '700', fontSize: 13 },
  out: { color: colors.text, fontFamily: 'monospace', fontSize: 12, backgroundColor: colors.bg, padding: spacing.sm, borderRadius: 8 },
});

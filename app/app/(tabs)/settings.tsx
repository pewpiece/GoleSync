import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ConnectionBanner } from '../../src/components/ConnectionBanner';
import { Button, Card } from '../../src/components/ui';
import { describeError } from '../../src/services/api';
import { normalizeBaseUrl } from '../../src/services/pairing';
import { useConnection } from '../../src/store/connection';
import { colors, spacing } from '../../src/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const { baseUrl, token, link, status, pair, unpair } = useConnection();
  const [url, setUrl] = useState(baseUrl ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveUrl() {
    const norm = normalizeBaseUrl(url);
    if (!norm) return setMsg('Enter an address like 192.168.1.20:8765 or http://laptop.tailnet.ts.net:8765');
    if (!token) return setMsg('Pair first.');
    setBusy(true);
    try {
      await pair(norm, token); // verifies the new address with the same token
      setUrl(norm);
      setMsg('Address saved and verified.');
    } catch (e) {
      setMsg(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <ConnectionBanner />
      <Card>
        <Text style={styles.h}>Laptop</Text>
        <Text style={styles.line}>
          Status: {link}
          {status ? `  •  ${status.name}  •  agent ${status.version}` : ''}
        </Text>
        <Text style={styles.label}>Address (change this for Tailscale or another VPN)</Text>
        <TextInput
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="192.168.1.20:8765"
          placeholderTextColor={colors.muted}
          style={styles.input}
          accessibilityLabel="Laptop address"
        />
        <View style={styles.row}>
          <Button label="Save & test" busy={busy} disabled={!token} onPress={saveUrl} style={{ flex: 1 }} />
          <Button label={token ? 'Re-pair' : 'Pair'} variant="ghost" onPress={() => router.push('/pair')} />
        </View>
        {msg ? <Text style={styles.note}>{msg}</Text> : null}
      </Card>
      <Card>
        <Text style={styles.h}>Security</Text>
        <Text style={styles.line}>Token: {token ? 'stored securely on this phone' : 'none'}</Text>
        <Text style={styles.note}>
          Traffic is plain HTTP on your local network (no TLS). Only use this on networks you trust, or over a VPN such as Tailscale.
        </Text>
        <Button
          label="Forget this laptop"
          variant="danger"
          disabled={!token}
          onPress={() =>
            Alert.alert('Forget this laptop?', 'You will need to scan the QR code again.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Forget', style: 'destructive', onPress: () => void unpair() },
            ])
          }
        />
      </Card>
      <Text style={styles.footer}>GoleSync {Constants.expoConfig?.version ?? ''}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.md, gap: spacing.md },
  h: { color: colors.text, fontSize: 16, fontWeight: '700' },
  line: { color: colors.text, fontSize: 14 },
  label: { color: colors.muted, fontSize: 12 },
  note: { color: colors.muted, fontSize: 13 },
  input: { color: colors.text, backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  footer: { color: colors.muted, textAlign: 'center', fontSize: 12 },
});

import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, Card } from '../src/components/ui';
import { describeError } from '../src/services/api';
import { baseUrlFor, normalizeBaseUrl, parsePairing, validatePairing, type Pairing } from '../src/services/pairing';
import { useConnection } from '../src/store/connection';
import { colors, spacing } from '../src/theme';

export default function PairScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ host?: string; port?: string; token?: string }>();
  const pair = useConnection((s) => s.pair);
  const [perm, requestPerm] = useCameraPermissions();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualUrl, setManualUrl] = useState('');
  const [manualToken, setManualToken] = useState('');
  const handled = useRef(false);

  const finish = useCallback(
    async (baseUrl: string, token: string) => {
      setBusy(true);
      setMsg('Checking with the laptop…');
      try {
        await pair(baseUrl, token);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        router.replace('/');
      } catch (e) {
        handled.current = false;
        setMsg(describeError(e));
      } finally {
        setBusy(false);
      }
    },
    [pair, router],
  );

  const applyPairing = useCallback(
    (p: Pairing) => finish(baseUrlFor(p.host, p.port), p.token),
    [finish],
  );

  // Opened via a golesync://pair?... link (e.g. scanned with the system camera).
  useEffect(() => {
    const p = validatePairing(params);
    if (p && !handled.current) {
      handled.current = true;
      void applyPairing(p);
    }
  }, [params, applyPairing]);

  function onScanned(data: string) {
    if (handled.current) return;
    const p = parsePairing(data);
    if (!p) {
      setMsg('That QR code is not a GoleSync pairing code.');
      return;
    }
    handled.current = true;
    void applyPairing(p);
  }

  function onManual() {
    const base = normalizeBaseUrl(manualUrl);
    if (!base) return setMsg('Enter the laptop address, e.g. 192.168.1.20:8765');
    if (manualToken.trim().length < 16) return setMsg('Paste the token from ~/.config/golesync/token');
    void finish(base, manualToken.trim());
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Text style={styles.help}>On the laptop run `golesync pair` (or open http://127.0.0.1:8765/local/) and scan the QR code.</Text>
      {perm?.granted ? (
        <View style={styles.camWrap}>
          <CameraView
            style={styles.cam}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={busy ? undefined : (e) => onScanned(e.data)}
          />
        </View>
      ) : (
        <Card>
          <Text style={styles.help}>{perm && !perm.canAskAgain ? 'Camera permission is blocked. Enable it in Android settings, or pair manually below.' : 'The camera is used only to scan the pairing QR code.'}</Text>
          {perm?.canAskAgain !== false ? <Button label="Allow camera" onPress={requestPerm} /> : null}
        </Card>
      )}
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      <Card>
        <Text style={styles.h}>Pair manually</Text>
        <TextInput value={manualUrl} onChangeText={setManualUrl} placeholder="Laptop address (192.168.1.20:8765)" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.input} accessibilityLabel="Laptop address" />
        <TextInput value={manualToken} onChangeText={setManualToken} placeholder="Token" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} secureTextEntry style={styles.input} accessibilityLabel="Token" />
        <Button label="Pair" busy={busy} onPress={onManual} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.md, gap: spacing.md },
  help: { color: colors.muted, fontSize: 14 },
  h: { color: colors.text, fontSize: 16, fontWeight: '700' },
  msg: { color: colors.warn, fontSize: 14 },
  camWrap: { borderRadius: 16, overflow: 'hidden', borderColor: colors.accent, borderWidth: 2 },
  cam: { width: '100%', aspectRatio: 1 },
  input: { color: colors.text, backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: spacing.md },
});

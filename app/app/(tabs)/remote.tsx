import { useFocusEffect } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConnectionBanner } from '../../src/components/ConnectionBanner';
import { Remote } from '../../src/features/remote/Remote';
import { useConnection } from '../../src/store/connection';
import { colors, spacing } from '../../src/theme';

export default function RemoteScreen() {
  const link = useConnection((s) => s.link);
  const paused = useConnection((s) => s.paused);
  const sendEvent = useConnection((s) => s.sendEvent);
  const input_ok = useConnection((s) => s.status?.input_ok);

  // Keep the screen awake only while this tab is focused.
  useFocusEffect(
    useCallback(() => {
      activateKeepAwakeAsync('remote').catch(() => {});
      return () => {
        deactivateKeepAwake('remote').catch(() => {});
      };
    }, []),
  );

  const disabled = link !== 'connected' || paused || input_ok === false;
  return (
    <View style={{ flex: 1 }}>
      <ConnectionBanner />
      {input_ok === false ? <InputWarning /> : null}
      <Remote send={sendEvent} disabled={disabled} />
    </View>
  );
}

function InputWarning() {
  return (
    <Text style={styles.warn}>
      The laptop cannot inject input (Wayland session, or no DISPLAY). Switch the laptop to an X11 session and restart the agent.
    </Text>
  );
}
const styles = StyleSheet.create({
  warn: { color: colors.warn, marginHorizontal: spacing.md, fontSize: 13 },
});

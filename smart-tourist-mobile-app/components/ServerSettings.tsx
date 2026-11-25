import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getApiBase, setServerUrl, testServerUrl } from '../constants/config';

/**
 * Change the server address after activation (the laptop running smart-tourist-server gets a new
 * IP on every Wi-Fi network). Saves only an address that answers.
 */
export default function ServerSettings({ onSaved }: { onSaved?: () => void }) {
  const [value, setValue] = useState(getApiBase());
  const [state, setState] = useState<{ kind: 'idle' | 'testing' | 'saved' } | { kind: 'error'; message: string }>({ kind: 'idle' });

  const save = async () => {
    setState({ kind: 'testing' });
    const error = await testServerUrl(value);
    if (error) {
      setState({ kind: 'error', message: error });
      return;
    }
    setValue(await setServerUrl(value));
    setState({ kind: 'saved' });
    onSaved?.();
  };

  return (
    <View>
      <Text style={styles.title}>Server</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={(v) => {
            setValue(v);
            setState({ kind: 'idle' });
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="192.168.1.20:4000"
        />
        <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={save} disabled={state.kind === 'testing'}>
          {state.kind === 'testing' ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
        </Pressable>
      </View>
      {state.kind === 'saved' && (
        <Text style={[styles.hint, styles.ok]}>
          <Ionicons name="checkmark-circle" size={13} /> Connected and saved
        </Text>
      )}
      {state.kind === 'error' && <Text style={[styles.hint, styles.error]}>{state.message}</Text>}
      {state.kind === 'idle' && <Text style={styles.hint}>Address of the computer running the Smart Tourist server, on the same Wi-Fi.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 12 },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
    color: '#333',
  },
  button: { backgroundColor: '#007AFF', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center', minWidth: 72, alignItems: 'center' },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  hint: { fontSize: 12, color: '#666', marginTop: 6 },
  ok: { color: '#0a7a0a' },
  error: { color: '#b42318' },
});

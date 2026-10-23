import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, DEFAULT_API_URL, errorMessage, getApiUrl, setApiUrl } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button, colors, ErrorBox, Field, Notice } from './ui';

/**
 * "Server address" on the sign-in screen. While FarePay's server runs on a laptop behind a free tunnel,
 * its address changes when the tunnel restarts: paste the new one here instead of reinstalling the app.
 * Passengers don't see it in a real build (an https:// server): only in test builds (http://, a laptop on the
 * Wi-Fi), or once the address was changed (so it can be changed back).
 */
const shown = () => DEFAULT_API_URL.startsWith('http://') || getApiUrl() !== DEFAULT_API_URL;

export function ServerSetting() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(getApiUrl());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const previous = getApiUrl();
    try {
      await setApiUrl(url);
      await api('/health');
      setUrl(getApiUrl());
      setMessage({ ok: true, text: t('Connected to the FarePay server.') });
    } catch (err) {
      await setApiUrl(previous === DEFAULT_API_URL ? '' : previous);
      setMessage({ ok: false, text: t('Not saved: {reason}', { reason: errorMessage(err) }) });
    } finally {
      setBusy(false);
    }
  };

  if (!open && !shown()) return null;
  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={{ padding: 8, marginTop: 8 }}>
        <Text style={{ textAlign: 'center', color: colors.muted, fontSize: 13 }}>{t('Server address')}</Text>
      </Pressable>
    );
  }

  return (
    <View style={{ marginTop: 16 }}>
      <Field
        label={t('Server address')}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        hint={t('Only change this if the FarePay team gives you a new address.')}
      />
      {message && (message.ok ? <Notice tone="success">{message.text}</Notice> : <ErrorBox message={message.text} />)}
      <Button title={t('Save and test')} variant="secondary" onPress={save} loading={busy} disabled={!url.trim()} />
    </View>
  );
}

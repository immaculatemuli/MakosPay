import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button, Card, colors, ErrorBox, Field, Muted } from './ui';

/** "How was your trip?": 1–5 stars and an optional comment, seen only by the SACCO office. Rating again changes it. */
export function RateTrip({ tripId, rated }: { tripId: number; rated: number | null }) {
  const { t } = useT();
  const [stars, setStars] = useState(rated ?? 0);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(rated !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (n: number) => {
    setStars(n);
    setSent(false);
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/passenger/trips/${tripId}/rating`, { method: 'POST', body: { stars, ...(comment.trim() && { comment: comment.trim() }) } });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'center' }}>{t('How was your trip?')}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginVertical: 10 }} accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => choose(n)} hitSlop={6} accessibilityRole="radio" accessibilityState={{ selected: stars === n }} accessibilityLabel={t('{n} stars', { n })}>
            <Ionicons name={n <= stars ? 'star' : 'star-outline'} size={34} color={n <= stars ? colors.primary : colors.muted} />
          </Pressable>
        ))}
      </View>
      {sent ? (
        <Muted center>{t('Thank you. Only the SACCO office sees your rating.')}</Muted>
      ) : (
        stars > 0 && (
          <>
            <Field label={t('Anything to tell the SACCO? (optional)')} value={comment} onChangeText={setComment} maxLength={300} multiline />
            {error && <ErrorBox message={error} />}
            <Button title={t('Send rating')} onPress={send} loading={busy} />
          </>
        )
      )}
    </Card>
  );
}

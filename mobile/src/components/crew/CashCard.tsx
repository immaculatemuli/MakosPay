import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, colors, ErrorBox, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { kes, time } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { CashDeclared } from '@/lib/types';

/**
 * The cash collected on the car that day, entered once (by the conductor, or the driver when parked) and corrected
 * if needed. Shown beside the FarePay money, so the owner sees everything the car made. Today or yesterday only.
 */
export function CashCard({ day, isToday, cash, farepayTotal, onSaved }: { day: string; isToday: boolean; cash: CashDeclared | null; farepayTotal: number; onSaved: () => void }) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setAmount(cash ? String(cash.amount) : '');
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/crew/cash', { method: 'PUT', body: { day, amount: Number(amount) } });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <View style={styles.card}>
        <Field
          label={isToday ? t('Cash collected today (KES)') : t('Cash collected that day (KES)')}
          hint={t('All the cash fares together, not FarePay payments.')}
          keyboardType="number-pad"
          maxLength={6}
          autoFocus
          value={amount}
          onChangeText={(typed) => setAmount(typed.replace(/\D/g, ''))}
          style={{ fontSize: 24, fontWeight: '700' }}
        />
        {error && <ErrorBox message={error} />}
        <Button title={t('Save')} icon="checkmark" onPress={save} loading={busy} disabled={amount === ''} />
        <Button title={t('Cancel')} variant="secondary" onPress={() => setEditing(false)} disabled={busy} />
      </View>
    );
  }

  return (
    <Pressable style={({ pressed }) => [styles.card, !cash && styles.missing, pressed && { opacity: 0.7 }]} onPress={open}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Ionicons name="cash-outline" size={24} color={cash ? colors.primary : colors.warning} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.label}>{isToday ? t('Cash collected today') : t('Cash collected that day')}</Text>
          {cash ? (
            <>
              <Text style={styles.amount}>{kes(cash.amount)}</Text>
              <Text style={styles.sub}>
                {t('Entered by {name} at {time} · tap to change', { name: cash.declared_by_name, time: time(cash.updated_at) })}
              </Text>
            </>
          ) : (
            <Text style={styles.prompt}>{t('Not entered yet · tap to enter')}</Text>
          )}
        </View>
      </View>
      {cash && (
        <Text style={styles.total}>
          {t('FarePay {farepay} + cash {cash} = {total}', { farepay: kes(farepayTotal), cash: kes(cash.amount), total: kes(farepayTotal + cash.amount) })}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  missing: { borderWidth: 2, borderColor: colors.warning, borderStyle: 'dashed' },
  label: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  amount: { fontSize: 24, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  prompt: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 2 },
  total: { fontSize: 14, fontWeight: '600', color: colors.primaryDark, marginTop: 10 },
});

import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import { Button, Chips, ErrorBox, Field, Loading, Muted, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { displayPhone } from '@/lib/format';
import type { OwnerDetail } from '@/lib/owners';
import { useApi } from '@/lib/useApi';

/** Add an owner (?id= changes one: the change reaches all their cars, and a new phone takes their unpaid fares with it). */
export default function OwnerForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const navigation = useNavigation();
  useLayoutEffect(() => navigation.setOptions({ title: id ? 'Change owner' : 'New owner' }), [navigation, id]);
  const existing = useApi<OwnerDetail>(id ? `/admin/owners/${id}` : null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [method, setMethod] = useState<'mpesa' | 'bank'>('mpesa');
  const [bankName, setBankName] = useState('');
  const [paybill, setPaybill] = useState('');
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const o = existing.data?.owner;
  // Fill the form once the owner has loaded.
  useEffect(() => {
    if (!o) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(o.name);
    setPhone(displayPhone(o.phone));
    setIdNumber(o.id_number ?? '');
    setMethod(o.payout_method);
    setBankName(o.bank_name ?? '');
    setPaybill(o.bank_paybill ?? '');
    setAccount(o.bank_account ?? '');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [o]);
  if (id && existing.loading && !o) return <Loading />;

  const bank = method === 'bank';
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        phone: phone.trim(),
        id_number: idNumber.trim() || null,
        payout_method: method,
        bank_name: bank ? bankName.trim() : null,
        bank_paybill: bank ? paybill.trim() : null,
        bank_account: bank ? account.trim() : null,
      };
      const saved = await api<{ id: number }>(id ? `/admin/owners/${id}` : '/admin/owners', { method: id ? 'PATCH' : 'POST', body });
      if (id) router.back();
      else router.replace(`/admin/owner/${saved.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const incomplete = name.trim().length < 2 || phone.trim().length < 9 || (bank && (!bankName.trim() || !/^\d{5,7}$/.test(paybill.trim()) || account.trim().length < 4));
  return (
    <Screen>
      {!!o && o.vehicle_count > 1 && <Muted>{`These details are used for all ${o.vehicle_count} of their cars.`}</Muted>}
      <Field label="Full name" value={name} onChangeText={setName} />
      <Field label="M-Pesa phone number" placeholder="07XX XXX XXX" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      <Field label="ID number (optional)" value={idNumber} onChangeText={setIdNumber} />
      <Chips
        label="Pay their fares to"
        options={[
          { value: 'mpesa' as const, label: 'M-Pesa' },
          { value: 'bank' as const, label: 'Bank account' },
        ]}
        value={method}
        onChange={setMethod}
      />
      {bank && (
        <>
          <Field label="Bank name" placeholder="e.g. KCB" value={bankName} onChangeText={setBankName} />
          <Field label="Bank’s M-Pesa paybill" keyboardType="number-pad" value={paybill} onChangeText={setPaybill} hint="5 to 7 digits" />
          <Field label="Account number" value={account} onChangeText={setAccount} />
        </>
      )}
      {error && <ErrorBox message={error} />}
      <Button title="Save" onPress={save} loading={busy} disabled={Boolean(incomplete)} />
    </Screen>
  );
}

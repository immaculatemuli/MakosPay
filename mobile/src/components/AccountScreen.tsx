import { ReactNode, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { displayPhone } from '@/lib/format';
import { PRIVACY_POLICY_URL } from '@/lib/links';
import { ROLE_LABEL } from '@/lib/types';
import { Button, Card, ErrorBox, Field, KeyValue, Muted, Notice, Screen, SectionTitle } from './ui';

/** Profile, password change, privacy policy, sign out, and (passengers) deleting the account; shared by all roles. */
export function AccountScreen({ children }: { children?: ReactNode }) {
  const { user, signOut, changePassword: savePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!user) return null;

  const changePassword = async () => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await savePassword(current, next);
      setCurrent('');
      setNext('');
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmSignOut = () =>
    Alert.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);

  const deleteAccount = () =>
    Alert.alert('Delete your account?', 'Your name and phone number are removed and you are signed out. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          setDeleteError(null);
          try {
            await api('/auth/delete-account', { method: 'POST', body: { password: deletePassword } });
            await signOut();
          } catch (err) {
            setDeleteError(errorMessage(err));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);

  return (
    <Screen>
      {children}
      <SectionTitle>My account</SectionTitle>
      <Card>
        <KeyValue label="Name" value={user.name} />
        <KeyValue label="Phone" value={displayPhone(user.phone)} />
        <KeyValue label="Account type" value={ROLE_LABEL[user.role]} />
      </Card>

      <SectionTitle>Change password</SectionTitle>
      {error && <ErrorBox message={error} />}
      {done && <Notice tone="success">Password changed. Any other phone signed in to this account has been signed out.</Notice>}
      <Field label="Current password" secureTextEntry value={current} onChangeText={setCurrent} />
      <Field label="New password" hint="At least 6 characters" secureTextEntry value={next} onChangeText={setNext} />
      <Button title="Change password" variant="secondary" onPress={changePassword} loading={busy} disabled={!current || next.length < 6} />

      <SectionTitle>Session</SectionTitle>
      <Button title="Privacy policy" variant="secondary" icon="document-text-outline" onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)} />
      <Button title="Sign out" variant="danger" icon="log-out-outline" onPress={confirmSignOut} />

      {user.role === 'passenger' && (
        <>
          <SectionTitle>Delete my account</SectionTitle>
          <Muted>Use any money left in your wallet, or withdraw it to M-Pesa from your Wallet, first. Your past payments are kept for the SACCO’s records, without your name or number.</Muted>
          <Field label="Your password" secureTextEntry value={deletePassword} onChangeText={setDeletePassword} />
          {deleteError && <ErrorBox message={deleteError} />}
          <Button title="Delete my account" variant="danger" icon="trash-outline" onPress={deleteAccount} loading={deleting} disabled={!deletePassword} />
        </>
      )}
    </Screen>
  );
}

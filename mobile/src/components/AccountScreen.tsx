import { ReactNode, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { displayPhone } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { PRIVACY_POLICY_URL } from '@/lib/links';
import { passwordHint, passwordOk } from '@/lib/password';
import { ROLE_LABEL } from '@/lib/types';
import { LanguageSwitch } from './LanguageSwitch';
import { Button, Card, ErrorBox, Field, KeyValue, Muted, Notice, Screen, SectionTitle } from './ui';

/** Profile, password change, privacy policy, sign out, and (passengers) fixing their name and deleting the account; shared by all roles. */
export function AccountScreen({ children }: { children?: ReactNode }) {
  const { user, signOut, changePassword: savePassword, rename } = useAuth();
  const { t } = useT();
  const [newName, setNewName] = useState(user?.name ?? '');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renamed, setRenamed] = useState(false);
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

  const saveName = async () => {
    setRenaming(true);
    setRenameError(null);
    setRenamed(false);
    try {
      await rename(newName.trim());
      setRenamed(true);
    } catch (err) {
      setRenameError(errorMessage(err));
    } finally {
      setRenaming(false);
    }
  };

  const confirmSignOut = () =>
    Alert.alert(t('Sign out?'), undefined, [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Sign out'), style: 'destructive', onPress: () => void signOut() },
    ]);

  const deleteAccount = () =>
    Alert.alert(t('Delete your account?'), t('Your name and phone number are removed and you are signed out. This cannot be undone.'), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Delete'),
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
      <SectionTitle>{t('My account')}</SectionTitle>
      <Card>
        <KeyValue label={t('Name')} value={user.name} />
        <KeyValue label={t('Phone')} value={displayPhone(user.phone)} />
        <KeyValue label={t('Account type')} value={t(ROLE_LABEL[user.role])} />
      </Card>

      <SectionTitle>{t('Language')}</SectionTitle>
      <LanguageSwitch />

      {user.role === 'passenger' && (
        <>
          <SectionTitle>{t('Change name')}</SectionTitle>
          {renameError && <ErrorBox message={renameError} />}
          {renamed && <Notice tone="success">{t('Name saved.')}</Notice>}
          <Field label={t('Full name')} value={newName} onChangeText={setNewName} autoComplete="name" />
          <Button
            title={t('Save name')}
            variant="secondary"
            onPress={saveName}
            loading={renaming}
            disabled={newName.trim().length < 2 || newName.trim() === user.name}
          />
        </>
      )}

      <SectionTitle>{t('Change password')}</SectionTitle>
      {error && <ErrorBox message={error} />}
      {done && <Notice tone="success">{t('Password changed. Any other phone signed in to this account has been signed out.')}</Notice>}
      <Field label={t('Current password')} secureTextEntry value={current} onChangeText={setCurrent} />
      <Field label={t('New password')} hint={passwordHint(next)} secureTextEntry value={next} onChangeText={setNext} />
      <Button title={t('Change password')} variant="secondary" onPress={changePassword} loading={busy} disabled={!current || !passwordOk(next)} />

      <SectionTitle>{t('Session')}</SectionTitle>
      <Button title={t('Privacy policy')} variant="secondary" icon="document-text-outline" onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)} />
      <Button title={t('Sign out')} variant="danger" icon="log-out-outline" onPress={confirmSignOut} />

      {user.role === 'passenger' && (
        <>
          <SectionTitle>{t('Delete my account')}</SectionTitle>
          <Muted>{t('Use any money left in your wallet, or withdraw it to M-Pesa from your Wallet, first. Your past payments are kept for the SACCO’s records, without your name or number.')}</Muted>
          <Field label={t('Your password')} secureTextEntry value={deletePassword} onChangeText={setDeletePassword} />
          {deleteError && <ErrorBox message={deleteError} />}
          <Button title={t('Delete my account')} variant="danger" icon="trash-outline" onPress={deleteAccount} loading={deleting} disabled={!deletePassword} />
        </>
      )}
    </Screen>
  );
}

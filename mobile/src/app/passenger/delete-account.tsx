import { DeleteAccountForm } from '@/components/AccountScreen';
import { Screen } from '@/components/ui';

/** Opened from "Delete account" at the bottom of Profile. */
export default function DeleteAccount() {
  return (
    <Screen>
      <DeleteAccountForm />
    </Screen>
  );
}

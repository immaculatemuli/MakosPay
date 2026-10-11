import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { ROLE_HOME } from '@/lib/types';

/** Sends each user to their role's home. */
export default function Index() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/sign-in" />;
  return <Redirect href={ROLE_HOME[user.role]} />;
}

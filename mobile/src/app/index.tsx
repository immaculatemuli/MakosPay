import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth';

/** Sends each user to their role's home. */
export default function Index() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/sign-in" />;
  return <Redirect href={`/${user.role}`} />;
}

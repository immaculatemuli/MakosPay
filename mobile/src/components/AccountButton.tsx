import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { Pressable } from 'react-native';
import { colors } from './ui';

/** Person icon at the top right of a tab: opens My account (password, sign out). */
export function AccountButton({ href }: { href: Href }) {
  return (
    <Pressable onPress={() => router.push(href)} hitSlop={10} style={{ marginRight: 16 }} accessibilityLabel="My account">
      <Ionicons name="person-circle-outline" size={28} color={colors.primary} />
    </Pressable>
  );
}

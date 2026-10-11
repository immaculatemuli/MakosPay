import { colors } from './ui';

export const stackOptions = {
  headerTintColor: colors.primary,
  headerTitleStyle: { color: colors.text },
  headerBackButtonDisplayMode: 'minimal' as const,
  contentStyle: { backgroundColor: colors.bg },
};

export const tabOptions = {
  tabBarActiveTintColor: colors.primary,
  headerTitleStyle: { color: colors.text },
};

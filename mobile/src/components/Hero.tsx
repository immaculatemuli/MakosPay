import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from './ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

function today() {
  const d = new Date();
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Coloured header at the top of a home screen: date, greeting, and optional extra content. */
export function Hero({ name, subtitle, children }: { name?: string; subtitle?: string; children?: ReactNode }) {
  return (
    <View style={styles.hero}>
      <Text style={styles.date}>{today()}</Text>
      <Text style={styles.title}>
        {greeting()}
        {name ? `, ${name.split(' ')[0]}` : ''}
      </Text>
      {subtitle && <Text style={styles.sub}>{subtitle}</Text>}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.primary, borderRadius: 16, padding: 20, marginBottom: 14 },
  date: { color: colors.primarySoft, fontSize: 13, fontWeight: '600' },
  title: { color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 4 },
  sub: { color: colors.primarySoft, fontSize: 14, marginTop: 2 },
});

import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

export default function MeScreen() {
  const { identity, account, city, wsConnected } = useApp();

  const displayName = account?.display_name ?? identity?.nickname ?? '—';
  const initials    = displayName.slice(0, 2).toUpperCase();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>👤 Me</Text>
      </View>

      <View style={styles.body}>
        {/* Avatar */}
        <View style={styles.avatarWrapper}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.displayName}>{displayName}</Text>
          {account
            ? <Text style={styles.accountType}>Registered account</Text>
            : <Text style={styles.accountType}>Guest session</Text>}
        </View>

        {/* Status card */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>City</Text>
            <Text style={styles.cardValue}>{city?.name ?? 'Not set'}</Text>
          </View>
          <View style={[styles.cardRow, styles.cardRowLast]}>
            <Text style={styles.cardLabel}>Connection</Text>
            <View style={styles.connRow}>
              <View style={[styles.connDot, wsConnected ? styles.connDotOn : styles.connDotOff]} />
              <Text style={styles.cardValue}>{wsConnected ? 'Live' : 'Offline'}</Text>
            </View>
          </View>
          {identity && (
            <View style={[styles.cardRow, styles.cardRowLast]}>
              <Text style={styles.cardLabel}>Guest ID</Text>
              <Text style={[styles.cardValue, styles.mono]} numberOfLines={1}>
                {identity.guestId.slice(0, 16)}…
              </Text>
            </View>
          )}
        </View>

        {/* Sign in CTA — only for guests */}
        {!account && (
          <TouchableOpacity style={styles.signInBtn} activeOpacity={0.8}>
            <Text style={styles.signInText}>Sign in or create account →</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle:  { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text },
  body:         { flex: 1, padding: Spacing.md, gap: Spacing.md },
  avatarWrapper:{ alignItems: 'center', paddingVertical: Spacing.lg, gap: Spacing.sm },
  avatar: {
    width:           72,
    height:          72,
    borderRadius:    Radius.full,
    backgroundColor: Colors.bg3,
    alignItems:      'center',
    justifyContent:  'center',
    borderWidth:     2,
    borderColor:     Colors.accent,
  },
  avatarText:   { fontSize: FontSizes.xl, fontWeight: '700', color: Colors.accent },
  displayName:  { fontSize: FontSizes.lg, fontWeight: '600', color: Colors.text },
  accountType:  { fontSize: FontSizes.sm, color: Colors.muted },
  card: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    overflow:        'hidden',
  },
  cardRow: {
    flexDirection:    'row',
    justifyContent:   'space-between',
    alignItems:       'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:  Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  cardRowLast:  { borderBottomWidth: 0 },
  cardLabel:    { fontSize: FontSizes.sm, color: Colors.muted },
  cardValue:    { fontSize: FontSizes.sm, color: Colors.text, fontWeight: '500' },
  mono:         { fontVariant: ['tabular-nums'], color: Colors.muted },
  connRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  connDot:      { width: 8, height: 8, borderRadius: 4 },
  connDotOn:    { backgroundColor: Colors.green },
  connDotOff:   { backgroundColor: Colors.muted2 },
  signInBtn: {
    backgroundColor: Colors.accent,
    borderRadius:    Radius.lg,
    paddingVertical: Spacing.md,
    alignItems:      'center',
  },
  signInText: { color: Colors.white, fontWeight: '700', fontSize: FontSizes.md },
});

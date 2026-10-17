/**
 * AuthGate - the sign-up sheet (SPEC 9.9), shown when a guest tries an action
 * that needs an account. One line says why (`reason`), then Sign up / I have an
 * account, which bring the user back to `returnTo` (or to where they were).
 * Presented as a transparent modal (root _layout), so the screen behind stays visible.
 */

import { useEffect } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { track } from '@/services/analytics';
import { authQuery } from '@/lib/authReturn';

const REASONS = [
  'view_profile', 'create_event', 'send_dm', 'join_hangout', 'create_hangout',
  'create_challenge', 'accept_challenge', 'join_challenge', 'daily_proof', 'daily_vote',
] as const;
type GateReason = typeof REASONS[number];

export default function AuthGateScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { t } = useTranslation('auth');
  const { reason, returnTo } = useLocalSearchParams<{ reason?: string; returnTo?: string }>();
  const gateReason: GateReason = (REASONS as readonly string[]).includes(reason ?? '') ? reason as GateReason : 'view_profile';

  useEffect(() => { track('guest_signup_prompted', { action: gateReason }); }, [gateReason]);

  // replace, not push: the sheet leaves the stack, so after auth the user
  // lands on returnTo (or pops straight back to the screen they were on).
  const go = (base: '/sign-up' | '/sign-in') =>
    router.replace(`${base}${authQuery(returnTo, gateReason)}` as never);

  return (
    <View style={styles.root}>
      <Pressable style={styles.scrim} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('sheet.notNow')} />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.mark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={styles.markText}>Hi</Text>
        </View>
        <Text style={styles.title} accessibilityRole="header">{t(`sheet.reason.${gateReason}`)}</Text>
        <Text style={styles.subtitle}>{t('sheet.comeBack')}</Text>

        <TouchableOpacity style={styles.primary} onPress={() => go('/sign-up')} activeOpacity={0.85} accessibilityRole="button">
          <Text style={styles.primaryText}>{t('sheet.signUp')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={() => go('/sign-in')} activeOpacity={0.8} accessibilityRole="button">
          <Text style={styles.secondaryText}>{t('sheet.haveAccount')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.notNow} onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.notNowText}>{t('sheet.notNow')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root:          { flex: 1, justifyContent: 'flex-end' },
  scrim:         { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:         { backgroundColor: c.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: Spacing.lg, paddingTop: 10, paddingBottom: Spacing.md, alignItems: 'center', gap: 12 },
  handle:        { width: 40, height: 5, borderRadius: 3, backgroundColor: c.line, marginBottom: 6 },
  mark:          { width: 52, height: 52, borderRadius: 16, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  markText:      { color: c.white, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  title:         { fontSize: FontSizes.xl, fontWeight: '800', color: c.text, textAlign: 'center', letterSpacing: -0.3 },
  subtitle:      { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center', marginBottom: 4 },
  primary:       { alignSelf: 'stretch', minHeight: 54, borderRadius: 18, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText:   { color: c.white, fontSize: FontSizes.md, fontWeight: '700' },
  secondary:     { alignSelf: 'stretch', minHeight: 54, borderRadius: 18, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: c.text, fontSize: FontSizes.md, fontWeight: '700' },
  notNow:        { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  notNowText:    { color: c.muted, fontSize: FontSizes.sm, fontWeight: '600' },
});

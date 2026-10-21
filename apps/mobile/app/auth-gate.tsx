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
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { track } from '@/services/analytics';
import { authQuery } from '@/lib/authReturn';
import { BrandMark, Button } from '@/ui';
import { goBack } from '@/lib/nav';
import { useSwipeDown } from '@/ui/useSwipeDown';

const REASONS = [
  'view_profile', 'create_event', 'send_dm', 'join_hangout', 'create_hangout',
  'create_challenge', 'accept_challenge', 'join_challenge', 'daily_proof', 'daily_vote', 'first_spot',
] as const;
type GateReason = typeof REASONS[number];

export default function AuthGateScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { t } = useTranslation('auth');
  const { reason, returnTo, city } = useLocalSearchParams<{ reason?: string; returnTo?: string; city?: string }>();
  const gateReason: GateReason = (REASONS as readonly string[]).includes(reason ?? '') ? reason as GateReason : 'view_profile';

  useEffect(() => { track('guest_signup_prompted', { action: gateReason }); }, [gateReason]);
  // Every way out is the same close: the scrim, Not now, a swipe down, Android back (a route).
  const swipe = useSwipeDown(goBack, { capture: true });

  // replace, not push: the sheet leaves the stack, so after auth the user
  // lands on returnTo (or pops straight back to the screen they were on).
  const go = (base: '/sign-up' | '/sign-in') =>
    router.replace(`${base}${authQuery(returnTo, gateReason)}` as never);

  return (
    <View style={styles.root} testID="auth-gate">
      <Pressable style={styles.scrim} onPress={() => goBack()} accessibilityRole="button" accessibilityLabel={t('sheet.notNow')} />
      <SafeAreaView edges={['bottom']} style={styles.sheet} {...swipe}>
        <View style={styles.handle} />
        <BrandMark size="lg" />
        <Text style={styles.tagline}>{t('firstLaunch', { ns: 'common' })}</Text>
        {/* A vote names its city: "Sign up to vote for Lisbon". */}
        <Text style={styles.title} accessibilityRole="header">
          {gateReason === 'daily_vote' && city ? t('sheet.reason.daily_vote_city', { city }) : t(`sheet.reason.${gateReason}`)}
        </Text>
        <Text style={styles.subtitle}>{t('sheet.comeBack')}</Text>

        <Button label={t('sheet.signUp')} onPress={() => go('/sign-up')} style={styles.stretch} />
        <Button variant="secondary" label={t('sheet.haveAccount')} onPress={() => go('/sign-in')} style={styles.stretch} />
        <TouchableOpacity style={styles.notNow} onPress={() => goBack()} accessibilityRole="button">
          <Text style={styles.notNowText}>{t('sheet.notNow')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root:          { flex: 1, justifyContent: 'flex-end' },
  scrim:         { ...StyleSheet.absoluteFillObject, backgroundColor: c.scrim },
  sheet:         { backgroundColor: c.bg, borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet, paddingHorizontal: Spacing.lg, paddingTop: 10, paddingBottom: Spacing.md, alignItems: 'center', gap: 12 },
  handle:        { width: 40, height: 5, borderRadius: Radius.full, backgroundColor: c.line, marginBottom: 6 },
  title:         { fontSize: FontSizes.xl, fontWeight: '800', color: c.text, textAlign: 'center', letterSpacing: -0.3 },
  tagline:       { fontSize: FontSizes.sm, fontWeight: '700', color: c.muted, textAlign: 'center', marginTop: -4 },
  subtitle:      { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center', marginBottom: 4 },
  stretch:       { alignSelf: 'stretch' },
  notNow:        { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  notNowText:    { color: c.muted, fontSize: FontSizes.sm, fontWeight: '600' },
});

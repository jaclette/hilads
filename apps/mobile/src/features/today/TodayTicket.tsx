import { useEffect, useRef } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { useScope } from '@/context/ScopeContext';
import { localizeCityName } from '@/i18n/cityName';
import { track } from '@/services/analytics';
import { isFinalHours } from '@/hooks/useDaily';
import { DailyStatusChip } from '@/features/daily/DailyStatusChip';
import { ProposedBy } from '@/features/daily/DailyChannelCard';
import { OriginalToggle, useOriginal } from '@/features/daily/OriginalToggle';
import { dailyTrackProps } from '@/features/daily/track';
import { trackLocalPassEarned } from '@/features/daily/localPassTracking';
import { THEME_ICON, clock } from './format';
import { Button, Chip } from '@/ui';
import type { DailyToday } from '@/types';
import { themeName } from '@/features/daily/themes';

/**
 * Today's Daily Challenge as a ticket (SPEC 9.3, today.html): kicker and theme
 * chip, the challenge (with its "Proposed by" credit), the time left and the early-bonus hint, a perforated
 * divider, the Local Twist in live cities, and "Take the challenge" (or my
 * proof's status) with how many people took it, then tomorrow's Local Twist
 * proposal for locals. Tapping the card opens the challenge sheet.
 */
export function TodayTicket({ data, loading, secondsLeft }: { data: DailyToday | null; loading: boolean; secondsLeft: number | null }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const { account } = useApp();
  const { scope } = useScope();
  const [showOriginal, toggleOriginal] = useOriginal();
  const tracked = useRef<string | null>(null);

  const challenge = data?.challenge ?? null;
  useEffect(() => {
    if (!challenge || tracked.current === challenge.id) return;
    tracked.current = challenge.id;
    track('daily_challenge_viewed', { source: 'today', ...dailyTrackProps(data, account?.mode) });
  }, [challenge, data, account?.mode]);
  useEffect(() => { trackLocalPassEarned(data?.localPass, account?.id); }, [data?.localPass, account?.id]);

  if (loading && !data) {
    return <View style={[styles.ticket, styles.placeholder]}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (!challenge) {
    return (
      <View style={[styles.ticket, styles.top]}>
        <Kicker />
        <Text style={styles.text}>{t('nothingLive')}</Text>
        {secondsLeft !== null && <Text style={styles.meta}>{t('nextIn', { time: clock(secondsLeft) })}</Text>}
      </View>
    );
  }

  const city = data?.city;
  const myProof = data?.myProof ?? null;
  const twist = data?.twist && city?.isLive ? data.twist : null;
  const earlyUntil = !myProof && data?.early && data.early.until * 1000 > Date.now() ? data.early.until : null;
  const openSheet = () => router.push('/daily/today?source=today' as never);
  // People who took it: the city's count in city scope once it has proofs, else World's.
  const took = (scope === 'city' && data?.counts?.city ? data.counts.city : data?.counts?.world) ?? 0;
  const onCta = () => {
    if (myProof) { openSheet(); return; }
    if (!account) { router.push('/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof' as never); return; }
    router.push('/daily/proof' as never);
  };

  return (
    <TouchableOpacity style={styles.ticket} onPress={openSheet} activeOpacity={0.92} accessibilityRole="button"
                      accessibilityLabel={`${t('kicker')}: ${challenge.text}`}>
      <View style={styles.top}>
        <View style={styles.headRow}>
          <Kicker />
          {!!challenge.theme && <Chip icon={THEME_ICON[challenge.theme.key] ?? 'pricetag-outline'} label={themeName(challenge.theme.key)} />}
        </View>
        <Text style={styles.text}>{showOriginal && challenge.original ? challenge.original.text : challenge.text}</Text>
        <OriginalToggle translated={!!challenge.original || !!twist?.originalText} showingOriginal={showOriginal} onPress={toggleOriginal} />
        {challenge.proposedBy && <ProposedBy credit={challenge.proposedBy} />}
        <View style={styles.metaRow}>
          {secondsLeft !== null && (
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={15} color={isFinalHours(secondsLeft) ? colors.warning : colors.muted} />
              <Text style={[styles.meta, isFinalHours(secondsLeft) && styles.metaWarn]}>{t('timeLeft', { time: clock(secondsLeft) })}</Text>
            </View>
          )}
          {earlyUntil !== null && (
            <Text style={styles.early}>
              {t('today.early', { time: new Date(earlyUntil * 1000).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })}
            </Text>
          )}
        </View>
      </View>

      <Perforation />

      <View style={styles.bottom}>
        {twist && (
          <View style={styles.twist}>
            <Text style={styles.twistLabel}>{t('twistIn', { city: localizeCityName(city?.name ?? '') })}</Text>
            <Text style={styles.twistText}>{showOriginal && twist.originalText ? twist.originalText : twist.text}</Text>
          </View>
        )}
        {myProof ? (
          <View style={styles.mine}>
            <DailyStatusChip status={myProof.status} />
            <TouchableOpacity onPress={openSheet} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.link}>{t('today.seeMine')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Button label={t('cta')} onPress={onCta} />
        )}
        {took > 0 && (
          <TouchableOpacity style={styles.took} onPress={openSheet} accessibilityRole="button">
            <Text style={styles.tookText}>
              {t('today.tookIt', { count: took })} · <Text style={styles.link}>{t('today.seePhotos', { count: took })}</Text>
            </Text>
          </TouchableOpacity>
        )}
        {/* Locals of a live city: tomorrow's Local Twist proposal (SPEC 8.6). */}
        {data?.twistProposal && (data.twistProposal.open || data.twistProposal.status) && (
          <TouchableOpacity
            style={styles.propose}
            onPress={() => {
              track('daily_proposal_started', { entry: 'twist_hero', type: 'twist', city: city?.name ?? null });
              router.push('/daily/twist' as never);
            }}
            accessibilityRole="button"
          >
            <Ionicons name="leaf-outline" size={16} color={colors.primaryText} />
            <Text style={styles.proposeText} numberOfLines={2}>
              {data.twistProposal.status
                ? t('twist.heroStatus', { status: t(`twist.status.${data.twistProposal.status}`) })
                : t('twist.heroCta', { time: new Date(data.twistProposal.closesAt * 1000).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primaryText} />
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

function Kicker() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  return (
    <View style={styles.kicker}>
      <Ionicons name="flame-outline" size={17} color={colors.primaryText} />
      <Text style={styles.kickerText}>{t('kicker')}</Text>
    </View>
  );
}

/** The ticket's perforated divider: a dashed line between two round cut-outs. */
export function Perforation() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.perf} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.perfLine}>
        {Array.from({ length: 48 }, (_, i) => <View key={i} style={styles.dash} />)}
      </View>
      <View style={[styles.notch, styles.notchLeft]} />
      <View style={[styles.notch, styles.notchRight]} />
    </View>
  );
}

const NOTCH = 20;

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  ticket:      { backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.ticketLine, borderRadius: 22 },
  placeholder: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  top:         { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12, gap: 8 },
  headRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  kicker:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kickerText:  { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
  text:        { fontSize: FontSizes.lg, lineHeight: 25, fontWeight: '800', color: c.text, letterSpacing: -0.2 },
  metaRow:     { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 14, rowGap: 4 },
  metaItem:    { flexDirection: 'row', alignItems: 'center', gap: 5 },
  meta:        { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted, fontVariant: ['tabular-nums'] },
  metaWarn:    { color: c.warning },
  early:       { fontSize: FontSizes.xs, fontWeight: '600', color: c.localText },
  perf:        { height: NOTCH, justifyContent: 'center', paddingHorizontal: 18 },
  // Dashes drawn as views: a dashed top border isn't reliable on Android.
  perfLine:    { flexDirection: 'row', gap: 5, height: 2, overflow: 'hidden' },
  dash:        { width: 6, height: 2, borderRadius: 1, backgroundColor: c.ticketLine },
  notch:       { position: 'absolute', top: 0, width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, backgroundColor: c.bg },
  notchLeft:   { left: -NOTCH / 2 - 1.5 },
  notchRight:  { right: -NOTCH / 2 - 1.5 },
  bottom:      { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 16, gap: 10 },
  twist:       { gap: 4 },
  propose:     { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 },
  proposeText: { flex: 1, fontSize: FontSizes.xs, fontWeight: '700', color: c.primaryText },
  twistLabel:  { fontSize: FontSizes.xs, fontWeight: '700', color: c.muted },
  twistText:   { fontSize: 15, lineHeight: 22, fontWeight: '500', color: c.text },
  mine:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 44 },
  link:        { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
  took:        { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  tookText:    { fontSize: 13, fontWeight: '600', color: c.muted, textAlign: 'center' },
});

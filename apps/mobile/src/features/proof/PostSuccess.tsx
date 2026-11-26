import { Pressable, Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Space, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { track } from '@/services/analytics';
import { Button, CityFlag, IconButton } from '@/ui';
import { Confetti } from '@/ui/joy';
import { shortCityName } from '@/i18n/cityName';
import { SharePanel } from '@/features/share/SharePanel';
import { proofShare } from '@/features/share/content';
import { AmbientBats, BatBurst } from '@/features/event/SeasonalArt';
import type { DailyChallenge, DailyProof } from '@/types';

/**
 * Right after a post (docs/mockups/hilads_success_share_mockup.html): a compact header (my city is on
 * the board, my photo is live on the map, chips for the points earned, my streak and the cities in
 * today), the share card as the hero (slightly tilted; swipe: its templates with dots; tap: full
 * screen), the share targets right under it (Instagram Story, Zalo, WhatsApp, Messenger, More, Save:
 * each shares the template on screen with my link, my invite code included), one primary action: how
 * the world played. ✕ goes back to Today. Confetti once. The points are a chip here (the big reward
 * screen is kept for milestones: app/daily/proof.tsx).
 */
export function PostSuccess({ proof, challenge, citiesToday, points, streak, halloween, onClose, onMap, onWorld, children }: {
  proof: DailyProof; challenge: DailyChallenge; citiesToday: number | null; points: number | null; streak: number | null;
  halloween: boolean; onClose: () => void; onMap: () => void; onWorld: () => void; children?: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const cardH = Math.max(250, Math.min(430, winH - insets.top - insets.bottom - 380));
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="proof-screen">
      <View style={styles.head}>
        <View style={styles.close}>
          <IconButton icon="close" iconSize={22} label={t('close', { ns: 'common' })} onPress={onClose} testID="proof-sent-close" />
        </View>
        {/* A seasonal event's live day: a burst of bats instead of the party popper. */}
        {halloween ? <BatBurst /> : <Text style={styles.emoji} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">🎉</Text>}
        <View style={styles.titleRow}>
          {!!proof.city?.country && <CityFlag country={proof.city.country} size={20} />}
          <Text style={styles.title} accessibilityRole="header" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>
            {proof.city?.name ? t(halloween ? 'event.halloween.onBoard' : 'proof.onBoard', { city: shortCityName(proof.city.name) }) : t('proof.sentTitleNoCity')}
          </Text>
        </View>
        <Pressable onPress={() => { track('proof_sent_map', {}); onMap(); }} accessibilityRole="link" hitSlop={6} testID="proof-sent-map">
          <Text style={styles.live}>{t('proof.liveOnMap')} <Ionicons name="location" size={13} color={colors.primaryText} /></Text>
        </Pressable>
        <View style={styles.chips}>
          {points !== null && points > 0 && <Text style={[styles.chip, styles.chipGold]}>{t('proof.chipPoints', { count: points })}</Text>}
          {streak !== null && streak >= 2 && <Text style={styles.chip}>🔥 {t('proof.chipStreak', { count: streak })}</Text>}
          {citiesToday !== null && citiesToday > 0 && <Text style={styles.chip}>{t('proof.chipCities', { count: citiesToday })}</Text>}
        </View>
      </View>
      <View style={styles.stage}>
        <SharePanel compact content={proofShare(proof, challenge)} source="after_proof" previewHeight={cardH} />
      </View>
      {!halloween && <Confetti run />}
      <View style={styles.footer}>
        <Button icon="earth-outline" label={t('proof.seeWorld')} testID="proof-sent-world" onPress={() => { track('proof_sent_world', {}); onWorld(); }} />
      </View>
      <AmbientBats top={60} />
      {children}
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  head:      { alignItems: 'center', paddingHorizontal: Spacing.lg, paddingTop: Space.xs, gap: 2 },
  close:     { position: 'absolute', left: Spacing.md, top: Space.xs, zIndex: 2 },
  emoji:     { fontSize: 30, lineHeight: 36 },
  titleRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm, flexWrap: 'wrap' },
  title:     { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, textAlign: 'center', flexShrink: 1 },
  live:      { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText, textAlign: 'center', paddingVertical: 4 },
  chips:     { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Space.xs, marginTop: 4 },
  chip:      { fontSize: FontSizes.xs, fontWeight: '800', color: c.primaryOnTint, backgroundColor: c.primaryTint, borderRadius: Radius.full,
               paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' },
  chipGold:  { color: c.onMedal, backgroundColor: c.medalGold },
  stage:     { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.md },
  footer:    { paddingHorizontal: Spacing.md, paddingTop: Space.sm, paddingBottom: Space.sm },
});

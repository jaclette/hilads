import { useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Modal, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, FontSizes, Radius, Spacing } from '@/constants';
import { countryToFlag } from '@/lib/countryFlag';
import type { ScoreCelebration } from '@/api/challenges';

type Props = {
  data:     ScoreCelebration | null; // null = closed
  visible:  boolean;
  onClose:  () => void;
};

// Per-kind subtitle key. Falls back to `default` when the server hasn't
// classified the top kind (older events, ghost path, etc.).
const KIND_KEYS: Record<string, string> = {
  accepted:    'scoreCelebration.subtitle.accepted',
  date_locked: 'scoreCelebration.subtitle.date_locked',
  meetup:      'scoreCelebration.subtitle.meetup',
  debrief:     'scoreCelebration.subtitle.debrief',
  ghost:       'scoreCelebration.subtitle.ghost',
};

/**
 * The "+X points!" launch popin. Fires once per cold start when the user
 * has unacknowledged score_events on the ledger. Friendly + animated:
 *   - Backdrop fades in
 *   - Card spring-scales from 0.85 → 1
 *   - Trophy emoji bounces in
 *   - Points headline counts up from 0 → total
 *   - Rank rows stagger-fade
 * The CTA closes; the parent's onClose acks the server watermark so the
 * same delta is never celebrated twice.
 */
export function ScoreCelebrationModal({ data, visible, onClose }: Props) {
  const { t } = useTranslation('challenge');

  // ── animation drivers ───────────────────────────────────────────────────
  const backdrop = useRef(new Animated.Value(0)).current;
  const card     = useRef(new Animated.Value(0)).current; // scale + opacity
  const trophy   = useRef(new Animated.Value(0)).current;
  const points   = useRef(new Animated.Value(0)).current;
  const row1     = useRef(new Animated.Value(0)).current;
  const row2     = useRef(new Animated.Value(0)).current;
  const [displayPoints, setDisplayPoints] = useState(0);

  // Listen on the points driver and update the rendered integer. Animated
  // can't directly render into <Text>; we coalesce float values to ints
  // here so the count looks discrete (no decimals flashing past).
  useEffect(() => {
    const id = points.addListener(({ value }) => {
      setDisplayPoints(Math.round(value));
    });
    return () => { points.removeListener(id); };
  }, [points]);

  // Run the open sequence whenever we transition into visible. Reset all
  // drivers first so a re-open in the same session animates cleanly.
  useEffect(() => {
    if (!visible || !data || data.points <= 0) return;
    backdrop.setValue(0);
    card.setValue(0);
    trophy.setValue(0);
    points.setValue(0);
    row1.setValue(0);
    row2.setValue(0);

    Animated.parallel([
      Animated.timing(backdrop, {
        toValue: 1, duration: 220, easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(card, {
        toValue: 1, friction: 7, tension: 80,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(120),
        Animated.spring(trophy, {
          toValue: 1, friction: 4, tension: 120,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.delay(180),
        Animated.timing(points, {
          toValue: data.points,
          duration: Math.min(900, 200 + data.points * 24),
          easing: Easing.out(Easing.cubic),
          // count-up reads <Text> from displayPoints — JS driver required
          useNativeDriver: false,
        }),
      ]),
      Animated.sequence([
        Animated.delay(320),
        Animated.timing(row1, {
          toValue: 1, duration: 280, easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.delay(420),
        Animated.timing(row2, {
          toValue: 1, duration: 280, easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [visible, data, backdrop, card, trophy, points, row1, row2]);

  if (!data || data.points <= 0) return null;

  // ── derived copy ────────────────────────────────────────────────────────
  const subtitleKey  = data.top_kind && KIND_KEYS[data.top_kind]
    ? KIND_KEYS[data.top_kind]
    : 'scoreCelebration.subtitle.default';

  const topN         = data.top_n ?? 100;
  // Server returns null when the caller is outside the bounded top-N
  // window — we surface that as "100+" rather than a numeric rank.
  const cityRank     = data.rank_month?.city   ?? data.rank_alltime?.city   ?? null;
  const worldRank    = data.rank_month?.global ?? data.rank_alltime?.global ?? null;

  const cityRankCopy = cityRank !== null
    ? t('scoreCelebration.rank.city',   { rank: cityRank,  city: data.city_name ?? '' })
    : t('scoreCelebration.rank.cityBeyond', { topN });

  const worldRankCopy = worldRank !== null
    ? t('scoreCelebration.rank.world', { rank: worldRank })
    : t('scoreCelebration.rank.worldBeyond', { topN });

  const cityFlag  = countryToFlag(data.city_country ?? null) || '📍';
  const worldFlag = '🌍';

  return (
    <Modal visible={visible} transparent statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
        {/* Tap outside to close — same gesture as the CTA. */}
        <Pressable style={styles.backdropPressable} onPress={onClose} />

        <Animated.View
          style={[
            styles.card,
            {
              opacity: card,
              transform: [{
                scale: card.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }),
              }],
            },
          ]}
        >
          {/* Confetti gutter — purely decorative. Lives above the trophy so
              the eye lands on it first. */}
          <Text style={styles.confetti}>✨   🎉   ✨</Text>

          <Animated.Text
            style={[
              styles.trophy,
              {
                transform: [{
                  scale: trophy.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
                }],
              },
            ]}
          >
            🏆
          </Animated.Text>

          <Text style={styles.points}>
            +{displayPoints}
            <Text style={styles.pointsUnit}> {t('scoreCelebration.unit')}</Text>
          </Text>

          <Text style={styles.subtitle}>
            {t(subtitleKey)}
          </Text>

          <View style={styles.divider} />

          <Animated.View style={[styles.row, { opacity: row1 }]}>
            <Text style={styles.rowFlag}>{cityFlag}</Text>
            <Text style={styles.rowLabel} numberOfLines={1}>{cityRankCopy}</Text>
          </Animated.View>
          <Animated.View style={[styles.row, { opacity: row2 }]}>
            <Text style={styles.rowFlag}>{worldFlag}</Text>
            <Text style={styles.rowLabel} numberOfLines={1}>{worldRankCopy}</Text>
          </Animated.View>

          <Pressable
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
            onPress={onClose}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>{t('scoreCelebration.cta')}</Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  backdropPressable: { ...StyleSheet.absoluteFillObject },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Colors.bg2,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,122,60,0.32)',
    paddingTop:    20,
    paddingBottom: 22,
    paddingHorizontal: 22,
    alignItems: 'center',
    // Warm-orange glow ring — the popin is the brand's "yay" moment, so we
    // lean into the accent here rather than the neutral surface chrome.
    shadowColor:   '#FF7A3C',
    shadowOpacity: 0.35,
    shadowRadius:  28,
    shadowOffset:  { width: 0, height: 0 },
    elevation:     12,
  },
  confetti: {
    fontSize:     16,
    letterSpacing: 4,
    marginBottom: 4,
    opacity:      0.85,
  },
  trophy: {
    fontSize:    64,
    lineHeight:  72,
    marginBottom: 4,
  },
  points: {
    fontSize: 44,
    fontWeight: '900',
    color: '#FF7A3C',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 4,
  },
  pointsUnit: {
    fontSize:   18,
    fontWeight: '700',
    color:      Colors.text,
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: FontSizes.md,
    color:    Colors.muted,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  divider: {
    width:   '60%',
    height:  1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
    paddingVertical:  8,
    paddingHorizontal: 12,
    width: '100%',
  },
  rowFlag: {
    fontSize:   20,
    lineHeight: 24,
  },
  rowLabel: {
    flex: 1,
    fontSize:   FontSizes.md,
    fontWeight: '700',
    color:      Colors.text,
  },
  cta: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical:   14,
    backgroundColor:   '#FF7A3C',
    borderRadius:      Radius.full,
    width: '100%',
    alignItems: 'center',
    shadowColor:   '#FF7A3C',
    shadowOpacity: 0.45,
    shadowRadius:  16,
    shadowOffset:  { width: 0, height: 6 },
  },
  ctaPressed: { opacity: 0.85 },
  ctaText: {
    fontSize:   FontSizes.md,
    fontWeight: '900',
    color:      '#fff',
    letterSpacing: 0.3,
  },
});

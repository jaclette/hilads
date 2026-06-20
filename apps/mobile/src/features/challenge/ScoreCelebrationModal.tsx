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
  // PR38 - tap a rank row to open the leaderboard pre-scoped to that
  // lens. Receives 'city' or 'world'. Optional - when undefined, rows
  // stay inert (older callers).
  onOpenLeaderboard?: (scope: 'city' | 'world') => void;
};

// Per-kind subtitle key. Falls back to `default` when the server hasn't
// classified the top kind (older events, ghost path, etc.).
const KIND_KEYS: Record<string, string> = {
  challenge_created: 'scoreCelebration.subtitle.challenge_created',
  accepted:    'scoreCelebration.subtitle.accepted',
  date_locked: 'scoreCelebration.subtitle.date_locked',
  meetup:      'scoreCelebration.subtitle.meetup',
  debrief:     'scoreCelebration.subtitle.debrief',
  ghost:       'scoreCelebration.subtitle.ghost',
  meet_bonus:  'scoreCelebration.subtitle.meet_bonus',
};

// Per-kind short-label key + emoji used in the event rows. These are the
// "what happened" chips (e.g. "🤝 Accepted") that sit next to each
// challenge title. Distinct from the subtitle keys above (which are full
// sentences for the single-event lead).
const KIND_SHORT_KEYS: Record<string, string> = {
  challenge_created: 'scoreCelebration.kindShort.challenge_created',
  accepted:    'scoreCelebration.kindShort.accepted',
  date_locked: 'scoreCelebration.kindShort.date_locked',
  meetup:      'scoreCelebration.kindShort.meetup',
  debrief:     'scoreCelebration.kindShort.debrief',
  ghost:       'scoreCelebration.kindShort.ghost',
  meet_bonus:  'scoreCelebration.kindShort.meet_bonus',
};
const KIND_EMOJI: Record<string, string> = {
  challenge_created: '🎯',
  accepted:    '🤝',
  date_locked: '🗓️',
  meetup:      '🎉',
  debrief:     '🎉',
  ghost:       '👻',
  meet_bonus:  '🤝',
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
export function ScoreCelebrationModal({ data, visible, onClose, onOpenLeaderboard }: Props) {
  const { t } = useTranslation('challenge');

  // ── animation drivers ───────────────────────────────────────────────────
  const backdrop = useRef(new Animated.Value(0)).current;
  const card     = useRef(new Animated.Value(0)).current; // scale + opacity
  const trophy   = useRef(new Animated.Value(0)).current;
  const points   = useRef(new Animated.Value(0)).current;
  const row1     = useRef(new Animated.Value(0)).current;
  const row2     = useRef(new Animated.Value(0)).current;
  const glow     = useRef(new Animated.Value(0)).current; // total illuminate (0→1)
  const pop      = useRef(new Animated.Value(0)).current; // total scale pop
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
    glow.setValue(0);
    pop.setValue(0);

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
          duration: Math.min(2400, 600 + data.points * 55),
          easing: Easing.out(Easing.cubic),
          // count-up reads <Text> from displayPoints - JS driver required
          useNativeDriver: false,
        }),
        // Illuminate the total once the count-up lands: glow gold + a scale pop.
        Animated.parallel([
          Animated.timing(glow, { toValue: 1, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: false }),
          Animated.sequence([
            Animated.spring(pop, { toValue: 1, friction: 3, tension: 170, useNativeDriver: false }),
            Animated.spring(pop, { toValue: 0, friction: 5, tension: 120, useNativeDriver: false }),
          ]),
        ]),
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
  // window - we surface that as "100+" rather than a numeric rank.
  const cityRank        = data.rank_month?.city      ?? data.rank_alltime?.city      ?? null;
  const worldRank       = data.rank_month?.global    ?? data.rank_alltime?.global    ?? null;
  const cityInCitiesRank = data.city_rank_month      ?? data.city_rank_alltime       ?? null;

  // Total = the caller's grand total AFTER the delta lands. Prefer monthly
  // total when in-month (matches the rank lens above); fall back to alltime
  // when score_month_ref is stale or no monthly progress.
  const totalPoints  = (data.total_month && data.total_month > 0)
    ? data.total_month
    : (data.total_alltime ?? 0);

  // The running total climbs in sync with the "+X" count-up: it starts at the
  // score BEFORE this gain (total - delta) and ends at the final total. As
  // displayPoints animates 0 → data.points, displayTotal animates start → final.
  const startTotal   = Math.max(0, totalPoints - data.points);
  const displayTotal = startTotal + displayPoints;

  const cityRankCopy = cityRank !== null
    ? t('scoreCelebration.rank.city',   { rank: cityRank,  city: data.city_name ?? '' })
    : t('scoreCelebration.rank.cityBeyond', { topN });

  const worldRankCopy = worldRank !== null
    ? t('scoreCelebration.rank.world', { rank: worldRank })
    : t('scoreCelebration.rank.worldBeyond', { topN });

  const cityInCitiesCopy = cityInCitiesRank !== null
    ? t('scoreCelebration.rank.cities',       { rank: cityInCitiesRank, city: data.city_name ?? '' })
    : t('scoreCelebration.rank.citiesBeyond', { topN,                   city: data.city_name ?? '' });

  const cityFlag  = countryToFlag(data.city_country ?? null) || '📍';
  const worldFlag = '🌐';
  const citiesFlag = '🏙️';

  return (
    <Modal visible={visible} transparent statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
        {/* Tap outside to close - same gesture as the CTA. */}
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
          {/* Confetti gutter - purely decorative. Lives above the trophy so
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

          {/* Running total after the delta lands. Kept small + muted so
              the "+X" headline still dominates emotionally; this is
              context, not the celebration itself. */}
          {totalPoints > 0 && (
            <Animated.Text
              style={[
                styles.total,
                {
                  color: glow.interpolate({ inputRange: [0, 1], outputRange: [Colors.muted, '#FFC93C'] }),
                  textShadowColor: '#FFC93C',
                  textShadowRadius: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 8] }),
                  transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }],
                },
              ]}
            >
              {t('scoreCelebration.total', { total: displayTotal })}
            </Animated.Text>
          )}

          <Text style={styles.subtitle}>
            {t(subtitleKey)}
          </Text>

          {/* Per-event breakdown - newest first, capped at 6 server-side.
              When the user has more, the trailing "and N more" line keeps
              the modal scannable without truncating the score itself
              (the headline already shows the full delta). */}
          {data.events && data.events.length > 0 && (
            <View style={styles.events}>
              {data.events.map((ev) => {
                const emoji   = KIND_EMOJI[ev.kind] ?? '🏆';
                const kindKey = KIND_SHORT_KEYS[ev.kind] ?? 'scoreCelebration.kindShort.default';
                const title   = ev.challenge_title
                  ?? t('scoreCelebration.event.deletedChallenge');
                const isBonus = ev.kind === 'meet_bonus';
                return (
                  <View key={ev.id} style={[styles.eventRow, isBonus && styles.eventRowBonus]}>
                    <View style={[styles.eventPoints, isBonus && styles.eventPointsBonus]}>
                      <Text style={[styles.eventPointsText, isBonus && styles.eventPointsTextBonus]}>+{ev.points}</Text>
                    </View>
                    <View style={styles.eventBody}>
                      <Text style={styles.eventTitle} numberOfLines={1}>{title}</Text>
                      <Text
                        style={[styles.eventKind, isBonus && styles.eventKindBonus]}
                        numberOfLines={1}
                      >
                        {emoji} {t(kindKey)}
                      </Text>
                    </View>
                  </View>
                );
              })}
              {data.events_truncated && data.event_count != null && (
                <Text style={styles.eventsMore}>
                  {t('scoreCelebration.event.andMore', {
                    count: Math.max(0, (data.event_count ?? 0) - data.events.length),
                  })}
                </Text>
              )}
            </View>
          )}

          <View style={styles.divider} />

          {/* PR38 - rank rows are tappable when onOpenLeaderboard is
              provided. Each row routes to the leaderboard pre-scoped
              to its lens; the host is responsible for acking the
              watermark before navigating. */}
          <Animated.View style={[{ opacity: row1, width: '100%' }]}>
            <Pressable
              style={({ pressed }) => [
                styles.row,
                onOpenLeaderboard && styles.rowTappable,
                pressed && onOpenLeaderboard && styles.rowPressed,
              ]}
              disabled={!onOpenLeaderboard}
              onPress={onOpenLeaderboard ? () => onOpenLeaderboard('city') : undefined}
              accessibilityRole={onOpenLeaderboard ? 'button' : undefined}
            >
              <Text style={styles.rowFlag}>{cityFlag}</Text>
              <Text style={styles.rowLabel} numberOfLines={1}>{cityRankCopy}</Text>
              {onOpenLeaderboard && (
                <Text style={styles.rowChevron} aria-hidden>›</Text>
              )}
            </Pressable>
          </Animated.View>
          <Animated.View style={[{ opacity: row2, width: '100%' }]}>
            <Pressable
              style={({ pressed }) => [
                styles.row,
                onOpenLeaderboard && styles.rowTappable,
                pressed && onOpenLeaderboard && styles.rowPressed,
              ]}
              disabled={!onOpenLeaderboard}
              onPress={onOpenLeaderboard ? () => onOpenLeaderboard('world') : undefined}
              accessibilityRole={onOpenLeaderboard ? 'button' : undefined}
            >
              <Text style={styles.rowFlag}>{worldFlag}</Text>
              <Text style={styles.rowLabel} numberOfLines={1}>{worldRankCopy}</Text>
              {onOpenLeaderboard && (
                <Text style={styles.rowChevron} aria-hidden>›</Text>
              )}
            </Pressable>
          </Animated.View>

          {/* City-in-cities row - where the user's CITY ranks among all
              cities. Only rendered when the user has a current city set;
              hidden otherwise to avoid an empty "-" line. Reuses the
              row2 driver - same fade-in beat as the world row. */}
          {data.city_id && (
            <Animated.View style={[{ opacity: row2, width: '100%' }]}>
              <View style={styles.row}>
                <Text style={styles.rowFlag}>{citiesFlag}</Text>
                <Text style={styles.rowLabel} numberOfLines={1}>{cityInCitiesCopy}</Text>
              </View>
            </Animated.View>
          )}

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
    // Warm-orange glow ring - the popin is the brand's "yay" moment, so we
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
  total: {
    marginTop: 2,
    fontSize:   FontSizes.sm,
    fontWeight: '700',
    color:      Colors.muted,
    letterSpacing: 0.2,
    textAlign:  'center',
  },
  subtitle: {
    fontSize: FontSizes.md,
    color:    Colors.muted,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  // Per-event breakdown block - sits between the subtitle and the rank
  // divider. Each row is a compact "+pts | title / kind" card so the user
  // sees exactly which challenge + step earned them what.
  events: {
    width: '100%',
    gap:   6,
    marginBottom: 12,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap: 10,
    paddingVertical:   8,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,122,60,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,122,60,0.18)',
    borderRadius: Radius.md,
  },
  eventPoints: {
    minWidth: 44,
    paddingHorizontal: 8,
    paddingVertical:   4,
    backgroundColor:   'rgba(255,122,60,0.18)',
    borderRadius:      Radius.full,
    alignItems:        'center',
  },
  eventPointsText: {
    fontSize:   FontSizes.sm,
    fontWeight: '900',
    color:      '#FF7A3C',
    letterSpacing: 0.2,
  },
  eventBody: {
    flex: 1,
    gap:  1,
  },
  eventTitle: {
    fontSize:   FontSizes.sm,
    fontWeight: '700',
    color:      Colors.text,
  },
  eventKind: {
    fontSize:   FontSizes.xs,
    fontWeight: '600',
    color:      Colors.muted,
  },
  // Meet bonus tile - amber recolor of the base event row so the
  // "+50 Meet bonus" reads as a distinct extra reward rather than
  // another base-payout step. Background/border/pill all shift.
  eventRowBonus: {
    backgroundColor: 'rgba(251,191,36,0.10)',
    borderColor:     'rgba(251,191,36,0.34)',
  },
  eventPointsBonus: {
    backgroundColor: 'rgba(251,191,36,0.22)',
  },
  eventPointsTextBonus: {
    color: '#fbbf24',
  },
  eventKindBonus: {
    color: '#fbbf24',
  },
  eventsMore: {
    fontSize:   FontSizes.xs,
    color:      Colors.muted,
    textAlign:  'center',
    marginTop:  2,
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
    borderRadius: Radius.md,
  },
  // PR38 - visual affordance for tappable rank rows.
  rowTappable: {
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    transform: [{ scale: 0.985 }],
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
  rowChevron: {
    fontSize:   18,
    lineHeight: 20,
    color:      Colors.muted,
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

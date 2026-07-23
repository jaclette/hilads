import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ChallengeType } from '@/types';
import type { InspirationExample } from '@/api/challenges';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { AvatarWithFlag } from '@/components/AvatarWithFlag';
import { countryToFlag } from '@/lib/countryFlag';

/**
 * Example challenge card for the zero-challenge inspiration block. Shows a real
 * open challenge from the most-active other city. The card BODY is tappable and
 * opens that challenge (onOpen); the bottom button instead routes to LOCAL
 * challenge creation (onCreate). International challenges show a "from -> to"
 * flag pair so the cross-city ones read clearly.
 */

const TYPE_ICONS: Record<ChallengeType, string> = {
  food:    '🍜',
  place:   '📍',
  culture: '🎭',
  help:    '🤪',
};

export function ExampleChallengeCard({
  example,
  sourceCity,
  currentCity,
  onOpen,
  onCreate,
}: {
  example:     InspirationExample;
  /** City the example is FROM - shown small, inside the attribution line. */
  sourceCity:  string;
  /** Caller's OWN city - where the create button sends them. */
  currentCity: string;
  /** Tap the card body - open the real challenge. */
  onOpen:      () => void;
  /** Tap the button - create YOUR OWN challenge locally. */
  onCreate:    () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('challenge');
  const typeIcon = TYPE_ICONS[example.challenge_type] ?? '🔥';
  const name     = example.creator_display_name || example.creator_username || '?';
  const isIntl   = example.mode === 'international';
  const fromFlag = countryToFlag(example.country ?? null);
  const toFlag   = countryToFlag(example.target_country ?? null) || '🌍';

  return (
    <View style={styles.card}>
      {/* Type badge + (international) flag pair. */}
      <View style={styles.kindRow}>
        <View style={styles.kindBadge}>
          <Text style={styles.kindBadgeText}>{t(`typeBadge.${example.challenge_type}`).toUpperCase()}</Text>
        </View>
        {isIntl && fromFlag ? (
          <View style={styles.intlPill}>
            <Text style={styles.intlPillText} numberOfLines={1}>{fromFlag} → {toFlag}</Text>
          </View>
        ) : null}
      </View>

      {/* Title + creator - tapping opens the real challenge. */}
      <TouchableOpacity activeOpacity={0.7} onPress={onOpen} accessibilityRole="button">
      <View style={styles.titleRow}>
        <Text style={styles.titleEmoji}>{typeIcon}</Text>
        <Text style={styles.title} numberOfLines={2}>{example.title}</Text>
      </View>

      {/* Creator + source city. The city name appears ONLY here, small -
          framing stays "an idea from a real local", not "go to that city". */}
      <View style={styles.byRow}>
        <AvatarWithFlag
          userId={null}
          displayName={name}
          photoUrl={example.creator_thumb_avatar_url ?? null}
          countryCode={null}
          size={24}
        />
        <Text style={styles.byText} numberOfLines={1}>
          {t('inspiration.by', { name, city: sourceCity })}
        </Text>
      </View>
      </TouchableOpacity>

      {/* Create YOUR OWN challenge locally - distinct action from opening. */}
      <TouchableOpacity
        style={styles.createBtn}
        activeOpacity={0.85}
        onPress={onCreate}
        accessibilityRole="button"
      >
        <Text style={styles.createBtnText}>{t('inspiration.createYours', { city: currentCity })}</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: c.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     c.overlay,
    padding:         Spacing.md,
    gap:             10,
    width:           '100%',
  },

  kindRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  intlPill: {
    backgroundColor:   'rgba(56,189,248,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(56,189,248,0.36)',
  },
  intlPillText: { fontSize: 10, fontWeight: '700', color: '#38bdf8', letterSpacing: 0.3 },
  kindBadge: {
    backgroundColor:   'rgba(255,122,60,0.14)',
    borderRadius:      Radius.full,
    paddingHorizontal: 7,
    paddingVertical:   1,
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.30)',
  },
  kindBadgeText: { fontSize: 9, fontWeight: '800', color: '#FF7A3C', letterSpacing: 0.5 },

  titleRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  titleEmoji: { fontSize: 20, lineHeight: 24 },
  title:      { flex: 1, fontSize: FontSizes.md, fontWeight: '700', color: c.text, lineHeight: 22, textAlign: 'left' },

  byRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  byText: { flex: 1, fontSize: 12, fontWeight: '600', color: c.muted },

  createBtn: {
    marginTop:        2,
    paddingVertical:  11,
    borderRadius:     12,
    alignItems:       'center',
    justifyContent:   'center',
    backgroundColor:  'rgba(255,122,60,0.16)',
    borderWidth:      1,
    borderColor:      'rgba(255,122,60,0.35)',
  },
  createBtnText: { color: c.accent, fontSize: 14, fontWeight: '800' },
});

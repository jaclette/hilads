import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ChallengeType } from '@/types';
import type { InspirationExample } from '@/api/challenges';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { AvatarWithFlag } from '@/components/AvatarWithFlag';

/**
 * INERT example card for the zero-challenge empty state. Looks like a real
 * challenge card (type badge, title, creator) so it reads as a genuine
 * example, but it is deliberately NOT takeable:
 *
 *   - The card body is a plain <View>, NOT a TouchableOpacity. There is no
 *     onPress, no challenge id, no route to the remote challenge's channel.
 *   - The ONLY interactive element is the bottom button, which routes the
 *     user to LOCAL challenge creation (onCreate) - never to the example's
 *     own city or channel.
 *
 * It receives only title / type / creator (see InspirationExample) - the
 * backend never sends a challenge id here, so there is structurally nothing
 * to open or accept. Saigon is a recipe book, never a destination.
 */

const TYPE_ICONS: Record<ChallengeType, string> = {
  food:    '🍜',
  place:   '📍',
  culture: '🎭',
  help:    '🤝',
};

export function ExampleChallengeCard({
  example,
  sourceCity,
  currentCity,
  onCreate,
}: {
  example:     InspirationExample;
  /** City the example is FROM - shown small, inside the attribution line. */
  sourceCity:  string;
  /** Caller's OWN city - the only place the button sends them. */
  currentCity: string;
  /** Routes to LOCAL challenge creation. */
  onCreate:    () => void;
}) {
  const { t } = useTranslation('challenge');
  const typeIcon = TYPE_ICONS[example.challenge_type] ?? '🔥';
  const name     = example.creator_display_name || example.creator_username || '?';

  return (
    <View style={styles.card}>
      {/* Type badge - same look as the real card, no status/available pill
          (those imply takeability). */}
      <View style={styles.kindRow}>
        <View style={styles.kindBadge}>
          <Text style={styles.kindBadgeText}>{t(`typeBadge.${example.challenge_type}`).toUpperCase()}</Text>
        </View>
      </View>

      {/* Title - static (no marquee; this is a quiet inspiration card). */}
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

      {/* The ONLY action: create YOUR OWN challenge locally. */}
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

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.08)',
    padding:         Spacing.md,
    gap:             10,
    width:           '100%',
  },

  kindRow: { flexDirection: 'row', alignItems: 'center' },
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
  title:      { flex: 1, fontSize: FontSizes.md, fontWeight: '700', color: Colors.text, lineHeight: 22, textAlign: 'left' },

  byRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  byText: { flex: 1, fontSize: 12, fontWeight: '600', color: Colors.muted },

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
  createBtnText: { color: Colors.accent, fontSize: 14, fontWeight: '800' },
});

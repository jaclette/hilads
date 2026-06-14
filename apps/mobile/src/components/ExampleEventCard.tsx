import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { EventInspirationExample } from '@/api/events';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { AvatarWithFlag } from '@/components/AvatarWithFlag';

/**
 * INERT example card for the zero-activity events empty state. Looks like a
 * real hangout/event row (name, type, host) so it reads as a genuine example,
 * but it is deliberately NOT joinable:
 *
 *   - The card body is a plain <View>, NOT a TouchableOpacity. No onPress,
 *     no event id, no route to the remote event/hangout channel, no RSVP /
 *     "going" counter, no time chips.
 *   - The ONLY interactive element is the bottom button, which routes the
 *     user to LOCAL creation (onCreate) - never to the example's own city.
 *
 * The backend never sends an id (kind/title/host only), so there is
 * structurally nothing to open or join. Mirrors ExampleChallengeCard. These
 * are examples of FORMAT, not live invitations - hence no date/going/RSVP.
 */
export function ExampleEventCard({
  example,
  sourceCity,
  currentCity,
  onCreate,
}: {
  example:     EventInspirationExample;
  sourceCity:  string;
  currentCity: string;
  onCreate:    () => void;
}) {
  const { t } = useTranslation('now');
  const isHangout = example.kind === 'hangout';
  const typeIcon  = isHangout ? '🗣️' : '🎉';
  const typeLabel = isHangout ? t('inspiration.hangout') : t('inspiration.event');
  const name      = example.host_name || '?';

  return (
    <View style={styles.card}>
      <View style={styles.kindRow}>
        <View style={styles.kindBadge}>
          <Text style={styles.kindBadgeText}>{typeIcon} {typeLabel.toUpperCase()}</Text>
        </View>
      </View>

      <Text style={styles.title} numberOfLines={2}>{example.title}</Text>

      {/* Host + source city. The city appears ONLY here, small - framing
          stays "an idea from a real local", not "go to that city". */}
      <View style={styles.byRow}>
        <AvatarWithFlag
          userId={null}
          displayName={name}
          photoUrl={example.host_avatar ?? null}
          countryCode={null}
          size={24}
        />
        <Text style={styles.byText} numberOfLines={1}>
          {t('inspiration.by', { name, city: sourceCity })}
        </Text>
      </View>

      {/* The ONLY action: open YOUR OWN hangout/event locally. */}
      <TouchableOpacity
        style={styles.createBtn}
        activeOpacity={0.85}
        onPress={onCreate}
        accessibilityRole="button"
      >
        <Text style={styles.createBtnText}>{t('inspiration.openYours', { city: currentCity })}</Text>
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
    backgroundColor:   'rgba(96,165,250,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 7,
    paddingVertical:   1,
    borderWidth:       1,
    borderColor:       'rgba(96,165,250,0.30)',
  },
  kindBadgeText: { fontSize: 9, fontWeight: '800', color: '#60a5fa', letterSpacing: 0.5 },

  title: { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text, lineHeight: 22, textAlign: 'left' },

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

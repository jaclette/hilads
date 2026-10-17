import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { EventInspirationExample } from '@/api/events';
import { thumbUrl } from '@/lib/imageThumb';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { Avatar, Button, Card, Chip } from '@/ui';

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
  onOpen,
  onCreate,
}: {
  example:     EventInspirationExample;
  sourceCity:  string;
  currentCity: string;
  /** Tap the card body - open the real event/hangout. */
  onOpen:      () => void;
  /** Tap the button - create YOUR OWN locally. */
  onCreate:    () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('now');
  const isHangout = example.kind === 'hangout';
  const typeLabel = isHangout ? t('inspiration.hangout') : t('inspiration.event');
  const name      = example.host_name || '?';

  return (
    <Card style={styles.card}>
      <Chip icon={isHangout ? 'flash-outline' : 'calendar-outline'} label={typeLabel} style={styles.kind} />

      {/* Title + host - tapping opens the real event/hangout. */}
      <TouchableOpacity activeOpacity={0.7} onPress={onOpen} accessibilityRole="button">
        <Text style={styles.title} numberOfLines={2}>{example.title}</Text>
        <View style={styles.byRow}>
          <Avatar uri={example.host_avatar ? thumbUrl(example.host_avatar) : null} name={name} size={24} fallback="color" />
          <Text style={styles.byText} numberOfLines={1}>
            {t('inspiration.by', { name, city: sourceCity })}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Create YOUR OWN locally - distinct action from opening. */}
      <Button variant="secondary" size="sm" label={t('inspiration.openYours', { city: currentCity })} onPress={onCreate} />
    </Card>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:   { padding: Spacing.md, gap: 10, width: '100%' },
  kind:   { alignSelf: 'flex-start' },
  title:  { fontSize: FontSizes.md, fontWeight: '800', color: c.text, lineHeight: 22 },
  byRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  byText: { flex: 1, fontSize: 12, fontWeight: '600', color: c.muted },
});

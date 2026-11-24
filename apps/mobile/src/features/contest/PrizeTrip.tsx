import { Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { mediumUrl } from '@/lib/imageThumb';
import { Space, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Avatar } from '@/ui';
import type { ContestSeason } from './contest';

/**
 * The Prize screen's "Your week in Vietnam": a sample itinerary as a vertical timeline (day chip,
 * photo, title, line), labelled as a sample (the real trip is planned with the winner). Text and
 * photos from Admin › Launch Season (Pixabay picks or own photos, credited).
 */
export function SampleItinerary({ days }: { days: NonNullable<ContestSeason['itinerary']> }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('me');
  if (!days.length) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.h2} accessibilityRole="header">{t('contest.itTitle')}</Text>
      <View style={styles.sample}>
        <Ionicons name="information-circle-outline" size={IconSize.sm} color={colors.muted} />
        <Text style={[styles.muted, { flex: 1 }]}>{t('contest.itSample')}</Text>
      </View>
      {days.map((d, i) => (
        <View key={d.day} style={styles.row}>
          <View style={styles.rail}>
            <View style={styles.dot} />
            {i < days.length - 1 && <View style={styles.line} />}
          </View>
          <View style={styles.card} accessible accessibilityLabel={`${t('contest.itDay', { n: d.day })}. ${d.title}. ${d.text}`}>
            {!!d.photo && (
              <View>
                <Image source={{ uri: mediumUrl(d.photo.url) ?? d.photo.url }} style={styles.photo} contentFit="cover" />
                {!!d.photo.credit && <Text style={styles.credit} numberOfLines={1}>© {d.photo.credit}</Text>}
              </View>
            )}
            <View style={styles.cardBody}>
              <Text style={styles.day}>{t('contest.itDay', { n: d.day })}</Text>
              <Text style={styles.title}>{d.title}</Text>
              {!!d.text && <Text style={styles.text}>{d.text}</Text>}
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

/** "A word from the founder": photo, name, role, the message (Admin › Launch Season). */
export function FounderWord({ founder }: { founder: NonNullable<ContestSeason['founder']> }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('me');
  return (
    <View style={styles.founder} accessible accessibilityLabel={`${t('contest.founderTitle')}. ${founder.name}. ${founder.message}`}>
      <Text style={styles.h2} accessibilityRole="header">{t('contest.founderTitle')}</Text>
      <Text style={styles.quote}>“{founder.message}”</Text>
      <View style={styles.sign}>
        <Avatar uri={founder.photo?.url ?? null} name={founder.name} size={52} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{founder.name}</Text>
          <Text style={styles.muted}>{founder.role || t('contest.founderRole')}</Text>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  section:  { gap: Space.sm, marginTop: Space.sm },
  h2:       { ...Type.title, color: c.text },
  muted:    { ...Type.caption, color: c.muted },
  sample:   { flexDirection: 'row', gap: Space.xs, alignItems: 'flex-start' },
  row:      { flexDirection: 'row', gap: Space.sm },
  rail:     { width: 14, alignItems: 'center', paddingTop: Space.md },
  dot:      { width: 12, height: 12, borderRadius: 6, backgroundColor: c.cta, borderWidth: 2, borderColor: c.primaryTint },
  line:     { flex: 1, width: 2, backgroundColor: c.line, marginTop: 2 },
  card:     { flex: 1, marginBottom: Space.sm, borderRadius: Radius.card, overflow: 'hidden', backgroundColor: c.bg2, borderWidth: 1, borderColor: c.line },
  photo:    { width: '100%', aspectRatio: 16 / 9 },
  credit:   { position: 'absolute', right: 6, bottom: 4, fontSize: 10, color: 'rgba(255,255,255,0.85)', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  cardBody: { padding: Space.sm, gap: 2 },
  day:      { ...Type.caption, fontWeight: '800', color: c.primaryText },
  title:    { ...Type.label, color: c.text },
  text:     { ...Type.body, color: c.text },
  founder:  { gap: Space.sm, padding: Space.md, borderRadius: Radius.card, backgroundColor: c.primaryTint, marginTop: Space.sm },
  quote:    { ...Type.body, fontSize: 16, lineHeight: 24, fontStyle: 'italic', color: c.text },
  sign:     { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  name:     { ...Type.label, color: c.text },
});

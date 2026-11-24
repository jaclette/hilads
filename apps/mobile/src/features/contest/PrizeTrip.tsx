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

/**
 * "A word from the founder": a personal note, not a promo card. The founder's own photo as a
 * slightly tilted print, the message as a plain letter, then the signature (Admin › Launch Season).
 */
export function FounderWord({ founder }: { founder: NonNullable<ContestSeason['founder']> }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('me');
  const sign = founder.role ? `${founder.name}, ${founder.role}` : t('contest.founderSign', { name: founder.name });
  return (
    <View style={styles.founder} accessible accessibilityLabel={`${t('contest.founderTitle')}. ${founder.message} ${sign}`}>
      <Text style={styles.h2} accessibilityRole="header">{t('contest.founderTitle')}</Text>
      {founder.photo
        ? <View style={styles.print}><Image source={{ uri: mediumUrl(founder.photo.url) ?? founder.photo.url }} style={styles.printPhoto} contentFit="cover" /></View>
        : null}
      <Text style={styles.letter}>{founder.message}</Text>
      <View style={styles.sign}>
        {!founder.photo && <Avatar uri={null} name={founder.name} size={40} />}
        <Text style={styles.signText}>{sign}</Text>
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
  founder:  { gap: Space.md, padding: Space.md, borderRadius: Radius.card, backgroundColor: c.bg2, borderWidth: 1, borderColor: c.line, marginTop: Space.sm },
  // A real print: white border, a thicker bottom edge, a slight tilt, a soft shadow (both themes).
  print:    { alignSelf: 'center', width: '72%', maxWidth: 300, padding: 8, paddingBottom: 26, backgroundColor: '#FFFFFF', borderRadius: 4,
              transform: [{ rotate: '-2deg' }], shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  printPhoto: { width: '100%', aspectRatio: 4 / 5, borderRadius: 2 },
  letter:   { ...Type.body, fontSize: 16, lineHeight: 25, color: c.text },
  sign:     { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  signText: { ...Type.label, fontStyle: 'italic', color: c.primaryText, flexShrink: 1 },
});

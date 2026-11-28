import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Space, Radius, Type, Border, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Avatar, CityFlag, Tappable } from '@/ui';
import { THEME_COLORS } from '@/ui/joy';
import type { Member, MemberCity, SpotlightCard } from '@/api/members';
import { WaveButton } from './WaveButton';

/** A section heading with an optional tappable aside ("this week", "See all 14"). */
export function MembersSection({ title, aside, onAside }: { title: string; aside?: string; onAside?: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      {!!aside && (onAside
        ? <Tappable onPress={onAside} hitSlop={10} accessibilityRole="button"><Text style={styles.asideLink}>{aside}</Text></Tappable>
        : <Text style={styles.aside}>{aside}</Text>)}
    </View>
  );
}

/** Here now: a row of faces with the green ring; me first (dashed ring); a 👋 badge on the others. */
export function HereNowRow({ people, meId, onOpen }: { people: Member[]; meId?: string | null; onOpen: (m: Member) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('members');
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hereRow}>
      {people.map(p => {
        const me = p.id === meId;
        return (
          <View key={p.id} style={styles.hereItem}>
            {/* The 👋 badge sits on the face's corner (inside the face's box, not the item's). */}
            <View>
              <Tappable onPress={() => onOpen(p)} accessibilityRole="button" testID="here-now-person"
                        accessibilityLabel={me ? t('you') : t('hereA11y', { name: p.displayName })}>
                <View style={[styles.ring, me && styles.ringMe]}>
                  <Avatar uri={p.photo} name={p.displayName} size={48} />
                </View>
              </Tappable>
              {!me && p.canWave && <WaveButton variant="badge" user={p} initial={p.wave} source="here_now" />}
            </View>
            <Text style={styles.hereName} numberOfLines={1}>{me ? t('you') : p.displayName}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const CARD_COLOR = {
  top_local: THEME_COLORS.sip, top_player: THEME_COLORS.sip,
  streak: THEME_COLORS.taste,
  newest: THEME_COLORS.hidden_gem, new_city: THEME_COLORS.hidden_gem,
  city_week: THEME_COLORS.get_around,
} as const;
const CARD_EMOJI = { top_local: '👑', top_player: '👑', streak: '🔥', newest: '🆕', new_city: '🆕', city_week: '🏙️' } as const;

/** A friendly hello in a city's language for the "New city" card ("Say hola!"); English otherwise. */
const HELLO: Record<string, string> = {
  ES: 'hola', MX: 'hola', AR: 'hola', CO: 'hola', CL: 'hola', PE: 'hola', FR: 'bonjour', BE: 'bonjour', VN: 'xin chào',
  DE: 'hallo', AT: 'servus', NL: 'hoi', IT: 'ciao', PT: 'olá', BR: 'oi', JP: 'こんにちは', KR: '안녕하세요', TH: 'สวัสดี',
  ID: 'halo', PH: 'kumusta', IN: 'namaste', RU: 'привет', CN: '你好', TW: '你好', TR: 'merhaba', GR: 'yassou',
};

/** The week's three cards; a card without data never shows (the server leaves it out). */
export function Spotlight({ cards, onUser, onCity }: {
  cards: SpotlightCard[];
  onUser: (u: { id: string; displayName: string }) => void;
  onCity: (c: MemberCity) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('members');
  return (
    <View style={styles.spot}>
      {cards.map((c, i) => {
        const color = CARD_COLOR[c.kind];
        const ink = { color: color.onFill };
        const title = 'user' in c ? c.user.displayName : c.city.name;
        const value =
          c.kind === 'top_local' || c.kind === 'top_player' ? t('spot.points', { count: c.value })
          : c.kind === 'streak' ? t('spot.days', { count: c.value })
          : c.kind === 'newest' ? t('spot.sayWelcome')
          : c.kind === 'city_week' ? t('spot.photos', { count: c.value })
          : t('spot.sayHello', { hello: HELLO[c.city.country ?? ''] ?? t('spot.hi') });
        const flag = 'city' in c && c.city ? c.city.country : null;
        return (
          <Tappable key={c.kind} style={[styles.card, { backgroundColor: color.fill }, i === cards.length - 1 && cards.length === 3 && styles.cardTilt]}
                    onPress={() => ('user' in c ? onUser(c.user) : onCity(c.city))} accessibilityRole="button"
                    accessibilityLabel={`${t(`spot.${c.kind}`)}: ${title}, ${value}`} testID={`spotlight-${c.kind}`}>
            <Text style={[styles.cardKind, ink]} numberOfLines={1}>{t(`spot.${c.kind}`)}</Text>
            <View style={styles.cardMid}>
              {'user' in c ? <Avatar uri={c.user.photo} name={c.user.displayName} size={28} /> : <Text style={styles.cardEmoji}>{CARD_EMOJI[c.kind]}</Text>}
            </View>
            <Text style={[styles.cardTitle, ink]} numberOfLines={1}>{title}</Text>
            <View style={styles.cardValueLine}>
              {flag ? <CityFlag country={flag} size={12} /> : null}
              <Text style={[styles.cardValue, ink]} numberOfLines={1}>{value}</Text>
            </View>
            {'user' in c && <Text style={styles.cardCorner} importantForAccessibility="no">{CARD_EMOJI[c.kind]}</Text>}
          </Tappable>
        );
      })}
    </View>
  );
}

/** The World's cities: "All 412", then a chip per city with its members; tap to filter. */
export function CityStrip({ total, cities, selected, onSelect }: {
  total: number;
  cities: (MemberCity & { members: number })[];
  selected: number | null;
  onSelect: (id: number | null) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('members');
  const chip = (key: string, on: boolean, icon: React.ReactNode, name: string, count: number, press: () => void) => (
    <Tappable key={key} style={[styles.city, on && styles.cityOn]} onPress={press} accessibilityRole="button" accessibilityState={{ selected: on }}
              accessibilityLabel={t('cityA11y', { city: name, count })}>
      {icon}
      <Text style={[styles.cityName, on && { color: colors.onSelected }]} numberOfLines={1}>{name}</Text>
      <Text style={[styles.cityCount, on && { color: colors.onSelected }]}>{count}</Text>
    </Tappable>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cities}>
      {chip('all', selected === null, <Text style={styles.globe}>🌍</Text>, t('allCities'), total, () => onSelect(null))}
      {cities.slice(0, 20).map(c => chip(String(c.id), selected === c.id, <CityFlag country={c.country} size={18} />, c.name, c.members, () => onSelect(c.id)))}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  section:      { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: Space.lg, marginBottom: Space.sm },
  sectionTitle: { ...Type.caption, fontWeight: '800', color: c.muted },
  aside:        { ...Type.caption, color: c.primaryText },
  asideLink:    { ...Type.caption, fontWeight: '800', color: c.primaryText },
  hereRow:      { gap: Space.md, paddingRight: Space.lg },
  hereItem:     { width: 60, alignItems: 'center', gap: Space.xs },
  ring:         { padding: 2, borderRadius: 30, borderWidth: 2.5, borderColor: c.green },
  ringMe:       { borderStyle: 'dashed', borderColor: c.primary },
  hereName:     { ...Type.caption, fontSize: 12, color: c.text, maxWidth: 60 },
  spot:         { flexDirection: 'row', gap: Space.sm },
  card:         { flex: 1, minWidth: 0, maxWidth: '32%', minHeight: 112, borderRadius: Radius.card, padding: Space.md, gap: Space.xxs, overflow: 'hidden' },
  cardTilt:     { transform: [{ rotate: '1.5deg' }] },
  cardKind:     { fontSize: 11, lineHeight: 14, fontWeight: '800', opacity: 0.85 },
  cardMid:      { marginTop: Space.xs, marginBottom: Space.xxs, height: 28, justifyContent: 'center' },
  cardEmoji:    { fontSize: 22, lineHeight: 28 },
  cardTitle:    { ...Type.caption, fontSize: 14, fontWeight: '800' },
  cardValueLine: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  cardValue:    { fontSize: 12, lineHeight: 16, fontWeight: '700', flexShrink: 1 },
  cardCorner:   { position: 'absolute', right: Space.sm, top: Space.sm, fontSize: 18 },
  cities:       { gap: Space.sm, paddingRight: Space.lg },
  city:         { minWidth: 64, alignItems: 'center', gap: Space.xxs, paddingVertical: Space.sm, paddingHorizontal: Space.md,
                  borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  cityOn:       { backgroundColor: c.selected, borderColor: c.selected },
  globe:        { fontSize: 17, lineHeight: 22 },
  cityName:     { ...Type.caption, fontWeight: '800', color: c.text, maxWidth: 96 },
  cityCount:    { ...Type.caption, fontSize: 12, color: c.muted },
});

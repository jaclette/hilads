import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Space, Type, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Card } from '@/ui';
import { RankMedal } from '@/features/daily/RankMedal';

/**
 * How points are counted, in two cards (docs/mockups/hilads_rules_points_mockup.html), shared by the
 * Trip's Rules and "How Hilads works" so both tell the same story: the main card "Play and win" (play,
 * the podium with its three medal lines, …), a "+ BONUS" divider, then the bonus card "Bring your
 * friends": a tilted soft-yellow card with a BONUS tag, its lines and an "Invite friends" button.
 * The bonus card keeps its printed colors in every theme (a sticker); the main card is the theme's.
 */
export type PointsLine = { emoji: string; title: string; sub?: string | null; value?: string | null; onPress?: () => void; testID?: string };
export type PodiumPlace = { rank: number; label: string; value: string };

const INK = '#2B1A12';
const TERRA = '#C24E1C';

export function PlayCard({ emoji, title, sub, lines, podium, podiumAfter }: {
  emoji: string; title: string; sub: string; lines: PointsLine[]; podium: PodiumPlace[]; podiumAfter: number;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headIcon}><Text style={styles.headEmoji}>{emoji}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headTitle} accessibilityRole="header">{title}</Text>
          <Text style={styles.headSub}>{sub}</Text>
        </View>
      </View>
      {lines.map((l, i) => (
        <View key={l.title}>
          <Line line={l} />
          {i === podiumAfter && (
            <View style={styles.podium}>
              {podium.map((p, j) => (
                <View key={p.rank} style={[styles.place, j > 0 && styles.placeLine]} accessible accessibilityLabel={`${p.label}: ${p.value}`}>
                  <RankMedal rank={p.rank} podium size={26} />
                  <Text style={styles.placeLabel} numberOfLines={1}>{p.label}</Text>
                  <Text style={styles.pts}>{p.value}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
    </Card>
  );
}

function Line({ line: l, bonus }: { line: PointsLine; bonus?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const body = (
    <>
      <View style={[styles.lineEmoji, bonus && styles.bonusBubble]}><Text style={styles.lineEmojiText}>{l.emoji}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.lineTitle, bonus && { color: INK }]}>{l.title}</Text>
        {!!l.sub && <Text style={[styles.lineSub, bonus && styles.bonusMuted]}>{l.sub}</Text>}
      </View>
      {!!l.value && <Text style={[styles.pts, bonus && styles.bonusPts]}>{l.value}</Text>}
      {!!l.onPress && <Ionicons name="chevron-forward" size={16} color={bonus ? INK : colors.muted} />}
    </>
  );
  const a11y = [l.title, l.sub, l.value].filter(Boolean).join('. ');
  return l.onPress ? (
    <Pressable onPress={l.onPress} style={({ pressed }) => [styles.line, bonus && styles.bonusLine, pressed && { opacity: 0.6 }]}
               accessibilityRole="button" accessibilityLabel={a11y} testID={l.testID}>{body}</Pressable>
  ) : (
    <View style={[styles.line, bonus && styles.bonusLine]} accessible accessibilityLabel={a11y}>{body}</View>
  );
}

/** "+ BONUS" between the two cards. */
export function BonusDivider({ label }: { label: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Dashes />
      <Text style={styles.dividerText}>{label}</Text>
      <Dashes />
    </View>
  );
}

/** A dashed line (iOS draws no dashed border on one side only): small dashes, clipped to the space. */
function Dashes() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.dashes}>
      {Array.from({ length: 24 }).map((_, i) => <View key={i} style={styles.dash} />)}
    </View>
  );
}

export function BonusCard({ tag, emoji, title, sub, lines, cta, onCta, ctaTestID }: {
  tag: string; emoji: string; title: string; sub: string; lines: PointsLine[]; cta: string; onCta: () => void; ctaTestID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.bonusOuter}>
      <LinearGradient colors={['#FFE48A', '#FFC93C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.bonus}>
        <View style={styles.head}>
          <View style={[styles.headIcon, styles.bonusBubble]}><Text style={styles.headEmoji}>{emoji}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headTitle, { color: INK }]} accessibilityRole="header">{title}</Text>
            <Text style={[styles.headSub, styles.bonusMuted]}>{sub}</Text>
          </View>
        </View>
        {lines.map(l => <Line key={l.title} line={l} bonus />)}
        <Pressable onPress={onCta} style={({ pressed }) => [styles.bonusBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button" testID={ctaTestID}>
          <Text style={styles.bonusBtnText}>{cta}</Text>
        </Pressable>
      </LinearGradient>
      <Text style={styles.tag}>{tag}</Text>
    </View>
  );
}

/** The short notes under the cards, one line each with its emoji. */
export function PointsNotes({ lines }: { lines: { emoji: string; text: string }[] }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.notes}>
      {lines.map(l => (
        <View key={l.text} style={styles.note}>
          <Text style={styles.noteEmoji} accessibilityElementsHidden>{l.emoji}</Text>
          <Text style={styles.noteText}>{l.text}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:       { padding: Space.md, gap: 0 },
  head:       { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: Space.sm },
  headIcon:   { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primaryTint },
  headEmoji:  { fontSize: 20, lineHeight: 26 },
  headTitle:  { ...Type.label, fontSize: 17, color: c.text },
  headSub:    { ...Type.caption, color: c.muted },
  line:       { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm, borderTopWidth: 1, borderTopColor: c.line, minHeight: 48 },
  lineEmoji:  { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg3 },
  lineEmojiText: { fontSize: 15, lineHeight: 20 },
  lineTitle:  { ...Type.label, fontSize: 15, color: c.text },
  lineSub:    { ...Type.caption, color: c.muted },
  pts:        { ...Type.label, fontSize: 14, color: c.primaryOnTint, backgroundColor: c.primaryTint, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4,
                overflow: 'hidden', fontVariant: ['tabular-nums'] },
  podium:     { marginLeft: 32 + Space.sm, marginBottom: Space.xs, paddingHorizontal: Space.sm, borderRadius: 14, backgroundColor: c.bg3 },
  place:      { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: 6, minHeight: 40 },
  placeLine:  { borderTopWidth: 1, borderTopColor: c.line },
  placeLabel: { flex: 1, ...Type.label, fontSize: 14, color: c.text },
  divider:    { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginVertical: Space.xs, paddingHorizontal: '8%' },
  dashes:     { flex: 1, flexDirection: 'row', gap: 4, overflow: 'hidden', height: 2 },
  dash:       { width: 6, height: 2, borderRadius: 1, backgroundColor: c.line },
  dividerText:{ ...Type.caption, fontSize: 12, fontWeight: '900', letterSpacing: 0.6, color: c.muted },
  bonusOuter: { transform: [{ rotate: '-0.8deg' }], marginTop: 6, borderRadius: 20, backgroundColor: '#D9A10F', paddingBottom: 6 },
  bonus:      { borderRadius: 20, padding: Space.md },
  bonusBubble:{ backgroundColor: 'rgba(255,255,255,0.7)' },
  bonusLine:  { borderTopColor: 'rgba(120,80,0,0.2)' },
  bonusMuted: { color: '#6B4A00' },
  bonusPts:   { backgroundColor: '#FFFFFF', color: TERRA },
  bonusBtn:   { marginTop: Space.sm, backgroundColor: INK, borderRadius: 15, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  bonusBtnText: { ...Type.label, fontSize: 15, color: '#FFFFFF' },
  tag:        { position: 'absolute', top: -10, right: 14, backgroundColor: TERRA, color: '#FFFFFF', fontSize: 10, lineHeight: 13, fontWeight: '900', letterSpacing: 1,
                borderRadius: 9, paddingHorizontal: 9, paddingVertical: 4, overflow: 'hidden', transform: [{ rotate: '4deg' }] },
  notes:      { gap: 6, marginTop: Space.xs },
  note:       { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  noteEmoji:  { fontSize: 13, lineHeight: 18 },
  noteText:   { ...Type.caption, fontWeight: '700', color: c.muted, flex: 1 },
});

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, Text, View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/context/ThemeContext';
import { contestDate } from './contest';

/**
 * The Launch Trip boarding pass (docs/mockups/hilads_boarding_pass_mockup.html): a yellow ticket,
 * slightly tilted, notches and a dashed tear line before the stub, "HILADS AIR · BOARDING PASS",
 * the route (my city ✈️ the campaign's destination, Admin › Launch Season › Prize), the passenger,
 * the boarding date, then the price (a guest) or my photos (with a players' goal), and the seat on
 * the stub with a barcode. The seat is honest: a guest's is the next free one (players in the race + 1),
 * mine is my place in the order players joined. The plane drifts (not with reduce motion); once my
 * pass is earned a "Boarded" stamp lands on it, animated the first time I see it.
 * Fixed colors: a printed ticket looks the same in every theme (the notches take the page's color).
 */
const INK = '#2B1A12';
const STAMP = '#B3261E';

export type TicketProps = {
  seasonId: number;
  from: string | null;          // my city's name, else "Your city"
  destination: string;
  startDate: string;
  seat: number;
  passenger: string | null;     // "@handle", null = a guest ("You? 👀")
  photos?: { n: number; of: number } | null;   // my boarding pass progress (with a goal)
  earned?: boolean;
  onPress: () => void;
  testID?: string;
};

export function BoardingTicket({ seasonId, from, destination, startDate, seat, passenger, photos, earned, onPress, testID }: TicketProps) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('me');
  const [still, setStill] = useState(false);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {}); }, []);

  // The little plane drifts back and forth.
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) { drift.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [still, drift]);
  const planeX = drift.interpolate({ inputRange: [0, 1], outputRange: [-3, 5] });

  // The "Boarded" stamp: lands once (per campaign) when the pass is earned, then just stays.
  const stamp = useRef(new Animated.Value(earned ? 1 : 0)).current;
  useEffect(() => {
    if (!earned) return;
    const key = `trip_stamp_seen_${seasonId}`;
    AsyncStorage.getItem(key).then(seen => {
      if (seen || still) { stamp.setValue(1); if (!seen) AsyncStorage.setItem(key, '1').catch(() => {}); return; }
      stamp.setValue(0);
      Animated.spring(stamp, { toValue: 1, friction: 5, tension: 90, delay: 450, useNativeDriver: true }).start();
      AsyncStorage.setItem(key, '1').catch(() => {});
    }).catch(() => stamp.setValue(1));
  }, [earned, seasonId, still, stamp]);
  const stampScale = stamp.interpolate({ inputRange: [0, 1], outputRange: [2.2, 1] });

  const date = contestDate(startDate, i18n.language);
  const who = passenger ?? t('trip.ticket.you');
  const third = photos ? { label: t('trip.ticket.photos'), value: `${Math.min(photos.n, photos.of)} / ${photos.of}` }
    : { label: t('trip.ticket.price'), value: t('trip.ticket.free') };
  const route = `${from ?? t('trip.ticket.yourCity')} ✈ ${destination}`;
  const a11y = passenger
    ? t('trip.ticket.a11yMember', { route, seat, date, value: `${third.label} ${third.value}` }) + (earned ? `. ${t('trip.ticket.stamp')}` : '')
    : t('trip.ticket.a11yGuest', { route, seat, date });

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} testID={testID}
               style={({ pressed }) => [styles.outer, pressed && { transform: [{ rotate: '-1.5deg' }, { scale: 0.985 }] }]}>
      <View style={styles.shadow}>
        <LinearGradient colors={['#FFD55A', '#FFB52E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.ticket}>
          <View style={styles.main}>
            <Text style={styles.kick} numberOfLines={1} maxFontSizeMultiplier={1.2}>{t('trip.ticket.kicker')}</Text>
            <View style={styles.route}>
              <Text style={styles.city} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} maxFontSizeMultiplier={1.2}>
                {(from ?? t('trip.ticket.yourCity')).toLocaleUpperCase(i18n.language)}
              </Text>
              <Animated.Text style={[styles.plane, { transform: [{ translateX: planeX }] }]} accessibilityElementsHidden>✈️</Animated.Text>
              <Text style={styles.city} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} maxFontSizeMultiplier={1.2}>
                {destination.toLocaleUpperCase(i18n.language)}
              </Text>
            </View>
            <View style={styles.fields}>
              <Field label={t('trip.ticket.passenger')} value={who} grow />
              <Field label={t('trip.ticket.boarding')} value={date} />
              <Field label={third.label} value={third.value} />
            </View>
            {earned && (
              <Animated.View pointerEvents="none" style={[styles.stamp, { opacity: stamp, transform: [{ rotate: '-12deg' }, { scale: stampScale }] }]}>
                <Text style={styles.stampText} numberOfLines={1}>{t('trip.ticket.stamp')} ✓</Text>
              </Animated.View>
            )}
          </View>
          <View style={styles.stub}>
            <Text style={styles.small} maxFontSizeMultiplier={1.2}>{t('trip.ticket.seat')}</Text>
            <Text style={styles.seat} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>{seat}</Text>
            <Barcode seed={seat} />
          </View>
          {/* The notches at the tear line, in the page's color (clipped by the ticket: half circles). */}
          <View style={[styles.notch, { top: -11, backgroundColor: colors.bg }]} />
          <View style={[styles.notch, { bottom: -11, backgroundColor: colors.bg }]} />
        </LinearGradient>
      </View>
    </Pressable>
  );
}

function Field({ label, value, grow }: { label: string; value: string; grow?: boolean }) {
  return (
    <View style={grow ? { flexShrink: 1, minWidth: 0 } : undefined}>
      <Text style={styles.small} numberOfLines={1} maxFontSizeMultiplier={1.2}>{label}</Text>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={1.2}>{value}</Text>
    </View>
  );
}

/** A barcode-like pattern, the same for the same seat. */
function Barcode({ seed }: { seed: number }) {
  const bars: number[] = [];
  let x = (seed * 9301 + 49297) % 233280;
  for (let i = 0; i < 18; i++) { x = (x * 9301 + 49297) % 233280; bars.push(1 + (x % 3)); }
  return (
    <View style={styles.bars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {bars.map((w, i) => <View key={i} style={{ width: w, height: '100%', backgroundColor: i % 2 ? 'transparent' : INK }} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  outer:  { transform: [{ rotate: '-1.5deg' }], marginVertical: 6 },
  shadow: { borderRadius: 20, backgroundColor: '#D9930F', paddingBottom: 6,
            shadowColor: '#783C00', shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  ticket: { flexDirection: 'row', borderRadius: 20, overflow: 'hidden', minHeight: 112 },
  main:   { flex: 68, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, gap: 4 },
  stub:   { flex: 32, borderLeftWidth: 2.5, borderStyle: 'dashed', borderLeftColor: 'rgba(60,30,0,0.35)', alignItems: 'center', justifyContent: 'center',
            gap: 4, paddingHorizontal: 8, paddingVertical: 10 },
  kick:   { fontSize: 10, lineHeight: 13, fontWeight: '900', letterSpacing: 1.3, color: INK, opacity: 0.75 },
  route:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  city:   { flexShrink: 1, fontSize: 21, lineHeight: 26, fontWeight: '900', color: INK },
  plane:  { fontSize: 16, lineHeight: 22 },
  fields: { flexDirection: 'row', gap: 14, marginTop: 2 },
  small:  { fontSize: 9.5, lineHeight: 12, fontWeight: '900', letterSpacing: 0.6, color: INK, opacity: 0.75, textTransform: 'uppercase' },
  value:  { fontSize: 13.5, lineHeight: 17, fontWeight: '800', color: INK, fontVariant: ['tabular-nums'] },
  seat:   { fontSize: 28, lineHeight: 32, fontWeight: '900', color: INK, fontVariant: ['tabular-nums'] },
  bars:   { flexDirection: 'row', height: 22, width: '72%', justifyContent: 'center', overflow: 'hidden' },
  notch:  { position: 'absolute', left: '68%', marginLeft: -11, width: 22, height: 22, borderRadius: 11 },
  stamp:  { position: 'absolute', right: 6, bottom: 8, borderWidth: 2.5, borderColor: STAMP, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
            backgroundColor: 'rgba(255,255,255,0.18)' },
  stampText: { fontSize: 14, lineHeight: 18, fontWeight: '900', letterSpacing: 1, color: STAMP, textTransform: 'uppercase' },
});

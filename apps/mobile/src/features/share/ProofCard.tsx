import { forwardRef, useEffect, useRef } from 'react';
import { PixelRatio, Text, View, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { appFont } from '@/scaling';
import { mediumUrl, thumbUrl } from '@/lib/imageThumb';
import { localizeCityName, shortCityName } from '@/i18n/cityName';
import { FLAGS } from '@/ui/flags';
import { ThemeIcon } from '@/ui/ThemeIcon';
import { INK } from '@/ui/joy';
import { EventFrame } from '@/features/event/EventFrame';
import type { ShareContent } from './content';
import type { ViewInstance } from 'react-native';

/**
 * My photo's share cards (docs/mockups/hilads_success_share_mockup.html): the photo IS the card.
 * Full-bleed (cover), a soft gradient only at the top and the bottom for the text, the selfie inset
 * of a dual photo. Top: the theme chip and the city. The challenge as a question to whoever looks,
 * on a tilted yellow sticker (the admin's share question, else the compare question, else built
 * from the title; 3 lines at most, shrinking to fit). My answer (or caption) big, then "@me played
 * for Saigon". At the bottom the "your turn" bar: a dashed "?" slot, "Your city?", the time left to
 * answer (or "New challenge every day" once closed) and hilads.live.
 *   turn    that card
 *   versus  the same, with the other cities' photos of the day as tiles over the photo
 *   result  the same, with my rank / likes on the photo (the day after)
 * story = 1080 × 1920 (nothing that matters in the Stories' top 250 px and bottom 340 px),
 * post = 1080 × 1350. Fixed colors (an image, the same in every theme). Every text line shrinks to
 * fit rather than being cut (19 languages). Plain style objects: the narrow-phone scaling must not
 * touch a fixed-size image. `onReady` once the photos are drawn (or after a timeout); `still` stops
 * the "?" wiggle (SharePanel sets it while capturing).
 */

export type ShareTemplate = 'turn' | 'versus' | 'result';
export type ShareFormat = 'story' | 'post';
export type VersusPhoto = { id: string; photoUrl: string; city: string | null; country: string | null };
type ProofContent = Extract<ShareContent, { type: 'proof' }>;

const W = 1080 / PixelRatio.get();
const u = (n: number) => (n * W) / 360;   // designed on a 360-wide canvas
export const PROOF_CARD_DP = { story: { width: W, height: u(640) }, post: { width: W, height: u(450) } };
const READY_TIMEOUT_MS = 6000;
const WHITE = '#FFFFFF';
const YELLOW = '#FFC93C';
const YELLOW_EDGE = '#C9940F';
const TERRA = '#C24E1C';
const ORANGE = '#F2783A';
const MUTED = '#8A6E5C';

/** "9h", "45 min": the time left to answer, from the challenge's close (unix s). */
function leftLabel(endsAt: number | null | undefined, t: (k: string, o?: Record<string, unknown>) => string): string | null {
  if (!endsAt) return null;
  const s = endsAt - Date.now() / 1000;
  if (s <= 0) return null;
  const h = Math.floor(s / 3600);
  return h >= 1 ? t('share.card.leftHours', { count: h }) : t('share.card.leftMinutes', { count: Math.max(1, Math.floor(s / 60)) });
}

export const ProofCard = forwardRef<ViewInstance, {
  content: ProofContent; template: ShareTemplate; format: ShareFormat; others?: VersusPhoto[]; still?: boolean; onReady: () => void;
}>(function ProofCard({ content, template, format, others = [], still = false, onReady }, ref) {
  const { t } = useTranslation('daily');
  const story = format === 'story';
  const k = story ? 1 : 0.84;
  const size = PROOF_CARD_DP[format];

  // Ready once the photo, the selfie and the versus photos are drawn.
  const shownOthers = template === 'versus' ? others.slice(0, 3) : [];
  const expected = 1 + (content.selfieUrl ? 1 : 0) + shownOthers.length;
  const loaded = useRef(0);
  const done = useRef(false);
  const ready = () => {
    if (done.current) return;
    done.current = true;
    requestAnimationFrame(() => setTimeout(onReady, 120));
  };
  const loadedOne = () => { loaded.current += 1; if (loaded.current >= expected) ready(); };
  useEffect(() => {
    const timer = setTimeout(ready, READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const city = content.city?.name ? shortCityName(content.city.name) : null;
  const flag = content.city?.country ? FLAGS[content.city.country.toUpperCase()] : undefined;
  const question = content.shareQuestion || content.question || t('share.card.questionFrom', { title: content.text });
  const big = content.answer || content.caption || null;
  const who = content.username && city ? t('share.card.playedFor', { user: content.username, city })
    : content.username ? `@${content.username}` : city ?? '';
  const left = leftLabel(content.endsAt, t);

  // Stories keep their top and bottom margins clear; the post is tighter.
  const top = story ? u(86) : u(18);
  const bottom = story ? u(118) : u(16);

  const rank = template === 'result'
    ? (content.rankText ? content.rankText : content.rank
      ? (content.rank.city ? t('share.rankCity', { rank: content.rank.rank, city: localizeCityName(content.rank.city) }) : t('share.rankWorld', { rank: content.rank.rank }))
      : null)
    : null;
  const votes = template === 'result' && content.voteCount ? t('share.card.votes', { count: content.voteCount }) : null;

  return (
    <View ref={ref} collapsable={false} style={[s.card, { width: size.width, height: size.height }]}>
      {/* The photo, full-bleed, never darkened in the middle. */}
      <Image source={{ uri: mediumUrl(content.photoUrl) ?? content.photoUrl }} style={[s.abs, { width: size.width, height: size.height }]}
             contentFit="cover" contentPosition={{ top: '38%', left: '50%' }} onLoad={loadedOne} onError={loadedOne} />
      <LinearGradient colors={['rgba(0,0,0,0.42)', 'rgba(0,0,0,0)']} style={[s.abs, { width: size.width, height: size.height * 0.3 }]} />
      <LinearGradient colors={['rgba(20,8,4,0)', 'rgba(20,8,4,0.55)', 'rgba(20,8,4,0.88)']} locations={[0, 0.45, 1]}
                      style={[s.abs, { top: size.height * 0.46, width: size.width, height: size.height * 0.54 }]} />
      {!!content.eventKey && <EventFrame eventKey={content.eventKey} width={size.width} height={size.height} />}

      {/* Top: the theme (left), the city (right). */}
      <View style={[s.topRow, { top, left: u(18), right: u(18) }]}>
        {!!content.themeLabel && (
          <View style={[s.chip, s.chipLight, { paddingHorizontal: u(11) * k, height: u(28) * k }]}>
            <ThemeIcon theme={content.theme} size={u(15) * k} color={INK} />
            <Text style={[s.chipText, { color: INK, fontSize: u(12.5) * k }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{content.themeLabel}</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        {!!city && (
          <View style={[s.chip, s.chipDark, { paddingHorizontal: u(11) * k, height: u(28) * k }]}>
            {flag !== undefined && <Image source={flag} style={[s.flag, { width: u(17) * k, height: u(12) * k }]} contentFit="cover" />}
            <Text style={[s.chipText, { color: WHITE, fontSize: u(12.5) * k }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{city}</Text>
          </View>
        )}
      </View>

      {/* The question to whoever looks: a tilted yellow sticker, 3 lines at most, shrinking to fit. */}
      <View style={[s.sticker, { top: top + u(40) * k, left: u(20), maxWidth: size.width * 0.8, padding: u(11) * k, borderRadius: u(14) * k }]}>
        <Text style={[s.question, { fontSize: u(story ? 25 : 21), lineHeight: u(story ? 28 : 24) }]} numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.55}>
          {question}
        </Text>
      </View>

      {/* The selfie of a dual photo, a little framed inset. */}
      {!!content.selfieUrl && (
        <Image source={{ uri: thumbUrl(content.selfieUrl) ?? content.selfieUrl }} contentFit="cover" onLoad={loadedOne} onError={loadedOne}
               style={[s.selfie, { right: u(20), top: top + u(story ? 150 : 104) * k, width: size.width * 0.24, height: size.width * 0.32, borderRadius: u(12) }]} />
      )}

      {/* Bottom: the other cities (Versus), my rank (Result), my answer, who played, then the "your turn" bar. */}
      <View style={[s.bottom, { left: u(20), right: u(20), bottom }]}>
        {shownOthers.length > 0 && (
          <View style={[s.versus, { marginBottom: u(10) * k, gap: u(7) * k }]}>
            <View style={[s.vs, { width: u(34) * k, height: u(34) * k, borderRadius: u(17) * k }]}>
              <Text style={[s.vsText, { fontSize: u(12) * k }]}>{t('share.card.vs')}</Text>
            </View>
            {shownOthers.map(o => (
              <View key={o.id} style={[s.tile, { width: u(58) * k, height: u(72) * k, borderRadius: u(10) * k }]}>
                <Image source={{ uri: thumbUrl(o.photoUrl) ?? o.photoUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" onLoad={loadedOne} onError={loadedOne} />
                {!!o.city && (
                  <View style={s.tileLabel}>
                    {!!o.country && FLAGS[o.country.toUpperCase()] !== undefined && <Image source={FLAGS[o.country.toUpperCase()]} style={{ width: u(11) * k, height: u(8) * k, borderRadius: 2 }} contentFit="cover" />}
                    <Text style={[s.tileText, { fontSize: u(9) * k }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{shortCityName(o.city)}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
        {(!!rank || !!votes) && (
          <View style={[s.pills, { marginBottom: u(8) * k, gap: u(6) }]}>
            {!!rank && <Text style={[s.pill, s.gold, { fontSize: u(13) * k }]} numberOfLines={1} adjustsFontSizeToFit>{`🏆 ${rank}`}</Text>}
            {!!votes && <Text style={[s.pill, { fontSize: u(13) * k }]} numberOfLines={1}>{`❤️ ${votes}`}</Text>}
          </View>
        )}
        {!!big && (
          // Versus carries the cities' tiles too: two lines at most, so nothing reaches the question.
          <Text style={[s.big, { fontSize: u(story ? 36 : 28), lineHeight: u(story ? 38 : 30) }]} numberOfLines={shownOthers.length > 0 ? 2 : 3}
                adjustsFontSizeToFit minimumFontScale={0.5}>{big}</Text>
        )}
        {!!who && <Text style={[s.who, { fontSize: u(14) * k, marginTop: u(4) }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{who}</Text>}

        <View style={[s.turn, { marginTop: u(story ? 16 : 10) * k, padding: u(9) * k, borderRadius: u(16) * k, gap: u(10) * k }]}>
          <Slot size={u(38) * k} still={still} />
          <View style={{ flex: 1 }}>
            <Text style={[s.turnTitle, { fontSize: u(16) * k, lineHeight: u(19) * k }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{t('share.card.yourCity')}</Text>
            <Text style={[s.turnSub, { fontSize: u(11.5) * k, lineHeight: u(15) * k }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
              {left ? t('share.card.leftToAnswer', { time: left }) : t('share.card.everyDay')}
            </Text>
          </View>
          <View style={[s.site, { borderRadius: u(12) * k, paddingHorizontal: u(10) * k, paddingVertical: u(7) * k }]}>
            <Text style={[s.siteText, { fontSize: u(12) * k }]} numberOfLines={1}>hilads.live</Text>
          </View>
        </View>
      </View>
    </View>
  );
});

/** The friend's empty slot: a dashed, tilted polaroid with a "?" that wiggles (still while captured). */
function Slot({ size, still }: { size: number; still: boolean }) {
  const reduced = useReducedMotion();
  const r = useSharedValue(0);
  useEffect(() => {
    if (still || reduced) { cancelAnimation(r); r.value = 0; return; }
    r.value = withRepeat(withSequence(
      withTiming(-10, { duration: 160, easing: Easing.out(Easing.quad) }),
      withTiming(10, { duration: 320, easing: Easing.inOut(Easing.quad) }),
      withTiming(0, { duration: 160 }),
      withTiming(0, { duration: 1400 }),
    ), -1);
  }, [still, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  const wiggle = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return (
    <View style={[s.slot, { width: size * 0.84, height: size, borderRadius: size * 0.14, borderWidth: Math.max(1.5, size * 0.05) }]}>
      <Animated.Text style={[s.slotMark, { fontSize: size * 0.5, lineHeight: size * 0.6 }, wiggle]}>?</Animated.Text>
    </View>
  );
}

const s = {
  card:      { overflow: 'hidden', backgroundColor: '#2A1C13' },
  abs:       { position: 'absolute', top: 0, left: 0 },
  topRow:    { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: u(8) },
  chip:      { flexDirection: 'row', alignItems: 'center', gap: u(5), borderRadius: u(999), maxWidth: '62%' },
  chipLight: { backgroundColor: WHITE },
  chipDark:  { backgroundColor: 'rgba(0,0,0,0.45)' },
  chipText:  { fontFamily: appFont('800'), flexShrink: 1 },
  flag:      { borderRadius: u(2) },
  sticker:   { position: 'absolute', backgroundColor: YELLOW, transform: [{ rotate: '-3deg' }],
               shadowColor: YELLOW_EDGE, shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: u(4) }, elevation: 4 },
  question:  { fontFamily: appFont('800'), color: INK, letterSpacing: u(-0.3) },
  selfie:    { position: 'absolute', borderWidth: u(3), borderColor: WHITE },
  bottom:    { position: 'absolute' },
  versus:    { flexDirection: 'row', alignItems: 'center' },
  vs:        { backgroundColor: INK, alignItems: 'center', justifyContent: 'center', borderWidth: u(2), borderColor: WHITE },
  vsText:    { fontFamily: appFont('800'), color: WHITE },
  tile:      { overflow: 'hidden', borderWidth: u(2.5), borderColor: WHITE, backgroundColor: '#3A2A20' },
  tileLabel: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: u(3),
               backgroundColor: 'rgba(0,0,0,0.55)', paddingVertical: u(2), paddingHorizontal: u(3) },
  tileText:  { fontFamily: appFont('800'), color: WHITE, flexShrink: 1 },
  pills:     { flexDirection: 'row', flexWrap: 'wrap' },
  pill:      { fontFamily: appFont('800'), color: INK, backgroundColor: WHITE, borderRadius: u(999), paddingHorizontal: u(11), paddingVertical: u(5), overflow: 'hidden' },
  gold:      { backgroundColor: '#FFD66B' },
  big:       { fontFamily: appFont('800'), color: WHITE, letterSpacing: u(-0.6), textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: u(8), textShadowOffset: { width: 0, height: u(2) } },
  who:       { fontFamily: appFont('700'), color: WHITE, opacity: 0.92 },
  turn:      { flexDirection: 'row', alignItems: 'center', backgroundColor: WHITE },
  slot:      { borderStyle: 'dashed', borderColor: ORANGE, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-5deg' }] },
  slotMark:  { fontFamily: appFont('800'), color: ORANGE, textAlign: 'center' },
  turnTitle: { fontFamily: appFont('800'), color: INK },
  turnSub:   { fontFamily: appFont('700'), color: MUTED },
  site:      { backgroundColor: TERRA },
  siteText:  { fontFamily: appFont('800'), color: WHITE },
} satisfies Record<string, ViewStyle | TextStyle | ImageStyle>;

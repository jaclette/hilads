import { forwardRef, useEffect, useRef } from 'react';
import { PixelRatio, Text, View, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { appFont } from '@/scaling';
import { localizeCityName, shortCityName } from '@/i18n/cityName';
import { FLAGS } from '@/ui/flags';
import { INK, themeColor } from '@/ui/joy';
import { EVENT_CARD, EventFrame } from '@/features/event/EventFrame';
import type { ShareContent } from './content';

const LOGO = require('../../../assets/logo/hilads-icon.svg'); // eslint-disable-line @typescript-eslint/no-require-imports

/**
 * My photo's share cards (share card redo, docs/share-card-audit.md): three
 * templates, each in two formats, laid out at full size (1080 px wide) on this
 * screen and captured as is by SharePanel.
 *   turn    "Your turn": my polaroid next to an empty dashed one with a big "?"
 *   versus  my photo against other cities' photos of the same challenge
 *   result  my photo big, its rank or votes and my answer
 * story = 1080 × 1920 (Stories: nothing that matters in the top 250 px or the
 * bottom 340 px), post = 1080 × 1350. The ground is the theme's color with
 * doodles (the event's ground and frame during an event); the photo is never
 * darkened. Styles are plain objects: the narrow-phone scaling must not touch
 * a fixed-size image. `onReady` once the images are drawn (or after a timeout);
 * `still` stops the "?" wiggle (SharePanel sets it while capturing).
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

export const ProofCard = forwardRef<View, {
  content: ProofContent; template: ShareTemplate; format: ShareFormat; others?: VersusPhoto[]; still?: boolean; onReady: () => void;
}>(function ProofCard({ content, template, format, others = [], still = false, onReady }, ref) {
  const { t } = useTranslation('daily');
  const story = format === 'story';
  const k = story ? 1 : 0.74;   // the art is smaller on the 4:5 post
  const size = PROOF_CARD_DP[format];

  // Ready once the logo, the photo, the selfie and the versus photos are drawn.
  const shownOthers = template === 'versus' ? others.slice(0, 3) : [];
  const expected = 2 + (content.selfieUrl ? 1 : 0) + shownOthers.length;
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

  const ev = content.eventKey ? EVENT_CARD[content.eventKey] : undefined;
  const tc = themeColor(content.theme);
  const ink = ev ? WHITE : tc.onFill;
  const doodle = ev ? ev.accent : tc.line ?? tc.onFill;
  const ground = ev ? ev.ground : tc.fill;

  const city = content.city?.name ? shortCityName(content.city.name) : null;
  const flag = content.city?.country ? FLAGS[content.city.country.toUpperCase()] : undefined;
  const question = content.shareQuestion || t('share.card.question');
  const kicker = ['Daily Challenge', content.themeLabel].filter(Boolean).join(' · ').toUpperCase();
  const who = content.username && city ? t('share.card.playedFor', { user: content.username, city })
    : content.username ? `@${content.username}` : city ?? '';

  const mine = (w: number, h: number, rotate: number) => (
    <Polaroid photo={content.photoUrl} selfie={content.selfieUrl ?? null} width={w} height={h} rotate={rotate}
              label={city} flag={flag} onLoad={loadedOne} />
  );

  let art: React.ReactNode;
  if (template === 'turn') {
    art = (
      <View style={[s.row, { marginTop: u(8) }]}>
        {mine(u(142) * k, u(176) * k, -7)}
        <View style={{ marginLeft: -u(10) * k, marginTop: u(26) * k }}>
          <Mystery width={u(142) * k} height={u(176) * k} label={t('share.card.yourCity')} still={still} />
        </View>
      </View>
    );
  } else if (template === 'versus') {
    const small = shownOthers.length > 1;
    art = (
      <View style={s.row}>
        {mine(u(128) * k, u(170) * k, -5)}
        <View style={[s.vs, { width: u(44) * k, height: u(44) * k, borderRadius: u(22) * k, marginHorizontal: -u(12) * k }]}>
          <Text style={[s.vsText, { fontSize: u(15) * k }]}>{t('share.card.vs')}</Text>
        </View>
        <View style={{ gap: small ? u(4) * k : 0 }}>
          {shownOthers.map((o, i) => (
            <Polaroid key={o.id} photo={o.photoUrl} selfie={null}
                      width={(small ? u(92) : u(128)) * k} height={(small ? (shownOthers.length > 2 ? u(60) : u(90)) : u(170)) * k}
                      rotate={[5, -3, 4][i]} label={o.city ? shortCityName(o.city) : null}
                      flag={o.country ? FLAGS[o.country.toUpperCase()] : undefined} onLoad={loadedOne} compact={small} />
          ))}
        </View>
      </View>
    );
  } else {
    const rank = content.rank
      ? (content.rank.city ? t('share.rankCity', { rank: content.rank.rank, city: localizeCityName(content.rank.city) }) : t('share.rankWorld', { rank: content.rank.rank }))
      : null;
    const votes = content.voteCount ? t('share.card.votes', { count: content.voteCount }) : null;
    art = (
      <View style={{ alignItems: 'center' }}>
        {mine(u(170) * k, u(186) * k, -3)}
        <View style={[s.row, { marginTop: u(14) * k, gap: u(8) }]}>
          {!!rank && <Text style={[s.pill, s.gold, { fontSize: u(14) * k }]}>{`🏆 ${rank}`}</Text>}
          {!!votes && <Text style={[s.pill, { fontSize: u(14) * k }]}>{`❤️ ${votes}`}</Text>}
        </View>
        {!!content.answer && (
          <Text style={[s.answer, { fontSize: u(16) * k, marginTop: u(10) * k }]} numberOfLines={2}>{`“${content.answer}”`}</Text>
        )}
      </View>
    );
  }

  return (
    <View ref={ref} collapsable={false} style={[s.card, { width: size.width, height: size.height, backgroundColor: ground }]}>
      {ev ? (
        <Svg width={size.width} height={size.height} style={s.abs}>
          <Defs>
            <LinearGradient id="pcEvent" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={ev.ground} />
              <Stop offset="1" stopColor={ev.ground2} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#pcEvent)" />
        </Svg>
      ) : (
        <Doodles width={size.width} height={size.height} color={doodle} />
      )}
      {ev && <EventFrame eventKey={content.eventKey!} width={size.width} height={size.height} />}

      <View style={[s.body, story ? s.bodyStory : s.bodyPost]}>
        <View>
          <Text style={[s.kicker, { color: ink }]} numberOfLines={1}>{kicker}</Text>
          <Text style={[s.question, { color: ink, fontSize: u(story ? 31 : 26), lineHeight: u(story ? 35 : 30) }]} numberOfLines={3}>{question}</Text>
        </View>

        <View style={s.art}>
          {art}
          <Text style={[s.challenge, { color: ink, fontSize: u(story ? 15 : 13) }]} numberOfLines={2}>{content.text}</Text>
          {!!who && <Text style={[s.who, { color: ink, fontSize: u(story ? 14 : 12) }]} numberOfLines={1}>{who}</Text>}
        </View>

        <View style={[s.footer, { borderTopColor: ev ? 'rgba(255,255,255,0.3)' : `${hexAlpha(ink, 0.25)}` }]}>
          <Image source={LOGO} style={s.logo} contentFit="contain" onLoad={loadedOne} onError={loadedOne} />
          <View style={s.brand}>
            <Text style={[s.brandName, { color: ink }]}>Hilads</Text>
            <Text style={[s.tagline, { color: ink }]} numberOfLines={1}>{t('worlds.tagline')}{ev ? ` ${ev.emoji}` : ''}</Text>
          </View>
          <Text style={[s.site, { color: ink }]}>hilads.live</Text>
        </View>
      </View>
    </View>
  );
});

/** A white polaroid: the photo (never darkened), the selfie inset of a dual photo, the city under it. */
function Polaroid({ photo, selfie, width, height, rotate, label, flag, onLoad, compact = false }: {
  photo: string; selfie: string | null; width: number; height: number; rotate: number;
  label: string | null; flag: number | undefined; onLoad: () => void; compact?: boolean;
}) {
  const pad = compact ? u(5) : u(8);
  return (
    <View style={[s.polaroid, { width: width + pad * 2, padding: pad, paddingBottom: compact ? u(18) : u(30), transform: [{ rotate: `${rotate}deg` }] }]}>
      <Image source={{ uri: photo }} style={{ width, height, backgroundColor: '#EEE6DC' }} contentFit="cover" onLoad={onLoad} onError={onLoad} />
      {!!selfie && (
        <Image source={{ uri: selfie }} contentFit="cover" onLoad={onLoad} onError={onLoad}
               style={[s.selfie, { top: pad + u(6), left: pad + u(6), width: width * 0.3, height: width * 0.4, borderRadius: u(8) }]} />
      )}
      {!!label && (
        <View style={[s.label, { bottom: compact ? u(3) : u(7) }]}>
          {flag !== undefined && <Image source={flag} style={[s.flag, compact && s.flagSmall]} contentFit="cover" />}
          <Text style={[s.labelText, compact && s.labelSmall]} numberOfLines={1}>{label}</Text>
        </View>
      )}
    </View>
  );
}

/** The friend's empty polaroid: a dashed frame and a big "?" that wiggles (still while captured). */
function Mystery({ width, height, label, still }: { width: number; height: number; label: string; still: boolean }) {
  const reduced = useReducedMotion();
  const r = useSharedValue(0);
  useEffect(() => {
    if (still || reduced) {
      cancelAnimation(r);
      r.value = 0;
      return;
    }
    r.value = withRepeat(withSequence(
      withTiming(-9, { duration: 160, easing: Easing.out(Easing.quad) }),
      withTiming(9, { duration: 320, easing: Easing.inOut(Easing.quad) }),
      withTiming(0, { duration: 160 }),
      withTiming(0, { duration: 1400 }),
    ), -1);
  }, [still, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  const wiggle = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  const pad = u(8);
  return (
    <View style={[s.polaroid, { width: width + pad * 2, padding: pad, paddingBottom: u(30), transform: [{ rotate: '6deg' }] }]}>
      <View style={[s.dashed, { width, height }]}>
        <Animated.Text style={[s.mark, { fontSize: width * 0.62, lineHeight: width * 0.72 }, wiggle]}>?</Animated.Text>
      </View>
      <View style={[s.label, { bottom: u(7) }]}>
        <Text style={s.labelText} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  );
}

/** Hand-drawn doodles on the theme's ground: squiggles, stars, dots, a dotted arc (decor, kept to the edges). */
function Doodles({ width, height, color }: { width: number; height: number; color: string }) {
  const x = (n: number) => (n / 360) * width;
  const y = (n: number) => (n / 640) * height;
  const star = (cx: number, cy: number, r: number) =>
    `M${cx} ${cy - r} L${cx + r * 0.3} ${cy - r * 0.3} L${cx + r} ${cy} L${cx + r * 0.3} ${cy + r * 0.3} L${cx} ${cy + r} L${cx - r * 0.3} ${cy + r * 0.3} L${cx - r} ${cy} L${cx - r * 0.3} ${cy - r * 0.3} Z`;
  return (
    <Svg width={width} height={height} style={s.abs}>
      <Path d={`M${x(-6)} ${y(40)} q${x(20)} ${-y(22)} ${x(40)} 0 t${x(40)} 0 t${x(40)} 0`} stroke={color} strokeWidth={u(4)} fill="none" strokeLinecap="round" opacity={0.35} />
      <Path d={star(x(318), y(52), u(13))} fill={color} opacity={0.4} />
      <Path d={star(x(26), y(330), u(9))} fill={color} opacity={0.35} />
      <Path d={star(x(338), y(400), u(11))} fill={color} opacity={0.35} />
      <Circle cx={x(300)} cy={y(250)} r={u(5)} fill={color} opacity={0.35} />
      <Circle cx={x(52)} cy={y(220)} r={u(4)} fill={color} opacity={0.35} />
      <Circle cx={x(334)} cy={y(606)} r={u(26)} stroke={color} strokeWidth={u(3)} fill="none" opacity={0.25} />
      <Path d={`M${x(-10)} ${y(600)} q${x(60)} ${-y(70)} ${x(120)} ${-y(10)}`} stroke={color} strokeWidth={u(3)} strokeDasharray={`${u(2)} ${u(9)}`}
            strokeLinecap="round" fill="none" opacity={0.45} />
    </Svg>
  );
}

/** "#RRGGBB" with an alpha (rgba). */
function hexAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const s = {
  card:      { overflow: 'hidden' },
  abs:       { position: 'absolute', top: 0, left: 0 },
  body:      { flex: 1, justifyContent: 'space-between', paddingHorizontal: u(24) },
  bodyStory: { paddingTop: u(88), paddingBottom: u(116) },   // Stories: top 250 px and bottom 340 px of 1920 kept clear
  bodyPost:  { paddingTop: u(26), paddingBottom: u(20) },
  kicker:    { fontFamily: appFont('800'), fontSize: u(11), letterSpacing: u(1.4), opacity: 0.75, marginBottom: u(8) },
  question:  { fontFamily: appFont('800'), letterSpacing: u(-0.4) },
  art:       { alignItems: 'center' },
  row:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  challenge: { fontFamily: appFont('700'), textAlign: 'center', marginTop: u(16), opacity: 0.9 },
  who:       { fontFamily: appFont('600'), textAlign: 'center', marginTop: u(4), opacity: 0.8 },
  polaroid:  { backgroundColor: WHITE, borderRadius: u(3), shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: u(8), shadowOffset: { width: 0, height: u(4) }, elevation: 6 },
  selfie:    { position: 'absolute', borderWidth: u(2), borderColor: WHITE },
  label:     { position: 'absolute', left: u(6), right: u(6), flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  labelText: { fontFamily: appFont('800'), fontSize: u(12), color: INK },
  labelSmall: { fontSize: u(9) },
  flag:      { width: u(16), height: u(12), borderRadius: u(2), marginRight: u(5) },
  flagSmall: { width: u(11), height: u(8), marginRight: u(3) },
  dashed:    { borderWidth: u(2.5), borderStyle: 'dashed', borderColor: 'rgba(42,28,19,0.35)', borderRadius: u(4), alignItems: 'center', justifyContent: 'center', backgroundColor: '#FBF6F0' },
  mark:      { fontFamily: appFont('800'), color: INK, textAlign: 'center' },
  vs:        { backgroundColor: INK, alignItems: 'center', justifyContent: 'center', zIndex: 2, borderWidth: u(3), borderColor: WHITE },
  vsText:    { fontFamily: appFont('800'), color: WHITE },
  pill:      { fontFamily: appFont('800'), color: INK, backgroundColor: WHITE, borderRadius: u(999), paddingHorizontal: u(12), paddingVertical: u(5), overflow: 'hidden' },
  gold:      { backgroundColor: '#FFD66B' },
  answer:    { fontFamily: appFont('700'), color: INK, backgroundColor: WHITE, borderRadius: u(14), paddingHorizontal: u(14), paddingVertical: u(8), overflow: 'hidden', textAlign: 'center' },
  footer:    { flexDirection: 'row', alignItems: 'center', paddingTop: u(12), borderTopWidth: u(1) },
  logo:      { width: u(34), height: u(34), marginRight: u(10) },
  brand:     { flex: 1 },
  brandName: { fontFamily: appFont('800'), fontSize: u(16), letterSpacing: u(-0.3) },
  tagline:   { fontFamily: appFont('500'), fontSize: u(11), opacity: 0.8 },
  site:      { fontFamily: appFont('700'), fontSize: u(14), marginLeft: u(8) },
} satisfies Record<string, ViewStyle | TextStyle | ImageStyle>;

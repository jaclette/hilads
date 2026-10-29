import { forwardRef, useEffect, useRef } from 'react';
import { PixelRatio, Text, View, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { appFont } from '@/scaling';
import { localizeCityName } from '@/i18n/cityName';
import { themeName } from '@/features/daily/themes';
import { THEME_COVERS, themeCover } from '@/features/today/covers';
import { THEME_KEYS } from '@/features/daily/themes';
import { FLAGS } from '@/ui/flags';
import { themeColor } from '@/ui/joy';
import type { ShareContent } from './content';

const LOGO = require('../../../assets/logo/hilads-icon.svg'); // eslint-disable-line @typescript-eslint/no-require-imports

const DAILY_CHALLENGE = 'Daily Challenge';
const TAGLINE_EN = 'Same challenge. Different worlds.';
/** The card is 1080 x 1920 px: laid out at that many pixels on this screen. */
export const CARD_PX = { width: 1080, height: 1920 };
const W = CARD_PX.width / PixelRatio.get();
const u = (n: number) => (n * W) / 360;   // sizes are designed on a 360 x 640 canvas
/** The card's size in dp on this screen. */
export const CARD_DP = { width: W, height: u(640) };
const READY_TIMEOUT_MS = 6000;

/**
 * The share card (SPEC 9.14): a 9:16 story image, shown scaled down as the
 * preview and captured at full size by SharePanel. The photo full-bleed under a dark gradient; the
 * podium rank on top; at the bottom the theme, the challenge (or the spot's
 * name), the city with its flag and the author, then the Hilads logo, the
 * tagline and hilads.live. Text and margins stay clear of the Stories UI (top
 * ~12%, bottom ~15%). Styles are plain objects: the app's narrow-phone
 * scaling (StyleSheet.create) must not touch a fixed-size image.
 * `onReady` once the photo and the logo are drawn (or after a timeout).
 */
export const ShareCard = forwardRef<View, { content: ShareContent; onReady: () => void }>(function ShareCard({ content, onReady }, ref) {
  const { t } = useTranslation('daily');
  const loaded = useRef(0);
  const done = useRef(false);
  const ready = () => {
    if (done.current) return;
    done.current = true;
    // One more frame so the images are on screen before the capture.
    requestAnimationFrame(() => setTimeout(onReady, 120));
  };
  // The logo and the photo, plus the selfie inset of a dual photo.
  const selfie = content.type === 'proof' ? content.selfieUrl ?? null : null;
  const loadedOne = () => { loaded.current += 1; if (loaded.current >= (selfie ? 3 : 2)) ready(); };
  useEffect(() => {
    const timer = setTimeout(ready, READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const theme = content.type !== 'spot' && content.themeLabel ? content.themeLabel
    : content.theme ? themeName(content.theme, { city: content.city?.name }) : '';
  const kicker = content.type === 'spot' ? theme : [content.type === 'index' ? HILADS_INDEX : DAILY_CHALLENGE, theme].filter(Boolean).join(' · ');
  const cover = content.photoUrl ? { uri: content.photoUrl }
    : themeCover(content.theme ?? 'only_here', content.type === 'today' ? content.date : null) ?? THEME_COVERS.only_here;
  const flag = content.city?.country ? FLAGS[content.city.country.toUpperCase()] : undefined;
  const city = content.city?.name ? localizeCityName(content.city.name) : null;
  const badge = content.type === 'proof' && content.rank
    ? (content.rank.city ? t('share.rankCity', { rank: content.rank.rank, city: localizeCityName(content.rank.city) }) : t('share.rankWorld', { rank: content.rank.rank }))
    : null;
  // SPEC 10.1: share cards say why Hilads is unique (the app and stores keep "Play local. Compare global.").
  const tagline = t('worlds.tagline', { defaultValue: TAGLINE_EN });
  const footer = (
    <View style={s.footer}>
      <Image source={LOGO} style={s.logo} contentFit="contain" onLoad={loadedOne} onError={loadedOne} />
      <View style={s.brand}>
        <Text style={s.brandName}>Hilads</Text>
        <Text style={s.tagline} numberOfLines={2}>{tagline}</Text>
      </View>
      <Text style={s.site}>hilads.live</Text>
    </View>
  );

  // My passport (V3 polish 6): a warm passport page, my photo, @username and city,
  // the 7 stamps in their theme colors (the missing ones as outlines), my stats.
  if (content.type === 'passport') {
    const have = new Set(content.stamps);
    return (
      <View ref={ref} collapsable={false} style={[s.card, s.passport]}>
        <View style={s.passportTop}>
          <Text style={s.passportKicker}>{t('share.passportKicker').toUpperCase()}</Text>
          {content.photoUrl
            ? <Image source={{ uri: content.photoUrl }} style={s.passportPhoto} contentFit="cover" onLoad={loadedOne} onError={loadedOne} />
            : <View style={[s.passportPhoto, s.passportNoPhoto]} onLayout={loadedOne} />}
          {!!content.username && <Text style={s.passportName}>@{content.username}</Text>}
          {city && (
            <View style={[s.metaRow, s.passportCity]}>
              {flag && <Image source={flag} style={s.flag} contentFit="cover" />}
              <Text style={s.passportCityText} numberOfLines={1}>{city}</Text>
            </View>
          )}
        </View>
        <View style={s.stampGrid}>
          {THEME_KEYS.map((k, i) => {
            const tc = themeColor(k);
            const on = have.has(k);
            return (
              <View key={k} style={[s.stampDot, on ? { backgroundColor: tc.fill, borderColor: tc.line ?? '#2A1C13' } : s.stampOff,
                                    { transform: [{ rotate: `${(i % 2 ? 1 : -1) * (4 + i)}deg` }] }]} />
            );
          })}
          <View style={[s.stampDot, content.earned ? s.passOn : s.passOff]} />
        </View>
        <View style={s.statsRow}>
          {[[content.stats.cities, t('share.statCities', { count: content.stats.cities })],
            [content.stats.photos, t('share.statPhotos', { count: content.stats.photos })],
            [content.stats.likes, t('share.statLikes', { count: content.stats.likes })]].map(([n, label]) => (
            <View key={String(label)} style={s.stat}>
              <Text style={s.statValue}>{n}</Text>
              <Text style={s.statLabel} numberOfLines={1}>{label}</Text>
            </View>
          ))}
        </View>
        <View style={s.passportBottom}>{footer}</View>
      </View>
    );
  }

  return (
    <View ref={ref} collapsable={false} style={s.card}>
      <Image source={cover} style={s.fill} contentFit="cover" onLoad={loadedOne} onError={loadedOne} />
      {!!selfie && <Image source={{ uri: selfie }} style={s.selfie} contentFit="cover" onLoad={loadedOne} onError={loadedOne} />}
      <Svg width={W} height={u(640)} style={s.fill}>
        <Defs>
          <LinearGradient id="shareTop" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity={0.45} />
            <Stop offset="0.22" stopColor="#000" stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id="shareBottom" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.22" stopColor="#0C0805" stopOpacity={0} />
            <Stop offset="0.5" stopColor="#0C0805" stopOpacity={0.8} />
            <Stop offset="1" stopColor="#0C0805" stopOpacity={0.94} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#shareTop)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#shareBottom)" />
      </Svg>

      {badge && (
        <View style={s.badge}>
          <Text style={s.badgeText}>{badge}</Text>
        </View>
      )}

      <View style={s.bottom}>
        {!!kicker && <Text style={s.kicker} numberOfLines={1}>{kicker.toUpperCase()}</Text>}
        <Text style={content.type === 'spot' ? s.name : s.title} numberOfLines={content.type === 'spot' ? 3 : 6}>
          {content.type === 'spot' ? content.name : content.text}
        </Text>
        {(city || content.type === 'proof') && (
          <View style={s.metaRow}>
            {flag && <Image source={flag} style={s.flag} contentFit="cover" />}
            <Text style={s.meta} numberOfLines={1}>
              {[city, content.type === 'proof' && content.username ? `@${content.username}` : null].filter(Boolean).join('  ·  ')}
            </Text>
          </View>
        )}
        {content.type === 'spot' && content.by && <Text style={s.credit}>{t('share.photoBy', { user: content.by })}</Text>}
        {content.type === 'today' && <Text style={s.cta}>{t('share.areYouIn')}</Text>}
        {content.type === 'index' && (
          <View style={s.lines}>
            {content.lines.slice(0, 6).map(l => (
              <View key={l.city} style={s.metaRow}>
                {l.country && FLAGS[l.country.toUpperCase()] && <Image source={FLAGS[l.country.toUpperCase()]} style={s.flag} contentFit="cover" />}
                <Text style={s.lineCity} numberOfLines={1}>{l.city}</Text>
                <Text style={s.lineValue}>{l.value}</Text>
              </View>
            ))}
          </View>
        )}

        {footer}
      </View>
    </View>
  );
});

const white = '#FFFFFF';
/** Brand term: English in every locale. */
const HILADS_INDEX = 'Hilads Index';
const s = {
  card:      { width: W, height: u(640), backgroundColor: '#1A1410', overflow: 'hidden' },
  fill:      { position: 'absolute', top: 0, left: 0, width: W, height: u(640) },
  selfie:    { position: 'absolute', top: u(86), right: u(16), width: u(92), height: u(122), borderRadius: u(14), borderWidth: u(3), borderColor: white, zIndex: 1 },
  badge:     { position: 'absolute', top: u(84), left: u(24), paddingHorizontal: u(14), paddingVertical: u(7), borderRadius: u(999), backgroundColor: '#D9AE52' },
  badgeText: { fontFamily: appFont('800'), fontSize: u(15), color: '#1A1206' },
  bottom:    { position: 'absolute', left: u(24), right: u(24), bottom: u(96) },
  lines:     { gap: u(6), marginTop: u(10) },
  lineCity:  { flex: 1, fontFamily: appFont('700'), fontSize: u(17), color: white },
  lineValue: { fontFamily: appFont('800'), fontSize: u(17), color: white },
  kicker:    { fontFamily: appFont('800'), fontSize: u(12), letterSpacing: u(1.4), color: '#FFB48A', marginBottom: u(8) },
  title:     { fontFamily: appFont('800'), fontSize: u(26), lineHeight: u(32), color: white, letterSpacing: u(-0.3) },
  name:      { fontFamily: appFont('800'), fontSize: u(32), lineHeight: u(38), color: white, letterSpacing: u(-0.4) },
  metaRow:   { flexDirection: 'row', alignItems: 'center', marginTop: u(14) },
  flag:      { width: u(21), height: u(16), borderRadius: u(2), marginRight: u(8) },
  meta:      { flexShrink: 1, fontFamily: appFont('600'), fontSize: u(15), color: 'rgba(255,255,255,0.9)' },
  credit:    { fontFamily: appFont('500'), fontSize: u(13), color: 'rgba(255,255,255,0.75)', marginTop: u(6) },
  cta:       { fontFamily: appFont('800'), fontSize: u(19), color: '#FFB48A', marginTop: u(12) },
  footer:    { flexDirection: 'row', alignItems: 'center', marginTop: u(24), paddingTop: u(16), borderTopWidth: u(1), borderTopColor: 'rgba(255,255,255,0.25)' },
  logo:      { width: u(40), height: u(40), marginRight: u(10) },
  brand:     { flex: 1 },
  brandName: { fontFamily: appFont('800'), fontSize: u(17), color: white, letterSpacing: u(-0.3) },
  tagline:   { fontFamily: appFont('500'), fontSize: u(12), color: 'rgba(255,255,255,0.78)' },
  site:      { fontFamily: appFont('700'), fontSize: u(15), color: white, marginLeft: u(8) },
  // The passport card: a warm ink-brown page (fixed colors: an image, the same in every theme).
  passport:       { backgroundColor: '#2A1C13', alignItems: 'center' },
  passportTop:    { marginTop: u(72), alignItems: 'center' },
  passportKicker: { fontFamily: appFont('800'), fontSize: u(12), letterSpacing: u(2), color: '#FFB48A', marginBottom: u(16) },
  passportPhoto:  { width: u(96), height: u(96), borderRadius: u(48), borderWidth: u(4), borderColor: '#FFC93C' },
  passportNoPhoto: { backgroundColor: '#4A3426' },
  passportName:   { fontFamily: appFont('800'), fontSize: u(26), color: white, marginTop: u(14), letterSpacing: u(-0.3) },
  passportCity:   { marginTop: u(6) },
  passportCityText: { fontFamily: appFont('700'), fontSize: u(16), color: 'rgba(255,255,255,0.9)' },
  stampGrid:      { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', width: u(220), marginTop: u(22), gap: u(10) },
  stampDot:       { width: u(40), height: u(40), borderRadius: u(20), borderWidth: u(3) },
  stampOff:       { borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.35)' },
  passOn:         { backgroundColor: '#D9AE52', borderColor: '#FFE08A' },
  passOff:        { borderStyle: 'dashed', borderColor: '#D9AE52' },
  statsRow:       { flexDirection: 'row', marginTop: u(20), width: u(300), justifyContent: 'space-between' },
  stat:           { alignItems: 'center', flex: 1 },
  statValue:      { fontFamily: appFont('800'), fontSize: u(28), color: white },
  statLabel:      { fontFamily: appFont('600'), fontSize: u(12), color: 'rgba(255,255,255,0.75)' },
  passportBottom: { position: 'absolute', left: u(24), right: u(24), bottom: u(96) },
} satisfies Record<string, ViewStyle | TextStyle | ImageStyle>;

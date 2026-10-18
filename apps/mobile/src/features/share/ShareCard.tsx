import { forwardRef, useEffect, useRef } from 'react';
import { PixelRatio, Text, View, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { appFont } from '@/scaling';
import { localizeCityName } from '@/i18n/cityName';
import { themeName } from '@/features/daily/themes';
import { THEME_COVERS } from '@/features/today/covers';
import { FLAGS } from '@/ui/flags';
import type { ShareContent } from './content';

const LOGO = require('../../../assets/logo/hilads-icon.svg'); // eslint-disable-line @typescript-eslint/no-require-imports

const DAILY_CHALLENGE = 'Daily Challenge';
const TAGLINE_EN = 'One local thing. Every day.';
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
  const { t: tc } = useTranslation('common');
  const loaded = useRef(0);
  const done = useRef(false);
  const ready = () => {
    if (done.current) return;
    done.current = true;
    // One more frame so the images are on screen before the capture.
    requestAnimationFrame(() => setTimeout(onReady, 120));
  };
  const loadedOne = () => { loaded.current += 1; if (loaded.current >= 2) ready(); };
  useEffect(() => {
    const timer = setTimeout(ready, READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const theme = content.theme ? themeName(content.theme) : '';
  const kicker = content.type === 'spot' ? theme : [DAILY_CHALLENGE, theme].filter(Boolean).join(' · ');
  const cover = content.photoUrl ? { uri: content.photoUrl } : THEME_COVERS[content.theme ?? 'neighborhood'];
  const flag = content.city?.country ? FLAGS[content.city.country.toUpperCase()] : undefined;
  const city = content.city?.name ? localizeCityName(content.city.name) : null;
  const badge = content.type === 'proof' && content.rank
    ? (content.rank.city ? t('share.rankCity', { rank: content.rank.rank, city: localizeCityName(content.rank.city) }) : t('share.rankWorld', { rank: content.rank.rank }))
    : null;
  const tagline = tc('firstLaunch', { defaultValue: TAGLINE_EN });

  return (
    <View ref={ref} collapsable={false} style={s.card}>
      <Image source={cover} style={s.fill} contentFit="cover" onLoad={loadedOne} onError={loadedOne} />
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

        <View style={s.footer}>
          <Image source={LOGO} style={s.logo} contentFit="contain" onLoad={loadedOne} onError={loadedOne} />
          <View style={s.brand}>
            <Text style={s.brandName}>Hilads</Text>
            <Text style={s.tagline} numberOfLines={1}>{tagline}</Text>
          </View>
          <Text style={s.site}>hilads.live</Text>
        </View>
      </View>
    </View>
  );
});

const white = '#FFFFFF';
const s = {
  card:      { width: W, height: u(640), backgroundColor: '#1A1410', overflow: 'hidden' },
  fill:      { position: 'absolute', top: 0, left: 0, width: W, height: u(640) },
  badge:     { position: 'absolute', top: u(84), left: u(24), paddingHorizontal: u(14), paddingVertical: u(7), borderRadius: u(999), backgroundColor: '#D9AE52' },
  badgeText: { fontFamily: appFont('800'), fontSize: u(15), color: '#1A1206' },
  bottom:    { position: 'absolute', left: u(24), right: u(24), bottom: u(96) },
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
} satisfies Record<string, ViewStyle | TextStyle | ImageStyle>;

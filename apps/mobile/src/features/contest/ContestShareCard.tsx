import { forwardRef, useEffect, useRef } from 'react';
import { Image } from 'expo-image';
import { mediumUrl } from '@/lib/imageThumb';
import { PixelRatio, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ViewInstance } from 'react-native';
import { appFont } from '@/scaling';
import { ordinal } from '@/lib/ordinal';
import { HalongArt, LS } from './HalongArt';

/** What the Launch Season share card shows (ShareContent 'contest'). */
export type ContestShareData = {
  prize: string; subtitle: string; when: string; username: string | null; photoUrl?: string | null;
  rank: number | null; points: number | null; isTest: boolean;
  /** The Boarding card: the players' goal as seats on the flight (null = my rank card). */
  boarding?: { players: number; threshold: number; showCount: boolean } | null;
};

const W = 1080 / PixelRatio.get();
const u = (n: number) => (n * W) / 360;          // designed on a 360 x 640 canvas, captured at 1080 x 1920
const PAPER = '#FBF6F0', INK = '#241A12', MUTED = '#6E5D4E', RED_TEXT = '#C24A38', LINE = '#E8CDB8';

/**
 * The Launch Season share card (9:16): the boarding pass to the prize, my rank and points (or
 * "I'm in"), the deadline, and "Join me on Hilads". Fixed colors (an image, the same in every
 * theme); text clear of the Stories UI (top ~12%, bottom ~15%). Plain style objects: the app's
 * narrow-phone scaling must not touch a fixed-size image. No image to load: ready at once.
 */
export const ContestShareCard = forwardRef<ViewInstance, { data: ContestShareData; onReady: () => void }>(function ContestShareCard({ data, onReady }, ref) {
  const { t, i18n } = useTranslation('me');
  const done = useRef(false);
  const ready = () => { if (!done.current) { done.current = true; requestAnimationFrame(() => setTimeout(onReady, 150)); } };
  useEffect(() => {
    // The illustration draws at once; a photo when it has loaded (or after a timeout).
    const id = setTimeout(ready, data.photoUrl ? 6000 : 200);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View ref={ref} collapsable={false} style={s.card}>
      <View style={s.art}>
        {data.photoUrl
          ? <Image source={{ uri: mediumUrl(data.photoUrl) ?? data.photoUrl }} style={{ width: W, height: u(250) }} contentFit="cover" onLoad={ready} onError={ready} />
          : <HalongArt width={W} height={u(250)} />}
        {data.isTest && <Text style={s.test}>{t('contest.test')}</Text>}
      </View>
      <View style={s.tear}>
        <View style={[s.notch, { left: -u(26) }]} />
        <View style={[s.notch, { right: -u(26) }]} />
      </View>
      <View style={s.body}>
        <Text style={s.kicker}>Hilads · Launch Trip</Text>
        <Text style={s.prize} numberOfLines={2}>{data.prize}</Text>
        {!!data.subtitle && <Text style={s.sub} numberOfLines={2}>{data.subtitle}</Text>}
        {data.boarding ? (
          <View style={s.board}>
            {data.boarding.showCount ? (
              <Text style={s.seats}>{t('trip.board.cardSeats', { players: data.boarding.players, threshold: data.boarding.threshold })}</Text>
            ) : <Text style={s.seats}>{t('trip.board.first')}</Text>}
            <Text style={s.grab}>{t('trip.board.cardGrab')} ✈️</Text>
          </View>
        ) : (
        <View style={s.statusRow}>
          {data.rank ? (
            <>
              <View style={s.tag}><View style={s.tagHole} /><Text style={s.tagText}>{ordinal(data.rank, i18n.language)}</Text></View>
              <Text style={s.status} numberOfLines={2}>
                {[data.username ? '@' + data.username : null, data.points !== null ? t('contest.pts', { count: data.points }) : null].filter(Boolean).join(' · ')}
              </Text>
            </>
          ) : <Text style={[s.status, s.statusIn]}>{t('contest.shareCardIn')} ✈️</Text>}
        </View>
        )}
        <Text style={s.when}>{data.when}</Text>
      </View>
      <View style={s.cta}>
        <Text style={s.ctaText} numberOfLines={2}>{t('contest.shareCardJoin')}</Text>
        <Text style={s.site}>hilads.live</Text>
      </View>
    </View>
  );
});

const f = (weight: string, size: number, color: string, extra: TextStyle = {}): TextStyle =>
  ({ fontFamily: appFont(weight), fontWeight: weight as TextStyle['fontWeight'], fontSize: u(size), lineHeight: u(size * 1.18), color, ...extra });

const s: Record<string, ViewStyle & TextStyle> = {
  card:     { width: W, height: u(640), backgroundColor: PAPER, overflow: 'hidden' },
  art:      { width: W, height: u(250) },
  test:     { ...f('800', 13, '#FFFFFF'), position: 'absolute', top: u(88), right: u(20), backgroundColor: LS.lantern, borderRadius: u(12),
              paddingHorizontal: u(10), paddingVertical: u(3), overflow: 'hidden' },
  tear:     { height: 0, borderTopWidth: u(2.5), borderStyle: 'dashed', borderColor: LINE, marginHorizontal: u(18) },
  notch:    { position: 'absolute', top: -u(13), width: u(24), height: u(24), borderRadius: u(12), backgroundColor: LS.board },
  body:     { paddingHorizontal: u(24), paddingTop: u(16), gap: u(5) },
  kicker:   f('800', 13, LS.lantern),
  prize:    f('800', 30, INK, { letterSpacing: -u(0.6) }),
  sub:      f('700', 14, RED_TEXT),
  statusRow:{ flexDirection: 'row', alignItems: 'center', gap: u(10), marginTop: u(8) },
  tag:      { flexDirection: 'row', alignItems: 'center', gap: u(6), backgroundColor: '#F7B733', borderTopLeftRadius: u(6), borderBottomLeftRadius: u(6),
              borderTopRightRadius: u(12), borderBottomRightRadius: u(12), paddingLeft: u(8), paddingRight: u(12), paddingVertical: u(4), transform: [{ rotate: '-4deg' }] },
  tagHole:  { width: u(7), height: u(7), borderRadius: u(4), backgroundColor: LS.board },
  tagText:  f('800', 24, '#2A1C13'),
  status:   { ...f('800', 17, INK), flexShrink: 1 },
  statusIn: { backgroundColor: '#FFE6D8', color: '#8A3A12', borderRadius: u(16), paddingHorizontal: u(14), paddingVertical: u(6), overflow: 'hidden' },
  when:     { ...f('700', 15, MUTED), marginTop: u(4) },
  board:    { marginTop: u(10), gap: u(4) },
  seats:    f('800', 26, INK, { letterSpacing: -u(0.4) }),
  grab:     f('800', 20, RED_TEXT),
  cta:      { position: 'absolute', left: u(18), right: u(18), bottom: u(92), backgroundColor: LS.board, borderRadius: u(20), paddingVertical: u(14),
              paddingHorizontal: u(18), alignItems: 'center', gap: u(2) },
  ctaText:  { ...f('800', 19, LS.boardText), textAlign: 'center' },
  site:     f('800', 15, LS.mango),
};

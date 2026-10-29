import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { useTranslation } from 'react-i18next';
import { Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { track } from '@/services/analytics';
import { fetchDailyTodayProofs } from '@/api/daily';
import { CARD_DP, ShareCard } from './ShareCard';
import { PROOF_CARD_DP, ProofCard, type ShareFormat, type ShareTemplate, type VersusPhoto } from './ProofCard';
import { shareText, shareUrl, type ShareContent } from './content';
import { IMAGE_CHANNELS, directChannels, shareTo, type ShareChannel } from './targets';

type IconName = ComponentProps<typeof Ionicons>['name'];

const STORY_CHANNELS: ShareChannel[] = ['instagram_story', 'facebook_story'];
/** The targets: the share channels plus Save image (to the phone's photos). */
type Target = ShareChannel | 'save_image';

// Brand names stay as they are in every language.
const LABEL: Record<ShareChannel, string> = {
  instagram_story: 'Instagram Story', facebook_story: 'Facebook Story', whatsapp: 'WhatsApp',
  messenger: 'Messenger', telegram: 'Telegram', x: 'X', copy_link: '', share_sheet: '',
};

/**
 * The card's preview and where to share it (SPEC 9.14): the installed direct
 * targets (Instagram and Facebook Stories with the card image; WhatsApp,
 * Messenger, Telegram and X with the link, whose preview is the card), Copy
 * link, and More (the system share sheet: Zalo, LINE, KakaoTalk, Snapchat,
 * TikTok...). My photo gets three templates to swipe through (ProofCard:
 * Your turn, Versus when other cities played the same day, Result); other
 * content its one card. Story (9:16) or Post (4:5, for a feed post or Save
 * image); Stories always get the 9:16. A card is captured when a target needs
 * it (once per template and format); link targets work before that. Before a
 * Story, the link is copied and a toast says to add it with the Link sticker.
 * share_started / share_opened on mount, share_template_selected on a swipe,
 * share_target on a tap, share_completed per share.
 */
export function SharePanel({ content, source, previewHeight = 300 }: { content: ShareContent; source: string; previewHeight?: number }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const proof = content.type === 'proof' ? content : null;
  const [channels, setChannels] = useState<ShareChannel[]>([]);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<Target | null>(null);
  const [format, setFormat] = useState<ShareFormat>('story');
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [failed, setFailed] = useState(false);
  // My photo: the templates (Versus once other cities' photos of the day are in) and the one on screen.
  const [others, setOthers] = useState<VersusPhoto[] | null>(proof ? null : []);
  const [template, setTemplate] = useState<ShareTemplate>('turn');
  const [still, setStill] = useState(false);
  const [pageW, setPageW] = useState(0);
  const pager = useRef<ScrollView>(null);
  const templates: ShareTemplate[] = others && others.length > 0 ? ['turn', 'versus', 'result'] : ['turn', 'result'];
  // Card keys: "<template>:<format>" (my photo), "card:story" (the rest).
  const key = proof ? `${template}:${format}` : 'card:story';
  const storyKey = proof ? `${template}:story` : 'card:story';
  const props = { content_type: content.type === 'today' && content.represent ? 'represent' : content.type, source,
                  ...(proof ? { template } : {}) };

  // Each card: its view, whether it's drawn, and its captured file.
  const cards = useRef(new Map<string, { view: View | null; ready: boolean; file: string | null }>());
  const card = (k: string) => {
    let c = cards.current.get(k);
    if (!c) { c = { view: null, ready: false, file: null }; cards.current.set(k, c); }
    return c;
  };

  useEffect(() => {
    track('share_started', props);
    track('share_opened', props);
    directChannels().then(setChannels).catch(() => {});
    if (!proof) return;
    // Versus: one photo per other city, today's challenge only (a past photo has no Versus).
    let alive = true;
    const done = (list: VersusPhoto[]) => { if (alive) setOthers(list); };
    const timer = setTimeout(() => done([]), 2500);
    fetchDailyTodayProofs({ scope: 'cities', limit: 12 }).then(r => {
      clearTimeout(timer);
      if (r.date !== proof.date) return done([]);
      const seen = new Set([proof.city?.name ?? '']);
      done(r.proofs.filter(p => {
        const city = p.city?.name ?? '';
        if (p.id === proof.id || p.suggestion || !p.photoUrl || !city || seen.has(city)) return false;
        seen.add(city);
        return true;
      }).slice(0, 3).map(p => ({ id: p.id, photoUrl: p.photoUrl, city: p.city?.name ?? null, country: p.city?.country ?? null })));
    }).catch(() => { clearTimeout(timer); done([]); });
    return () => { alive = false; clearTimeout(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** The card's image: captured once it's drawn (the "?" held still), then kept. */
  const fileFor = async (k: string): Promise<string | null> => {
    const c = card(k);
    if (c.file) return c.file;
    for (let i = 0; i < 70 && !c.ready; i++) await wait(100);
    if (!c.view) return null;
    setStill(true);
    await wait(60);
    try {
      // The card is laid out at full size on this screen: captured as is
      // (a width/height option would be read as points on iOS, 3x too big).
      c.file = await captureRef(c.view, { format: 'jpg', quality: 0.92, result: 'tmpfile' });
      return c.file;
    } catch {
      setFailed(true);
      return null;
    } finally {
      setStill(false);
    }
  };

  const say = (text: string, ms = 2600) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const pick = (next: ShareTemplate, method: 'swipe' | 'tap') => {
    if (next === template) return;
    setTemplate(next);
    track('share_template_selected', { ...props, template: next, method });
  };

  const go = async (channel: Target) => {
    if (busy) return;
    setBusy(channel);
    track('share_target', { ...props, channel, ...(proof ? { format } : {}) });
    try {
      if (channel === 'save_image') return await save();
      // Stories take the 9:16 card whatever the format on screen.
      const story = STORY_CHANNELS.includes(channel);
      const file = IMAGE_CHANNELS.includes(channel) ? await fileFor(story ? storyKey : key) : null;
      if (story) {
        if (!file) return;
        // shareTo copies the link: say so (and how to add it) before Instagram opens.
        say(t('share.card.linkCopied'), 3200);
        await wait(900);
      }
      // My photo's link names the template, for the landing's share_link_visit.
      const url = proof ? `${shareUrl(content)}${shareUrl(content).includes('?') ? '&' : '?'}tpl=${template}` : shareUrl(content);
      const res = await shareTo(channel, { file, url, text: shareText(content) });
      if (channel === 'copy_link') { setCopied(true); setTimeout(() => setCopied(false), 2000); }
      if (res.done) track('share_completed', { ...props, channel, ...(proof ? { format: story ? 'story' : format } : {}), ...(res.activity ? { activity: res.activity } : {}) });
    } catch {
      Alert.alert(t('share.failed'));
    } finally {
      setBusy(null);
    }
  };

  /** Save image: the card on screen (Story or Post) to the phone's photos. */
  const save = async () => {
    const perm = await MediaLibrary.requestPermissionsAsync(true /* add only */);
    if (!perm.granted) { Alert.alert(t('share.card.savePermission')); return; }
    const file = await fileFor(key);
    if (!file) { Alert.alert(t('share.failed')); return; }
    await MediaLibrary.saveToLibraryAsync(file);
    say(t('share.card.saved'));
    track('share_completed', { ...props, channel: 'save_image', ...(proof ? { format } : {}) });
  };

  const cardW = previewHeight * 9 / 16;
  type Layer = { k: string; dp: { width: number; height: number }; node: (ref: (v: View | null) => void, onReady: () => void) => React.ReactNode };
  /** A preview box: its cards at full size, scaled to the box's height (the last one on top: the one on screen). */
  const scaled = (layers: Layer[], boxW = cardW) => (
    <View style={[styles.preview, { height: previewHeight, width: boxW }]}
          accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {layers.map(({ k, dp, node }) => (
        <View key={k} style={{
          position: 'absolute', width: dp.width, height: dp.height,
          left: (boxW - dp.width) / 2, top: (previewHeight - dp.height) / 2,
          transform: [{ scale: previewHeight / dp.height }],
        }}>
          {node(v => { card(k).view = v; }, () => { card(k).ready = true; })}
        </View>
      ))}
    </View>
  );
  const proofLayer = (tp: ShareTemplate, f: ShareFormat): Layer => ({
    k: `${tp}:${f}`, dp: PROOF_CARD_DP[f],
    node: (ref, onReady) => <ProofCard ref={ref} content={proof!} template={tp} format={f} others={others ?? []} still={still || tp !== template} onReady={onReady} />,
  });

  // No card (a capture failed): no Stories; More sends the link alone.
  const all: Target[] = [...channels.filter(ch => !failed || !IMAGE_CHANNELS.includes(ch)), 'copy_link', ...(failed ? [] : ['save_image' as const]), 'share_sheet'];
  return (
    <View style={styles.wrap}>
      {/* The card at full size, scaled down to the preview: what gets captured. */}
      {!proof ? scaled([{ k: 'card:story', dp: CARD_DP, node: (ref, onReady) => <ShareCard ref={ref} content={content} onReady={onReady} /> }]) : others === null ? (
        <View style={[styles.preview, styles.loading, { height: previewHeight, width: cardW }]}><ActivityIndicator /></View>
      ) : (
        <View onLayout={e => setPageW(e.nativeEvent.layout.width)}>
          {pageW > 0 && (
            <ScrollView ref={pager} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
                        onMomentumScrollEnd={e => pick(templates[Math.round(e.nativeEvent.contentOffset.x / pageW)] ?? template, 'swipe')}>
              {templates.map(tp => (
                <View key={tp} style={{ width: pageW, alignItems: 'center' }}>
                  {/* The Post (4:5) covers its template's Story, still drawn for the Stories targets. */}
                  {tp === template && format === 'post'
                    ? scaled([proofLayer(tp, 'story'), proofLayer(tp, 'post')], previewHeight * 4 / 5)
                    : scaled([proofLayer(tp, 'story')])}
                </View>
              ))}
            </ScrollView>
          )}
          <View style={styles.tabs} accessibilityRole="tablist">
            {templates.map((tp, i) => (
              <TouchableOpacity key={tp} style={[styles.tab, tp === template && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tp === template }}
                                onPress={() => { pager.current?.scrollTo({ x: i * pageW, animated: true }); pick(tp, 'tap'); }}>
                <Text style={[styles.tabText, tp === template && styles.tabTextOn]}>{t(`share.card.template.${tp}`)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.formats} accessibilityRole="radiogroup">
            {(['story', 'post'] as const).map(f => (
              <TouchableOpacity key={f} style={[styles.format, f === format && styles.formatOn]} accessibilityRole="radio" accessibilityState={{ selected: f === format }}
                                onPress={() => setFormat(f)}>
                <Ionicons name={f === 'story' ? 'phone-portrait-outline' : 'square-outline'} size={14} color={f === format ? colors.text : colors.muted} />
                <Text style={[styles.formatText, f === format && styles.formatTextOn]}>{t(`share.card.format.${f}`)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
      {!!toast && (
        <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOut.duration(200)} style={styles.toast} accessibilityLiveRegion="polite">
          <Text style={styles.toastText}>{toast}</Text>
        </Animated.View>
      )}
      <View style={styles.grid}>
        {all.map(ch => {
          const label = ch === 'copy_link' ? (copied ? t('share.copied') : t('share.copyLink')) : ch === 'share_sheet' ? t('share.more')
            : ch === 'save_image' ? t('share.card.save') : LABEL[ch];
          return (
            <TouchableOpacity key={ch} style={[styles.target, !!busy && busy !== ch && styles.waiting]} onPress={() => go(ch)} disabled={!!busy}
                              accessibilityRole="button" accessibilityLabel={label}>
              <View>
                <TargetIcon channel={ch} copied={copied} />
                {busy === ch && <View style={styles.spin}><ActivityIndicator color="#FFFFFF" /></View>}
              </View>
              <Text style={styles.label} numberOfLines={2}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const BRAND: Partial<Record<ShareChannel, string>> = {
  facebook_story: '#1877F2', whatsapp: '#25D366', messenger: '#0A7CFF', telegram: '#229ED9', x: '#000000',
};
const ICON: Partial<Record<ShareChannel, IconName>> = {
  instagram_story: 'logo-instagram', facebook_story: 'logo-facebook', whatsapp: 'logo-whatsapp', telegram: 'paper-plane',
};
const SIZE = 56;

/** A target's round icon: the app's colours (Instagram's gradient), Copy link and More in the theme. */
function TargetIcon({ channel, copied }: { channel: Target; copied: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  if (channel === 'copy_link' || channel === 'share_sheet' || channel === 'save_image') {
    const name: IconName = channel === 'share_sheet' ? 'ellipsis-horizontal' : channel === 'save_image' ? 'download-outline' : copied ? 'checkmark' : 'link-outline';
    return <View style={[styles.icon, styles.plain]}><Ionicons name={name} size={26} color={colors.text} /></View>;
  }
  return (
    <View style={[styles.icon, { backgroundColor: BRAND[channel] ?? 'transparent' }]}>
      {channel === 'instagram_story' && (
        <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="ig" x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor="#FEDA75" /><Stop offset="0.35" stopColor="#FA7E1E" />
              <Stop offset="0.65" stopColor="#D62976" /><Stop offset="1" stopColor="#4F5BD5" />
            </LinearGradient>
          </Defs>
          <Rect width={SIZE} height={SIZE} fill="url(#ig)" />
        </Svg>
      )}
      {channel === 'x' ? (
        <Svg width={24} height={24} viewBox="0 0 24 24">
          <Path fill="#FFFFFF" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </Svg>
      ) : channel === 'messenger' ? (
        <Svg width={28} height={28} viewBox="0 0 24 24">
          <Path fill="#FFFFFF" d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.17.16.14.26.35.27.57l.05 1.78c.02.57.6.94 1.12.71l1.99-.88c.17-.07.36-.09.53-.04.92.25 1.9.39 2.9.39 5.64 0 10-4.13 10-9.7S17.64 2 12 2zm6 7.46-2.94 4.66c-.47.74-1.47.93-2.17.4l-2.34-1.75a.6.6 0 0 0-.72 0l-3.16 2.4c-.42.32-.97-.18-.69-.63l2.94-4.66c.47-.74 1.47-.93 2.17-.4l2.34 1.75a.6.6 0 0 0 .72 0l3.16-2.4c.42-.32.97.18.69.63z" />
        </Svg>
      ) : (
        <Ionicons name={ICON[channel] ?? 'share-outline'} size={28} color="#FFFFFF" />
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:      { gap: 16 },
  preview:   { alignSelf: 'center', borderRadius: 16, overflow: 'hidden', backgroundColor: c.bg3 },
  loading:   { alignItems: 'center', justifyContent: 'center' },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  target:    { width: '25%', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  waiting:   { opacity: 0.4 },
  icon:      { width: SIZE, height: SIZE, borderRadius: Radius.full, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  plain:     { backgroundColor: c.bg3, borderWidth: 1, borderColor: c.line },
  label:     { fontSize: 12, lineHeight: 15, fontWeight: '600', color: c.text, textAlign: 'center' },
  spin:      { ...StyleSheet.absoluteFillObject, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: c.scrim },
  tabs:      { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 12 },
  tab:       { paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderRadius: Radius.full, borderWidth: 1, borderColor: c.line, backgroundColor: c.bg2 },
  tabOn:     { backgroundColor: c.text, borderColor: c.text },
  tabText:   { fontSize: 13, fontWeight: '700', color: c.text },
  tabTextOn: { color: c.bg },
  formats:   { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 },
  format:    { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, minHeight: 32, borderRadius: Radius.full },
  formatOn:  { backgroundColor: c.bg3 },
  formatText: { fontSize: 12, fontWeight: '700', color: c.muted },
  formatTextOn: { color: c.text },
  toast:     { alignSelf: 'center', backgroundColor: c.text, borderRadius: Radius.full, paddingHorizontal: 16, paddingVertical: 10, maxWidth: '100%' },
  toastText: { fontSize: 13, fontWeight: '700', color: c.bg, textAlign: 'center' },
});

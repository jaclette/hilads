import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { useTranslation } from 'react-i18next';
import { Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { track } from '@/services/analytics';
import { CARD_DP, ShareCard } from './ShareCard';
import { shareText, shareUrl, type ShareContent } from './content';
import { IMAGE_CHANNELS, directChannels, shareTo, type ShareChannel } from './targets';

type IconName = ComponentProps<typeof Ionicons>['name'];

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
 * TikTok...). The card is captured once it's drawn; link targets work before
 * that. share_started on mount, share_completed per share.
 */
export function SharePanel({ content, source, previewHeight = 300 }: { content: ShareContent; source: string; previewHeight?: number }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const card = useRef<View>(null);
  const [file, setFile] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [channels, setChannels] = useState<ShareChannel[]>([]);
  const [copied, setCopied] = useState(false);
  const props = { content_type: content.type === 'today' && content.represent ? 'represent' : content.type, source };

  useEffect(() => {
    track('share_started', props);
    directChannels().then(setChannels).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const capture = async () => {
    try {
      // The card is laid out at 1080 x 1920 px on this screen: captured as is
      // (a width/height option would be read as points on iOS, 3x too big).
      const uri = await captureRef(card, { format: 'jpg', quality: 0.92, result: 'tmpfile' });
      setFile(uri);
    } catch {
      setFailed(true);
    }
  };

  const go = async (channel: ShareChannel) => {
    if (IMAGE_CHANNELS.includes(channel) && !file && !failed) return;
    try {
      const res = await shareTo(channel, { file, url: shareUrl(content), text: shareText(content) });
      if (channel === 'copy_link') { setCopied(true); setTimeout(() => setCopied(false), 2000); }
      if (res.done) track('share_completed', { ...props, channel, ...(res.activity ? { activity: res.activity } : {}) });
    } catch {
      Alert.alert(t('share.failed'));
    }
  };

  // No card (the capture failed): no Stories; More sends the link alone.
  const all: ShareChannel[] = [...channels.filter(ch => !failed || !IMAGE_CHANNELS.includes(ch)), 'copy_link', 'share_sheet'];
  return (
    <View style={styles.wrap}>
      {/* The card at full size, scaled down to the preview: what gets captured. */}
      {!failed && (
        <View style={[styles.preview, { height: previewHeight, width: previewHeight * 9 / 16 }]}
              accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={{
            position: 'absolute', width: CARD_DP.width, height: CARD_DP.height,
            left: (previewHeight * 9 / 16 - CARD_DP.width) / 2, top: (previewHeight - CARD_DP.height) / 2,
            transform: [{ scale: previewHeight / CARD_DP.height }],
          }}>
            <ShareCard ref={card} content={content} onReady={capture} />
          </View>
          {!file && <View style={styles.wait}><ActivityIndicator color="#FFFFFF" /></View>}
        </View>
      )}
      <View style={styles.grid}>
        {all.map(ch => {
          const waiting = IMAGE_CHANNELS.includes(ch) && !file && !failed;
          const label = ch === 'copy_link' ? (copied ? t('share.copied') : t('share.copyLink')) : ch === 'share_sheet' ? t('share.more') : LABEL[ch];
          return (
            <TouchableOpacity key={ch} style={[styles.target, waiting && styles.waiting]} onPress={() => go(ch)} disabled={waiting}
                              accessibilityRole="button" accessibilityLabel={label}>
              <TargetIcon channel={ch} copied={copied} />
              <Text style={styles.label} numberOfLines={2}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const BRAND: Partial<Record<ShareChannel, string>> = {
  facebook_story: '#1877F2', whatsapp: '#25D366', messenger: '#0A7CFF', telegram: '#229ED9', x: '#000000',
};
const ICON: Partial<Record<ShareChannel, IconName>> = {
  instagram_story: 'logo-instagram', facebook_story: 'logo-facebook', whatsapp: 'logo-whatsapp', telegram: 'paper-plane',
};
const SIZE = 56;

/** A target's round icon: the app's colours (Instagram's gradient), Copy link and More in the theme. */
function TargetIcon({ channel, copied }: { channel: ShareChannel; copied: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  if (channel === 'copy_link' || channel === 'share_sheet') {
    const name: IconName = channel === 'share_sheet' ? 'ellipsis-horizontal' : copied ? 'checkmark' : 'link-outline';
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
  wait:      { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: c.scrim },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  target:    { width: '25%', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  waiting:   { opacity: 0.4 },
  icon:      { width: SIZE, height: SIZE, borderRadius: Radius.full, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  plain:     { backgroundColor: c.bg3, borderWidth: 1, borderColor: c.line },
  label:     { fontSize: 12, lineHeight: 15, fontWeight: '600', color: c.text, textAlign: 'center' },
});

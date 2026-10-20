import { useState } from 'react';
import { ImageBackground, ScrollView, Text, View, StyleSheet } from 'react-native';
import { type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Screen, ScreenHeader } from '@/ui';
import {
  ACCENTS, AnswerBubble, Confetti, DashedRoute, FlagSticker, HighlightText, JoyButton, Stamp, StickerPop, THEME_COLORS,
  TANGERINE_TEXT, ThemeChipJoy, Wordmark, themeColor,
} from '@/ui/joy';

const THEMES: [string, string][] = [['hidden_gem', 'Hidden gem'], ['taste', 'Taste'], ['ask_local', 'Ask a local'], ['local_find', 'Local find'],
  ['night_out', 'Night out'], ['sip', 'Drinks'], ['only_here', 'Only here']];

/** The joyful design's component gallery (DESIGN.md), light and dark (switch the app theme). Debug only. */
export default function DesignGallery() {
  const styles = useThemedStyles(makeStyles);
  const { colors, theme } = useTheme();
  const [party, setParty] = useState(0);
  return (
    <Screen>
      <ScreenHeader title="Design gallery" />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.h}>Brand line</Text>
        <View style={styles.row}><Wordmark height={30} /><Text style={styles.tag}>Play local. Compare global.</Text></View>

        <Text style={styles.h}>Titles with a key word</Text>
        <HighlightText text="Today around the *world*" style={styles.title} />
        <HighlightText text="Be the *first* to play for Saigon" color={THEME_COLORS.sip.fill} style={styles.title} />
        <HighlightText text="Yesterday around the *world*" color={THEME_COLORS.hidden_gem.fill} style={styles.title} />

        <Text style={styles.h}>Theme colors</Text>
        <View style={styles.wrap}>{THEMES.map(([k, l]) => <ThemeChipJoy key={k} theme={k} label={l} />)}</View>
        <View style={styles.wrap}>
          {THEMES.map(([k, l]) => <Text key={k} style={[styles.colored, { color: theme === 'dark' ? themeColor(k).textDark : themeColor(k).textLight }]}>{l}</Text>)}
        </View>
        <View style={styles.wrap}>{ACCENTS.map(c => <View key={c} style={[styles.swatch, { backgroundColor: c }]} />)}</View>

        <Text style={styles.h}>Buttons</Text>
        <JoyButton label="Play for Saigon" icon="camera-outline" />
        <ImageBackground source={{ uri: 'https://images.unsplash.com/photo-1736944288238-27348f74c1d0?w=900&q=70&fm=jpg' }} style={styles.photo} imageStyle={styles.photoImg}>
          <JoyButton label="Play for Saigon" icon="camera-outline" onPhoto style={styles.onPhotoBtn} />
          <AnswerBubble text="Một, hai, ba, dzô!" onPhoto size="lg" style={styles.photoBubble} />
        </ImageBackground>
        <Text style={[styles.link, { color: theme === 'dark' ? '#FF8A50' : TANGERINE_TEXT }]}>See all ›</Text>

        <Text style={styles.h}>Flag stickers and answer bubbles</Text>
        {[['VN', 'Saigon', 'Một, hai, ba, dzô!'], ['MX', 'Mexico City', '¡Salud!'], ['JP', 'Tokyo', 'Kanpai!'], ['DE', 'Berlin', 'Prost!']].map(([cc, city, a]) => (
          <View key={cc} style={styles.cmpRow}>
            <FlagSticker country={cc} size={30} />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.city}>{city}</Text>
              <AnswerBubble text={a} />
            </View>
            <Text style={styles.price}>Usual price $1.16</Text>
          </View>
        ))}

        <Text style={styles.h}>Stamps</Text>
        <View style={styles.wrap}>{THEMES.map(([k, l], i) => <Stamp key={k} theme={k} label={l} earned={i !== 5} size={60} />)}</View>

        <Text style={styles.h}>Header motif</Text>
        <View style={styles.header}>
          <DashedRoute width={340} height={70} />
          <Text style={styles.screenTitle}>Passport</Text>
        </View>

        <Text style={styles.h}>Victory (tap)</Text>
        <JoyButton label="Celebrate" onPress={() => setParty(p => p + 1)} />
        <View style={styles.party}>
          <Confetti key={party} run={party > 0} />
          <StickerPop key={`s${party}`} play={party > 0}><FlagSticker country="VN" size={64} /></StickerPop>
          <Text style={[styles.title, { color: colors.text }]}>You put Saigon on the map</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  body:      { padding: 16, gap: 12, paddingBottom: 60 },
  h:         { marginTop: 14, fontSize: 12, fontWeight: '800', color: c.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tag:       { fontSize: 13, fontWeight: '500', color: c.muted },
  title:     { fontSize: 19, lineHeight: 26, fontWeight: '800', color: c.text, letterSpacing: -0.3 },
  screenTitle: { fontSize: 28, lineHeight: 34, fontWeight: '800', color: c.text, letterSpacing: -0.3 },
  wrap:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  colored:   { fontSize: 15, fontWeight: '800' },
  swatch:    { width: 36, height: 36, borderRadius: 18 },
  photo:     { height: 240, justifyContent: 'flex-end', padding: 16, gap: 12 },
  photoImg:  { borderRadius: 24 },
  onPhotoBtn: { alignSelf: 'stretch' },
  photoBubble: { position: 'absolute', top: 20, left: 16 },
  link:      { fontSize: 15, fontWeight: '800' },
  cmpRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line },
  city:      { fontSize: 12, fontWeight: '700', color: c.muted },
  price:     { fontSize: 12, fontWeight: '700', color: c.text },
  header:    { height: 70, justifyContent: 'center', paddingHorizontal: 4 },
  party:     { height: 220, alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 20, backgroundColor: c.bg2, overflow: 'hidden' },
});

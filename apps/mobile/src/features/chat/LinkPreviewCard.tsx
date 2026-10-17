import React, { useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { getLinkPreview, type LinkPreview } from '@/lib/linkPreviewCache';
import { type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

interface Props {
  url:    string;
  isMine?: boolean;  // tweak background contrast on sent bubbles
}

// Open Graph card under a chat bubble. Renders nothing while the fetch is in
// flight (no skeleton - polish layer, not core content) and nothing if the URL
// returns no usable OG metadata. Tapping the card opens the original URL.
export function LinkPreviewCard({ url, isMine = false }: Props) {
  const styles = useThemedStyles(makeStyles);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getLinkPreview(url).then((p) => { if (!cancelled) setPreview(p); });
    return () => { cancelled = true; };
  }, [url]);

  if (!preview) return null;

  const onOpen = () => { Linking.openURL(url).catch(() => {}); };

  return (
    <Pressable onPress={onOpen} style={[styles.card, isMine && styles.cardMine]} accessibilityRole="link">
      {preview.image && !imgError && (
        <Image
          source={{ uri: preview.image }}
          style={styles.image}
          onError={() => setImgError(true)}
          // Avoid Expo's default re-decoding - keeps memory bounded for chats
          // with many cards.
          resizeMode="cover"
        />
      )}
      <View style={styles.body}>
        {!!preview.site_name && (
          <Text style={[styles.site, isMine && styles.textMine]} numberOfLines={1}>
            {preview.site_name.toUpperCase()}
          </Text>
        )}
        {!!preview.title && (
          <Text style={[styles.title, isMine && styles.textMine]} numberOfLines={2}>
            {preview.title}
          </Text>
        )}
        {!!preview.description && (
          <Text style={[styles.desc, isMine && styles.textMine]} numberOfLines={2}>
            {preview.description}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:     { marginTop: 6, flexDirection: 'row', borderRadius: 14, overflow: 'hidden', backgroundColor: c.bg2,
              borderWidth: 1, borderColor: c.line, maxWidth: 320, alignSelf: 'stretch' },
  // On the caramel bubble: a slightly darker inset, white text.
  cardMine: { backgroundColor: c.caramel, borderColor: c.onCaramelMuted },
  image:    { width: 80, height: 80, backgroundColor: c.bg3 },
  body:     { flex: 1, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center', gap: 2 },
  site:     { fontSize: 11, fontWeight: '600', letterSpacing: 0.5, color: c.muted },
  title:    { fontSize: 13, fontWeight: '700', color: c.text, lineHeight: 17 },
  desc:     { fontSize: 12, fontWeight: '400', color: c.muted, lineHeight: 16, marginTop: 1 },
  textMine: { color: c.white },
});

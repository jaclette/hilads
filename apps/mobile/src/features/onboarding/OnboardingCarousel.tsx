/**
 * OnboardingCarousel — first-time intro shown ONCE to guests (and re-openable
 * via the header "?"). Registered users never see it (the caller gates on
 * `account`). Lightweight: a paged horizontal ScrollView + dots, no animation
 * libs. The "seen" flag lives in AsyncStorage (see src/lib/onboarding.ts).
 */

import { useRef, useState, useCallback } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView,
  useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, FontSizes, Radius, Spacing } from '@/constants';

interface Slide { emoji: string; title: string; body: string }

function buildSlides(city?: string | null): Slide[] {
  const where = city || 'your city';
  return [
    { emoji: '👋', title: `You're in ${where}`,
      body: "This is your city's live chat. See what's buzzing and say hi." },
    { emoji: '🔥', title: 'Tap NOW',
      body: 'Spontaneous hangouts to jump into right now, plus events planned around you.' },
    { emoji: '👀', title: 'See who’s around',
      body: 'Locals and travelers in your city, live this minute.' },
    { emoji: '✨', title: 'Make it yours',
      body: 'A free account lets you join hangouts, keep your name, add friends & get notified.' },
  ];
}

interface Props {
  visible: boolean;
  city?: string | null;
  onClose: () => void;
}

export function OnboardingCarousel({ visible, city, onClose }: Props) {
  const insets   = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router   = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const slides = buildSlides(city);
  const last   = slides.length - 1;

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex((prev) => (i !== prev ? i : prev));
  }, [width]);

  const goTo = (i: number) => scrollRef.current?.scrollTo({ x: i * width, animated: true });
  // Primary button advances; on the last slide it dismisses (so does Skip).
  const handleNext   = () => (index >= last ? onClose() : goTo(index + 1));
  const handleSignup = () => { onClose(); router.push('/auth-gate'); };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <TouchableOpacity
          style={[styles.skip, { top: insets.top + 8 }]}
          onPress={onClose}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.skipText}>Skip ✕</Text>
        </TouchableOpacity>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScroll}
          style={styles.track}
        >
          {slides.map((s, i) => (
            <View key={i} style={[styles.slide, { width }]}>
              <Text style={styles.emoji}>{s.emoji}</Text>
              <Text style={styles.title}>{s.title}</Text>
              <Text style={styles.body}>{s.body}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={styles.dots}>
            {slides.map((_, i) => (
              <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
            ))}
          </View>

          <TouchableOpacity style={styles.nextBtn} onPress={handleNext} activeOpacity={0.85}>
            <Text style={styles.nextBtnText}>{index >= last ? 'Explore first' : 'Next'}</Text>
          </TouchableOpacity>

          {/* Discreet, low-emphasis signup — present on every screen. */}
          <TouchableOpacity onPress={handleSignup} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.signupLink}>Create an account</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  skip: {
    position: 'absolute',
    right: 14,
    zIndex: 2,
    padding: 8,
  },
  skipText: { color: Colors.muted, fontSize: FontSizes.sm, fontWeight: '700' },

  track: { flex: 1 },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  emoji: { fontSize: 72, lineHeight: 80 },
  title: {
    fontSize: FontSizes.xl,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
  },
  body: {
    fontSize: FontSizes.md,
    lineHeight: 24,
    color: Colors.muted,
    textAlign: 'center',
    maxWidth: 320,
  },

  footer: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: 16,
  },
  dots: { flexDirection: 'row', gap: 8 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.border,
  },
  dotActive: {
    width: 22,
    borderRadius: 4,
    backgroundColor: Colors.accent,
  },

  nextBtn: {
    width: '100%',
    maxWidth: 340,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  nextBtnText: { fontSize: FontSizes.md, fontWeight: '700', color: '#fff' },

  signupLink: {
    fontSize: FontSizes.sm,
    fontWeight: '600',
    color: Colors.muted,
    textDecorationLine: 'underline',
    padding: 4,
  },
});

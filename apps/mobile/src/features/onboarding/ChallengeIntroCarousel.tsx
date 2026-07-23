/**
 * ChallengeIntroCarousel - focused 5-slide explainer of the challenge flow.
 * Triggered from a city-chat feed prompt; re-openable from anywhere. Smaller
 * scope than OnboardingCarousel (no first-time gating, no signup flow), so
 * users can revisit "how does this work" without losing context.
 */

import { useRef, useState, useCallback } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView,
  useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

interface Slide {
  emoji: string;
  title: string;
  body:  string;
}

function buildSlides(t: TFunction): Slide[] {
  return [
    { emoji: '🔥', title: t('challengeIntro.slide1.title'), body: t('challengeIntro.slide1.body') },
    { emoji: '🎯', title: t('challengeIntro.slide2.title'), body: t('challengeIntro.slide2.body') },
    { emoji: '🤝', title: t('challengeIntro.slide3.title'), body: t('challengeIntro.slide3.body') },
    { emoji: '👋', title: t('challengeIntro.slide4.title'), body: t('challengeIntro.slide4.body') },
    { emoji: '✨', title: t('challengeIntro.slide5.title'), body: t('challengeIntro.slide5.body') },
    // International mode (PR13). Sits after the Local flow so the carousel
    // reads "this is how it works in your city, AND beyond it." Spec:
    // "Local or global, every challenge counts."
    { emoji: '🌐', title: t('challengeIntro.slide6.title'), body: t('challengeIntro.slide6.body') },
    // Points / leaderboards. Bookends local + international with the
    // reward layer: every challenge climbs you up TWO monthly boards
    // (your city + worldwide). Surfaces the rank badges + leaderboard
    // surfaces without diving into mechanics; the scoring info modal
    // covers the math.
    { emoji: '🏆', title: t('challengeIntro.slide7.title'), body: t('challengeIntro.slide7.body') },
  ];
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Last-slide CTA hook. When provided, the last slide's button reads
   *  "🔥 Create a challenge" and fires this callback instead of the
   *  default close. The host is responsible for closing the modal +
   *  navigating; we don't auto-close so a router push that fails
   *  doesn't leave the user looking at an empty city chat. */
  onCreateChallenge?: () => void;
}

export function ChallengeIntroCarousel({ visible, onClose, onCreateChallenge }: Props) {
  const styles = useThemedStyles(makeStyles);

  const insets    = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { t }     = useTranslation('common');
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const slides = buildSlides(t);
  const last   = slides.length - 1;
  const isLast = index >= last;

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex((prev) => (i !== prev ? i : prev));
  }, [width]);

  const goTo = (i: number) => scrollRef.current?.scrollTo({ x: i * width, animated: true });
  const handleNext = () => {
    if (!isLast) return goTo(index + 1);
    // Last slide: open the create-challenge screen when a host is wired
    // up, else fall through to plain close (back-compat for callers that
    // don't pass onCreateChallenge yet).
    if (onCreateChallenge) onCreateChallenge();
    else onClose();
  };

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
          <Text style={styles.skipText}>{t('challengeIntro.skip')}</Text>
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
            <Text style={styles.nextBtnText}>
              {isLast
                ? (onCreateChallenge ? t('challengeIntro.createCta') : t('challengeIntro.done'))
                : t('challengeIntro.next')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  skip:      { position: 'absolute', right: 14, zIndex: 2, padding: 8 },
  skipText:  { color: c.muted, fontSize: FontSizes.sm, fontWeight: '700' },

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
    fontSize:   FontSizes.xl,
    fontWeight: '800',
    color:      c.text,
    textAlign:  'center',
  },
  body: {
    fontSize:   FontSizes.md,
    lineHeight: 24,
    color:      c.muted,
    textAlign:  'center',
    maxWidth:   320,
  },

  footer: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: 16,
  },
  dots: { flexDirection: 'row', gap: 8 },
  dot:  { width: 8, height: 8, borderRadius: Radius.full, backgroundColor: c.border },
  dotActive: { width: 22, borderRadius: 4, backgroundColor: c.accent },

  nextBtn: {
    width:           '100%',
    maxWidth:        340,
    paddingVertical: 15,
    borderRadius:    14,
    backgroundColor: c.accent,
    alignItems:      'center',
  },
  nextBtnText: { color: '#fff', fontWeight: '800', fontSize: FontSizes.md },
});

import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Linking } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { requestFeatureLocation } from '@/lib/geoFeature';
import { useApp } from '@/context/AppContext';
import { createTopic, updateTopic } from '@/api/topics';
import { ApiError } from '@/api/client';
import { Border, FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { Button, EmptyState, Screen, ScreenHeader, TextField } from '@/ui';

type TopicCategory = 'general' | 'tips' | 'food' | 'drinks' | 'help' | 'meetup';

const CATEGORIES: TopicCategory[] = ['general', 'tips', 'food', 'drinks', 'help', 'meetup'];

export default function CreateTopicScreen() {
  const styles = useThemedStyles(makeStyles);

  const router   = useRouter();
  const { t } = useTranslation('hangout');
  const { city, identity, account } = useApp();
  // Edit mode when `editId` is passed (owner editing their hangout).
  const params  = useLocalSearchParams<{ editId?: string; title?: string; description?: string; category?: string }>();
  const editId  = typeof params.editId === 'string' ? params.editId : null;

  // The form only asks for the title; category and details pass through
  // unchanged on edit (new hangouts are 'general' with no details).
  const category: TopicCategory = CATEGORIES.includes(params.category as TopicCategory) ? params.category as TopicCategory : 'general';
  const description = typeof params.description === 'string' ? params.description : '';
  const [title,       setTitle]       = useState(typeof params.title === 'string' ? params.title : '');
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  // Set when the server rejects a new hangout because the user already owns one.
  const [limitTopic,  setLimitTopic]  = useState<{ id: string; title: string } | null>(null);

  async function handleSubmit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !city || !identity) return;
    setSubmitting(true);
    setError(null);

    // Edit: PUT the existing hangout (no coords change), then go back.
    if (editId) {
      try {
        await updateTopic(editId, identity.guestId, title.trim(), description.trim() || null, category);
        router.back();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errSave'));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Launching a Hi now REQUIRES precise location - it tells people where to
    // meet you - so we request it here, at launch (not up-front). Block on denial
    // and explain; offer Settings when permission is permanently denied.
    const geo = await requestFeatureLocation('hi_now');
    if (!geo.ok) {
      if (geo.permanentlyDenied) {
        Alert.alert(t('geoRequiredTitle'), t('geoRequiredSettings'), [
          { text: t('cancel', { ns: 'common' }), style: 'cancel' },
          { text: t('openSettings', { ns: 'common' }), onPress: () => Linking.openSettings() },
        ]);
      } else {
        setError(t('geoRequired'));
      }
      setSubmitting(false);
      return;
    }
    const coords = geo.coords!;
    try {
      await createTopic(city.channelId, identity.guestId, trimmedTitle, description.trim() || null, category, coords);
      router.back();
    } catch (err) {
      // One-hangout-per-user: surface the existing hangout instead of an error.
      if (err instanceof ApiError && err.status === 409 && err.body?.error === 'hangout_limit') {
        setLimitTopic({ id: err.body.existingTopicId, title: err.body.existingTitle ?? t('yourHangout') });
      } else {
        setError(err instanceof Error ? err.message : t('errStart'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Guest gate - hosting a hangout requires a registered account ─────────────
  if (!account) {
    router.replace('/auth-gate?reason=create_hangout&returnTo=%2Ftopic%2Fcreate' as never);
    return null;
  }

  // ── One-hangout-per-user - you already have an active hangout. ───────────────
  if (limitTopic) {
    return (
      <Screen>
        <ScreenHeader title={t('limitHeader')} />
        <View style={styles.limitWrap}>
          <EmptyState
            icon="chatbubbles-outline"
            title={t('limitTitle')}
            body={t('limitSub', { title: limitTopic.title })}
            action={<Button label={t('limitGo')} onPress={() => router.replace(`/topic/${limitTopic.id}`)} style={styles.stretch} />}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title={editId ? t('editTitle') : t('startTitle')} />

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
        <TextField
          label={t('titleLabel')}
          value={title}
          onChangeText={setTitle}
          placeholder={t('titlePlaceholder')}
          maxLength={100}
          autoFocus
          returnKeyType="next"
        />

        {/* Expiry note */}
        {!editId ? <Text style={styles.expiryNote}>{t('expiry')}</Text> : null}

        {/* Geo explainer - why turning on location matters. */}
        {!editId ? (
          <View style={styles.geoHint}>
            <Text style={styles.geoHintText}>
              {t('geoHint', { defaultValue: '📍 Turn on location to see who’s around right now — and let nearby people catch your Hi 👀🔥' })}
            </Text>
          </View>
        ) : null}

        {error ? <Text style={styles.errorText} accessibilityRole="alert">{error}</Text> : null}

        <Button
          label={editId ? t('saveChanges') : t('startCta')}
          onPress={handleSubmit}
          loading={submitting}
          disabled={!title.trim()}
        />
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  limitWrap:   { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.lg },
  stretch:     { alignSelf: 'stretch', marginTop: Spacing.sm },
  body:        { flex: 1 },
  bodyContent: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xl * 2 },
  expiryNote:  { fontSize: FontSizes.sm, fontWeight: '500', color: c.muted, textAlign: 'center' },
  geoHint:     { paddingVertical: 12, paddingHorizontal: 14,
                 borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  geoHintText: { fontSize: FontSizes.sm, fontWeight: '600', color: c.text, lineHeight: 19 },
  errorText:   { fontSize: FontSizes.sm, fontWeight: '600', color: c.red, textAlign: 'center' },
});

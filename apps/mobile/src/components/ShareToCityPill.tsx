/**
 * ShareToCityPill - one-tap secondary button (megaphone) that posts this
 * entity's deeplink into the user's current city feed (see useShareToCity).
 * Renders nothing when there's no current city channel to post to.
 */

import type { StyleProp, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useShareToCity } from '@/lib/useShareToCity';
import { Button } from '@/ui';

interface Props {
  url: string;
  /** Entity title, posted after the label above the link for context. */
  title?: string;
  /** Type prefix incl. emoji, e.g. "⚡ Challenge" / "🗣️ Hi now" / "🎉 Hi plan". */
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function ShareToCityPill({ url, title, label, style }: Props) {
  const { t } = useTranslation('common');
  const { canShare, sharing, shareToCity } = useShareToCity();
  if (!canShare) return null;

  const btnLabel = t('shareToCity', { defaultValue: 'Share in my city' });
  // "⚡ Challenge: My title\nhttps://..." - the city feed renders the URL card.
  const head = [label?.trim(), title?.trim()].filter(Boolean).join(': ');
  const message = head ? `${head}\n${url}` : url;
  return (
    <Button
      variant="secondary"
      size="sm"
      icon="megaphone-outline"
      label={btnLabel}
      onPress={() => shareToCity(message)}
      loading={sharing}
      style={style}
    />
  );
}

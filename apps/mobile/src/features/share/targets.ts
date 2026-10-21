import { Linking, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import RNShare, { Social } from 'react-native-share';

/** Where a share went: the utm_source of its link and the `channel` of share_completed. */
export type ShareChannel =
  | 'instagram_story' | 'facebook_story' | 'whatsapp' | 'messenger' | 'telegram' | 'x'
  | 'copy_link' | 'share_sheet';

// Instagram and Facebook Stories need the Meta app's ID: without it, no Story buttons.
const META_APP_ID = process.env.EXPO_PUBLIC_META_APP_ID ?? '';

/**
 * The direct targets, in order. An app shows only when it's installed (iOS:
 * its scheme, listed in LSApplicationQueriesSchemes by the react-native-share
 * plugin in app.json; Android: its package, in the manifest queries). X has
 * no check: without the app, its link opens x.com.
 */
const DIRECT: { channel: ShareChannel; ios: string | null; android: string | null; meta?: boolean }[] = [
  { channel: 'instagram_story', ios: 'instagram-stories://', android: 'com.instagram.android', meta: true },
  { channel: 'facebook_story',  ios: 'facebook-stories://',  android: 'com.facebook.katana', meta: true },
  { channel: 'whatsapp',        ios: 'whatsapp://',          android: 'com.whatsapp' },
  { channel: 'messenger',       ios: 'fb-messenger://',      android: 'com.facebook.orca' },
  { channel: 'telegram',        ios: 'tg://',                android: 'org.telegram.messenger' },
  { channel: 'x',               ios: null,                   android: null },
];

/** Channels that send the card image (the rest send the link, whose preview is the card). */
export const IMAGE_CHANNELS: ShareChannel[] = ['instagram_story', 'facebook_story', 'share_sheet'];

async function installed(ios: string | null, android: string | null): Promise<boolean> {
  try {
    if (Platform.OS === 'ios') return ios ? await Linking.canOpenURL(ios) : true;
    return android ? (await RNShare.isPackageInstalled(android)).isInstalled : true;
  } catch {
    return false;
  }
}

/** The direct targets available on this phone. */
export async function directChannels(): Promise<ShareChannel[]> {
  const targets = DIRECT.filter(d => !d.meta || META_APP_ID);
  const ok = await Promise.all(targets.map(d => installed(d.ios, d.android)));
  return targets.filter((_, i) => ok[i]).map(d => d.channel);
}

/** The link with its utm_source (the channel) and utm_medium=share. */
export function withUtm(url: string, channel: ShareChannel): string {
  return `${url}${url.includes('?') ? '&' : '?'}utm_source=${channel}&utm_medium=share`;
}

/**
 * Shares to one channel: `file` = the card image (a tmp file), `url` the clean
 * link (the channel's UTM is added here), `text` one line without the link.
 * Resolves with whether it went out (as far as the platform says) and, for the
 * system share sheet, the activity picked (iOS activityType / Android package).
 */
export async function shareTo(channel: ShareChannel, { file, url, text }: { file: string | null; url: string; text: string }):
  Promise<{ done: boolean; activity?: string }> {
  const link = withUtm(url, channel);
  switch (channel) {
    case 'instagram_story':
    case 'facebook_story': {
      if (!file) return { done: false };
      if (Platform.OS === 'android') {
        // Android: the card goes to the app itself (a plain image share, read
        // permission granted to it): Instagram offers Story / Feed / Chats,
        // Facebook its composer. The Stories intent depends on the Meta app's
        // Android setup and failed silently (Instagram) or opened a blank story
        // (Facebook) - reported 2026-10-21.
        await RNShare.shareSingle({
          social: channel === 'instagram_story' ? Social.Instagram : Social.Facebook,
          url: file, type: 'image/jpeg', filename: 'hilads', message: link,
        });
        return { done: true };
      }
      await RNShare.shareSingle({
        social: channel === 'instagram_story' ? Social.InstagramStories : Social.FacebookStories,
        appId: META_APP_ID, backgroundImage: file, attributionURL: link,
      });
      return { done: true };
    }
    case 'whatsapp':
      await RNShare.shareSingle({ social: Social.Whatsapp, message: `${text}\n${link}` });
      return { done: true };
    case 'telegram':
      await RNShare.shareSingle({ social: Social.Telegram, message: text, url: link });
      return { done: true };
    case 'messenger':
      await RNShare.shareSingle({ social: Social.Messenger, url: link, message: link });
      return { done: true };
    case 'x':
      await Linking.openURL(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`);
      return { done: true };
    case 'copy_link':
      await Clipboard.setStringAsync(link);
      return { done: true };
    case 'share_sheet': {
      // The card and the line with the link: every other app (Zalo, LINE,
      // KakaoTalk, Snapchat, TikTok, Messages...) picks what it can use.
      const res = await RNShare.open({
        ...(file ? { url: file, type: 'image/jpeg' } : {}),
        message: `${text}\n${link}`,
        failOnCancel: false,
      });
      return { done: !!res.success && !res.dismissedAction, activity: res.message || undefined };
    }
  }
}

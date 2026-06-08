import { Platform, Share } from 'react-native';

/**
 * Platform-aware Share.share wrapper.
 *
 * The bug we're solving:
 *   React Native's Share.share on Android IGNORES the `url` field - only
 *   `message` is sent via Intent.EXTRA_TEXT. If callers concatenate
 *   descriptive text + URL into `message` (the obvious-looking pattern), some
 *   downstream URL parsers - notably WhatsApp's "Copy Link" - capture the
 *   URL with adjacent text into a single broken URL string with %20-encoded
 *   spaces in the path. Recipients tap the link and get a 404.
 *
 *   iOS doesn't have this issue: `url` is a real NSURL field, the share sheet
 *   renders title/url/message as distinct items, and receiving apps resolve
 *   them separately.
 *
 * The fix:
 *   Android - send the URL alone in `message`. The receiving app's URL
 *   preview pulls title/description from the page's Open Graph tags
 *   (M1 prerender + M3 dynamic OG card already supply rich previews).
 *
 *   iOS - keep three separate fields: title, url, and message (descriptive
 *   text WITHOUT the URL).
 *
 * Callers always pass clean inputs: a title, a descriptive message that does
 * NOT contain the URL, and the URL on its own. This helper assembles the
 * correct platform-specific Share.share payload.
 */
export interface ShareLinkInput {
  /** Short, unambiguous title - typically the event/city name. */
  title:   string;
  /** Optional descriptive text. Must NOT contain the URL. iOS only. */
  message: string;
  /** The canonical share URL. Always sent clean, never concatenated with text. */
  url:     string;
}

export async function shareLink({ title, message, url }: ShareLinkInput) {
  if (Platform.OS === 'android') {
    return Share.share({ title, message: url });
  }
  return Share.share({ title, url, message });
}

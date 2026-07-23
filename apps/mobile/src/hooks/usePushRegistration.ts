/**
 * Global push registration hook - always mounted in the root layout.
 *
 * Triggers push token registration whenever an authenticated account becomes
 * available, regardless of HOW it was obtained:
 *   - app boot with a restored session (SecureStore token)
 *   - fresh sign-in
 *   - fresh sign-up
 *
 * This is the canonical push registration trigger. The sign-in/sign-up
 * screen calls are kept as belt-and-suspenders, but this hook is the
 * guarantee that push registration fires for every authenticated user.
 */
import { useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import { requestAndRegisterPush } from '@/services/push';

export function usePushRegistration(): void {
  const { account, identity } = useApp();

  // Prevent re-registering for the same identity within one app session.
  // Keyed by account id (so a logout→login of a different account re-registers)
  // or, for guests, the guest device id (so unregistered installs register too).
  const lastRegisteredFor = useRef<string | null>(null);

  // Fires on mount and whenever account.id changes.
  useEffect(() => {
    const guestId = identity?.guestId ?? null;
    // Registration key: the account when signed in (so a different login
    // re-registers), else the guest device. A signed-in account may prompt for
    // permission (the ask always follows a real action - sign-in/sign-up - or is
    // a no-op for a restored session that already decided). A guest never
    // prompts: we only register a token if permission was already granted, so a
    // first launch never shows an unsolicited system dialog (product rule: no
    // boot prompts). A guest who later grants via a value-first moment gets their
    // token registered then.
    const isAccount = !!account?.id;
    const key = isAccount ? `user:${account!.id}` : (guestId ? `guest:${guestId}` : null);

    // No account and no guest id yet, or already registered this session.
    if (!key || lastRegisteredFor.current === key) return;

    // Always pass guestId so the token row carries the device's guest session
    // (alongside user_id when signed in). `prompt` is only enabled for a signed-in
    // account - guests register silently (already-granted only), never prompting
    // at boot. NOTE: guard is set ONLY after success so a failed attempt retries
    // on the next trigger.
    requestAndRegisterPush(guestId, { prompt: isAccount })
      .then(() => { lastRegisteredFor.current = key; })
      .catch(err => {
        console.warn('[push-reg] registration failed - will retry on next trigger:', String(err));
        // intentionally NOT setting lastRegisteredFor so the next trigger retries
      });
  }, [account?.id, identity?.guestId]);
}

/**
 * Global push registration hook - always mounted in the root layout.
 *
 * Registers the device's push token whenever an account or guest identity
 * becomes available - SILENTLY: it never shows the system permission dialog
 * (AUDIT Q9: ask in context only - after a Daily proof, from the Daily card
 * banner, or after a guest's first message). It registers a token only when
 * permission is already granted. Triggers, regardless of how the account came:
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
    // re-registers), else the guest device. Never prompts (AUDIT Q9): sign-in
    // and sign-up no longer trigger the system dialog; the ask happens in
    // context (askDailyPush / promptPushAfterAction), which registers the token
    // then.
    const isAccount = !!account?.id;
    const key = isAccount ? `user:${account!.id}` : (guestId ? `guest:${guestId}` : null);

    // No account and no guest id yet, or already registered this session.
    if (!key || lastRegisteredFor.current === key) return;

    // Always pass guestId so the token row carries the device's guest session
    // (alongside user_id when signed in). NOTE: guard is set ONLY after success
    // so a failed attempt retries on the next trigger.
    requestAndRegisterPush(guestId, { prompt: false })
      .then(() => { lastRegisteredFor.current = key; })
      .catch(err => {
        console.warn('[push-reg] registration failed - will retry on next trigger:', String(err));
        // intentionally NOT setting lastRegisteredFor so the next trigger retries
      });
  }, [account?.id, identity?.guestId]);
}

/**
 * Client-side mirror of the backend's 1-event-per-day rule.
 *
 * Server is still the source of truth — this util is only used to decide
 * which screen to open when the user taps a "Create event" CTA, so we can
 * skip the form entirely and go straight to the friendly limit screen.
 *
 * Called with the shape returned by GET /users/me/can-create-event.
 */

export function canCreateEventToday({ isLegend, todayCount }) {
  return isLegend || todayCount === 0
}

/**
 * True when the account holds the "Legend" (ambassador) badge. The backend
 * writes `host` into `account.badges` when the user is an ambassador in at
 * least one city — see backend/api/src/UserResource.php.
 */
export function isLegend(account) {
  return !!account?.badges?.includes('host')
}

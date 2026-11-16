/**
 * True when the account holds the "Legend" (ambassador) badge. The backend
 * writes `host` into `account.badges` when the user is an ambassador in at
 * least one city - see backend/api/src/UserResource.php.
 */
export function isLegend(account: { badges?: string[] } | null | undefined): boolean {
  return !!account?.badges?.includes('host');
}

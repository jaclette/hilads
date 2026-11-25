# Hilads back office: admin guide

The back office lives at `https://api.hilads.live/admin` (Render). This guide grows with the redesign; the day-to-day how-tos
(schedule a challenge, moderate a photo, handle a report, run a season) are added in phase 5.

## Signing in

Everyone has their own account: email, password and, for super admins, a code from an authenticator app (2FA).

1. Go to `/admin`, enter your email and password.
2. Enter the 6-digit code from your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).
3. You stay signed in for up to 12 hours, and you're signed out after 2 hours without activity. Deploys no longer sign you out.

5 wrong attempts in 15 minutes (from the same network or on the same email) block sign-in for 15 minutes.

### First time on a new server (no account exists yet)

The old shared login (`ADMIN_USERNAME` / `ADMIN_PASSWORD` on Render) works only while no admin account exists, and only to
create the first one:

1. Run `php migrate.php` in the Render Shell (creates the account tables).
2. Sign in at `/admin` with the shared username and password.
3. Create your own account (name, email, password, at least 12 characters). You are the first super admin.
4. Set up 2FA: scan the QR code, enter one code, then **save the 10 recovery codes** (password manager or printed; not only on the phone).
5. From now on the shared login is refused. You can delete `ADMIN_PASSWORD` from Render's environment.

## Roles

| Role | Can |
|---|---|
| Super admin | Everything: Danger zone, app versions & switches, Settings (admins), Audit log. 2FA required. |
| Moderator | Photos, reports, messages, bans, players, cities, plans, and today's challenge moderation. Sees the rest, can't change it. |
| Content editor | Daily challenges, special days, Hi questions, places, Worlds studio and Promo. Sees the rest, can't change it. |
| Read-only | Sees every page except Settings, Audit log, App versions and the Danger zone. Can't change anything. |

Pages under **Archive** (Old challenges, Campaigns, Arrivals) keep their data and are read-only for everyone.

## Adding a team member

System › Settings › **Add an admin**: name, email, role. You get a temporary password, shown once: send it privately.
They sign in with it, choose their own password, and (super admins) set up 2FA.

On the same page you can change a role, reset someone's password or 2FA, or disable an account (they're signed out at once;
their history stays in the audit log). There is always at least one active super admin.

## Recover access

**Lost your phone, still have a recovery code:** at the code step choose "Use a recovery code" and enter one (each works once).
Then on My account › Two-step verification, make new recovery codes; with a new phone, ask another super admin to reset your
2FA, or use the Render Shell below, and set it up again.

**Lost the phone and the recovery codes, or forgot the password:**

- If another super admin exists: they open Settings, **Reset 2FA** and/or **Reset password** on your row.
- If you're the only super admin: open the Render dashboard › the API service › **Shell**, and run

  ```
  php scripts/admin_recover.php                   # lists the admin accounts
  php scripts/admin_recover.php you@example.com   # resets 2FA, prints a temporary password once
  ```

  Sign in with the temporary password, choose a new one, set up 2FA again and save the new recovery codes.
  This is written to the audit log as "cli". Whoever can open the Render Shell can do this, so keep Render access to the
  people who should be able to recover the back office, with 2FA on the Render account too.

## Danger zone

System › Danger zone (super admins): reset all scores, recalculate every rank, make missing profile thumbnails, and the
places migration. Each one shows what it will touch (counted when the page opens) and only runs after you type its phrase
(for example `RESET ALL SCORES`). The phrase is checked on the server as well.

Other heavy actions stay on their page with the same protection: merging two cities (type the city's name), emailing every
registered user (type `SEND TO EVERYONE`, once a day at most), turning on "Block old apps" (type `BLOCK OLD APPS`), and a
Daily import that replaces days (type `REPLACE`).

## Audit log

System › Audit log (super admins): every change made in the back office, who made it, when, from which IP, and the values
before and after. Filter by person, kind of change, target and dates.

## Environment variables (Render only, never in the repository)

| Variable | Used for |
|---|---|
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | The one-time setup login, only while no admin account exists. Can be removed afterwards. |
| `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_API_HOST` | Dashboard retention (phase 3). A personal API key limited to the Hilads project with the single scope **Query: Read** (`query:read`). `POSTHOG_API_HOST` = the app host (`https://us.posthog.com` or `https://eu.posthog.com`), not the ingestion host. |
| `SENTRY_API_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT_ID` | Dashboard "recent errors" (phase 3). A Sentry personal token with the single scope **event:read**. |

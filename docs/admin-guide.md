# Hilads back office: admin guide

The back office lives at `https://api.hilads.live/admin` (Render). Every page has a short line under its title saying what
it is for, and the complex ones have a "How … works" button at the top right.

**Contents:** signing in · roles · adding a team member · recover access · [the daily routine](#the-daily-routine) ·
[schedule a challenge](#schedule-a-challenge) · [fill a gap](#fill-a-gap) · [moderate photos](#moderate-photos) ·
[handle a report](#handle-a-report) · [ban someone](#ban-someone) · [run a Launch Season](#run-a-launch-season) ·
[send a push](#send-a-push) · [send an email](#send-an-email) · [release a new app version](#release-a-new-app-version) ·
Danger zone · audit log · environment variables

## Where things are

| Sidebar | What you do there |
|---|---|
| Today | The dashboard, the Daily challenges (calendar, today, reserve, proposals, translations, covers, import, history), special days and seasonal events, Hi questions |
| Moderation | Photos, reports (players, chat messages, photo comments), chat messages, bans, arrivals |
| Community | Players, cities, Hi plan & Hi now, places (spots and Hilads picks) |
| Game | Scoring and fair play, Launch Seasons |
| Growth | Push, email, Worlds studio, promo |
| System | App versions & switches, admin accounts, audit log, Danger zone (super admins) |
| Archive | Pages kept for history, read-only |

The search box at the top (or press `/`) finds players (name, @username, email), Daily photos (id or @username) and cities.
The badges in the sidebar count what is waiting: photos to check, open reports, proposals, new cities.

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

Pages under **Archive** (Old challenges, Campaigns) keep their data and are read-only for everyone.

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

## The daily routine

1. Open the **Dashboard**. Look at "Needs attention" first: photos to check, open reports, proposals, new cities.
2. **Today's challenge**: it should say *Published at the drop*, *19 / 19 languages*, a cover, and the morning push sent.
   Anything red or orange links to where you fix it.
3. **Next 7 days**: a red day means nothing is planned. Plan it now (see [Fill a gap](#fill-a-gap)).
4. Clear **Photos › To check** and **Reports** (both explained below).

The drop happens every day at 02:00 UTC (09:00 in Saigon): that is when the day's challenge goes live everywhere.

## Schedule a challenge

1. **Today › Daily challenges › New challenge** (top right).
2. Pick the **date** (only future days), check the **theme** (the weekday's by default; a world special day replaces it),
   write the **challenge in English** (120 characters max) and an optional **context**.
3. Set **Status: Scheduled** (a Draft is never published by the drop) and **Save**.
4. On the challenge page, use the row of buttons at the top to go through each part. Each one shows its state:
   - **Headline**, **Subtitle**, **Share question**: optional short lines; empty means the challenge text is used.
   - **Cover**: upload an image (at least 1200×480). Without one, the theme's default shows.
   - **Comparison question**: every challenge should have one (a word, a short text, a number with a unit, or a time).
   - **Languages**: the challenge in the 18 other languages; it should read *19/19* before the drop.
     Many days at once: **Daily challenges › Translations**.
   - **Local twists**: an extra line for a given city.
5. Check the editorial checklist on the right, then **Send me the morning push** to see it on your phone.

Many days at once: **Daily challenges › Import** takes a JSON file. It always shows a dry run first; nothing changes until
you apply it. An import that *replaces* days asks you to type `REPLACE`.

## Fill a gap

A gap is a coming day with nothing scheduled (red on the dashboard and in the calendar).

- Click the red day (or **Plan it** in the calendar) and schedule a challenge as above.
- Or approve a player's idea in **Daily challenges › Proposals**.
- If a day stays empty, the drop publishes the oldest challenge from the **Reserve**. Keep a few there:
  **Daily challenges › Reserve › New reserve challenge**. The dashboard warns when the reserve is empty.

## Moderate photos

Photos are live as soon as they are posted; **Moderation › Photos** is where you check them afterwards.

- **To check**: everything nobody has looked at yet (reported ones first). Fine ones: tick them and **Mark checked**,
  or press **Fine** on a row.
- **Remove**: takes the photo out of the app at once. A Daily photo also loses its points. It stays listed under **Removed**.
- **Reported**: photos players reported. After 3 reports a photo is hidden until you decide:
  **Keep** dismisses the reports and puts it back, **Remove** takes it out.
- **Today › Daily challenges › Today** also lists the Daily photos waiting for a review, with Approve / Reject
  (the author sees your reason when you reject).

## Handle a report

**Moderation › Reports** has three kinds:

- **Players**: look at the reported player first (their name opens the profile), then
  **Handled** if you acted, **Dismiss** if nothing was wrong, **Ban 7 days** for a guest
  (also blocks the IP addresses of their recent messages). A registered player who breaks the rules:
  open them and **Delete account**.
- **Messages** and **Comments**: after 3 reports they are hidden. **Keep** shows them again, **Remove** deletes them.

## Ban someone

**Moderation › Bans › Ban someone**. Usually "Guest + the IPs they posted from", for 7 days, with a reason
(never shown to the person). Find the guest id on a message or a report. Banning a single IP address blocks everyone
behind it (a café's Wi-Fi too), so keep those short. **Lift** ends a ban at once.

## Run a Launch Season

All in **Game › Seasons**.

1. **Seasons › New season**: name, start date, final-week start, end date and the settings (vote cap, referral, head-start,
   prize thresholds). You can **copy the content** (photos, itinerary, founder word, prize, souvenirs) from an earlier season.
   It starts as a **Draft**: nobody sees it.
2. Fill the prize screen: photos, prize text, sample itinerary, founder word, souvenir prizes (optional).
3. **Rules**: load the full template, adjust it, translate it. The page shows a red DRAFT banner until **Final** is ticked.
4. Want to try it first? Tick **Test season** and add testers: only they see it, and only they get its "is live" push.
5. **Overview › Publish**. Before its start date it shows as a teaser with a countdown and "Notify me";
   at the start everyone who tapped Notify me gets one "Launch Season is live" push.
6. During the season: **Participants**, **Fair play signals** (votes or referrals that look wrong; you can invalidate or
   disqualify). **Pause** hides it if something goes wrong.
7. **Take the head-start now** fixes the final-week head-start from the current ranking (it also happens on its own at the
   final week).
8. After the end: **Winner & export**: the final ranking, contact / confirm / prize-sent dates, the CSV export.
   **End the season** removes it from the app; the rankings stay readable here.

Everything done on a season is in its **History** tab (and in System › Audit log).

## Send a push

**Growth › Push**.

1. Write the **title** (80 characters) and **body** (200 characters).
2. Pick the **audience**: all registered players, all app installs (guests too), old app versions, players active in a city,
   or one player.
3. Optional: a deep link (where the app opens) and a campaign image.
4. Press **Send test** first: it goes only to your own phone (set `ADMIN_TEST_USER_ID` on Render to your player id once).
5. Then **Send**, or pick a date to schedule it. The number of sends per hour is limited. The history at the bottom
   shows each send and how many phones got it. Every send is in the audit log under your name.

## Send an email

**Growth › Email**. Send a test to yourself first (the To field). To email every registered player, tick the box and type
`SEND TO EVERYONE`: each player gets their own copy, nobody sees the others, and it works once a day at most.

## Release a new app version

**System › App versions & switches**: set the **latest** version once it is live in the stores (older apps show a closable
"Update available" banner); raise the **minimum** only when you must (older apps are blocked by an "Update required" screen).
"Block old apps" (1.7.1 and older) asks you to type `BLOCK OLD APPS`.

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
| `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_API_HOST` | Dashboard retention. A personal API key limited to the Hilads project with the single scope **Query: Read** (`query:read`). `POSTHOG_API_HOST` = the app host (`https://us.posthog.com` or `https://eu.posthog.com`), not the ingestion host. |
| `ADMIN_TEST_USER_ID` | Your own player id: test pushes (Push › Send test, a challenge's "Send me the morning push") go to this account's phones. |
| `SENTRY_API_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT_ID` | Dashboard "recent errors". A Sentry personal token with the single scope **event:read**; `SENTRY_ORG` is the organisation slug, `SENTRY_PROJECT_ID` the PHP project's number (optional `SENTRY_API_HOST=https://de.sentry.io` for an EU account). |

# Hilads Mobile

React Native + Expo app for Hilads. Android first, iOS with same codebase.

## Stack

- Expo SDK 52 + React Native
- Expo Router (file-based navigation)
- TypeScript (strict)
- No Redux — React Context only

## Setup

```bash
cd apps/mobile
npm install

cp .env.example .env
# Edit .env: set your machine's LAN IP (not localhost)
# EXPO_PUBLIC_API_URL=http://192.168.x.x:8080
# EXPO_PUBLIC_WS_URL=ws://192.168.x.x:8081
```

## Run

```bash
npm run dev           # Expo Go (fastest for dev)
npm run android       # Android emulator / device
npm run ios           # iOS simulator (Mac only)
```

## Structure

```
app/
  _layout.tsx         Root layout + boot sequence
  (tabs)/
    _layout.tsx       Tab bar (Hot / Cities / Here / Messages / Me)
    hot.tsx           Events happening now
    cities.tsx        City list + switcher
    here.tsx          Online users in city
    messages.tsx      DMs + event chats (auth required)
    me.tsx            Profile + status

src/
  api/                REST API client
    client.ts         Fetch wrapper + token store
    channels.ts       City / presence / messages
    events.ts         Events CRUD + chat
    auth.ts           Auth + profile
    index.ts          Re-exports
  lib/
    identity.ts       Guest UUID + nickname (AsyncStorage)
    socket.ts         WebSocket client with reconnect
  context/
    AppContext.tsx    Global state (identity, city, account)
  hooks/
    useAppBoot.ts     Boot sequence (identity → location → WS)
  components/
    BootScreen.tsx    Splash / error screen
  types/index.ts      Shared TypeScript types
  constants.ts        Colors, API URL, design tokens
```

## Environment variables

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_API_URL` | Backend API base URL (no trailing slash) |
| `EXPO_PUBLIC_WS_URL` | WebSocket server URL |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry DSN for `hilads-mobile` (leave empty locally) |

> Use your machine's LAN IP, not `localhost` — the device/emulator can't reach it.

## Production build (EAS)

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview
```

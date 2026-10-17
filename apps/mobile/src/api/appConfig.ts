import { api } from './client';

/** GET /app/config (V3-04): versions and switches set by the founder on the server. */
export interface AppConfig {
  minVersion:              string | null;
  latestVersion:           string | null;
  storeUrls:               { ios: string; android: string };
  challengeCreationClosed: boolean;
}

export function fetchAppConfig(): Promise<AppConfig> {
  return api.get<AppConfig>('/app/config');
}

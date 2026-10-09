import type { ExpoConfig } from 'expo/config';

// CI sets APP_VERSION / APP_VERSION_CODE from the release tag (see .github/workflows).
export default ({ config }: { config: ExpoConfig }): ExpoConfig => ({
  ...config,
  name: config.name ?? 'GoleSync',
  slug: config.slug ?? 'golesync',
  version: process.env.APP_VERSION ?? config.version,
  android: {
    ...config.android,
    versionCode: Number(process.env.APP_VERSION_CODE ?? config.android?.versionCode ?? 1),
  },
});

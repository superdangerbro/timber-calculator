import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ca.humanesolutions.timber',
  appName: 'Timber Tally',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    backgroundColor: '#0f2a1d',
    // Keep audio session usable for TTS + speech recognition back to back.
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: false,
    },
  },
};

export default config;

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.markped.diasporaradio',
  appName: 'Diaspora Radio',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
  server: {
    allowNavigation: ["*"],
    cleartext: true,
  },
};

export default config;

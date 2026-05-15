import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.cenetex.rubyhigh",
  appName: "Ruby High",
  webDir: "dist-spa",
  bundledWebRuntime: false,
  server: {
    androidScheme: "https",
    iosScheme: "capacitor",
  },
};

export default config;

/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// DriveMaster NG — Unit 0 foundation config.
// Offline-first is a core product requirement (PRD §2, §11), so the PWA
// plugin is wired up here even though no domain workflows exist yet.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "DriveMaster NG",
        short_name: "DriveMaster",
        description: "Offline-first operations app for Nigerian driving schools",
        theme_color: "#0000FF", // Blue primary brand color
        background_color: "#f8fafc", // Tailwind slate-50
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png"
          }
        ]
      },
      workbox: {
        // Precache the app shell only. Data caching is not implemented in
        // Unit 0 — core offline data persistence is Dexie/IndexedDB per
        // PRD §11, handled starting in Unit 1.
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"]
      }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        secure: false
      }
    }
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"]
  }
});

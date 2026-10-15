import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { UserConfig } from 'vite'
import type { InlineConfig as VitestInlineConfig } from 'vitest/node'

// Vitest 3 bundles its own (Vite 7) copy, whose plugin types disagree with the
// Vite 8 this project builds against. To keep a single config file without the
// two Vite type trees clashing, we type Vite's config with Vite 8 and attach
// the `test` block through an intersection type. Vitest reads it at runtime.
type ViteWithTest = UserConfig & { test?: VitestInlineConfig }

const config: ViteWithTest = {
  // Plugin bundles are served from a nested CDN/iframe path, so asset URLs must
  // be relative. Without this, the entry/asset URLs resolve to absolute "/src"
  // paths that don't exist at the iframe's path and the plugin never loads.
  base: './',
  // basicSsl generates a cached self-signed cert so the dev server speaks
  // HTTPS. The SailPoint tenant frames this plugin over HTTPS, and browsers
  // block an HTTP dev server loaded into an HTTPS page as mixed content.
  plugins: [react(), basicSsl()],
  server: {
    // Match build.port in sp-ui-plugin.json so `sail ui-plugins link` (which
    // binds to that port) loads this dev server. strictPort makes Vite fail
    // loudly if 1573 is taken, instead of silently drifting to another port.
    port: 1573,
    strictPort: true,
    // Serve over HTTPS to match the tenant's protocol. An empty object opts
    // in; basicSsl() fills in the self-signed cert/key.
    https: {},
    // The App Shell will only embed a dev server that sends the security
    // headers it expects (the devDocumentHeaders from `sail ui-plugins link`).
    // connect-src must list the tenant API host so the SDK/api-client calls are
    // not blocked by CSP.
    headers: {
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self' https://company24924-poc.api.identitynow-demo.com",
      'Permissions-Policy':
        'accelerometer=(), ambient-light-sensor=(), aria-notify=(), autoplay=(), bluetooth=(), camera=(), captured-surface-control=(), clipboard-read=(), clipboard-write=(), compute-pressure=(), cross-origin-isolated=(), deferred-fetch=(), deferred-fetch-minimal=(), display-capture=(), encrypted-media=(), fullscreen=(), gamepad=(), geolocation=(), gyroscope=(), hid=(), identity-credentials-get=(), idle-detection=(), language-detector=(), local-fonts=(), local-network=(), local-network-access=(), loopback-network=(), magnetometer=(), microphone=(), midi=(), on-device-speech-recognition=(), otp-credentials=(), payment=(), picture-in-picture=(), private-state-token-issuance=(), private-state-token-redemption=(), publickey-credentials-create=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), speaker-selection=(), storage-access=(), summarizer=(), translator=(), usb=(), web-share=(), window-management=(), xr-spatial-tracking=()',
    },
  },
  build: {
    // Split the large third-party libraries into their own chunks so the main
    // app bundle stays small and the charting / API client code can be cached
    // independently. Keeps the "chunk too large" warning at bay.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/recharts')) return 'recharts'
          if (id.includes('node_modules/sailpoint-api-client')) {
            return 'sailpoint-api'
          }
          return undefined
        },
      },
    },
  },
  test: {
    // jsdom gives the component tests a browser-like DOM. The plugin SDK and
    // React Testing Library both expect `window`/`document` to exist.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    server: {
      deps: {
        // The plugin SDK ships extensionless relative ESM imports
        // (e.g. `./public/api.error`). Inlining lets Vite's resolver handle
        // them the same way the production build does, instead of Node's
        // stricter ESM resolution choking in the test runner.
        inline: ['@sailpoint/ui-plugin-sdk'],
      },
    },
  },
}

// https://vite.dev/config/
export default defineConfig(config)

/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_DEVICE_SYNC_KEY?: string
  readonly VITE_BUILD_LABEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Diisi oleh `define` di vite.config.ts dari package.json. */
declare const __APP_VERSION__: string

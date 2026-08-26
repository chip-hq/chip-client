/// <reference types="vite/client" />
/// <reference types="w3c-web-serial" />

// Augments vite/client's ImportMetaEnv with this app's own env var.
interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string
}

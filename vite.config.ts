import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Firebase signInWithPopup polls popup.closed to detect a dismissed window.
    // Without this COOP value Chrome logs "Cross-Origin-Opener-Policy policy would
    // block the window.closed call" on every sign-in. Sign-in still works either
    // way; this just silences the warning. A deployed host needs the same header.
    headers: {
      'Cross-Origin-Opener-Policy': 'unsafe-none',
    },
  },
})

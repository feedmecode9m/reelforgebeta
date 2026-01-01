import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import mkcert from 'vite-plugin-mkcert';

export default defineConfig({
  plugins: [
    svelte(),
    mkcert(), // ✅ Auto HTTPS for localhost
  ],
  server: {
    port: 5173,
    host: true,
    https: true, // ✅ Forces https://localhost:5173
  }
});

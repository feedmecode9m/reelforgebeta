import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

const BACKEND_PORT =
    process.env.BACKEND_PORT ||
    process.env.VITE_BACKEND_PORT ||
    '8080';
const BACKEND_TARGET = `http://127.0.0.1:${BACKEND_PORT}`;
const VITE_ALLOWED_HOSTS = true;

console.log(`[vite] Media/API proxy target: ${BACKEND_TARGET} (/api, /videos, /thumbs)`);
console.info('[VITE_HOST_CONFIG_UPDATED]', {
  allowedHostsConfigured: true,
  targetDomain: '.ngrok-free.app',
  permissiveMode: true
});
console.info('[VITE_HMR_TUNNEL_CONFIGURED]', {
  protocol: 'wss',
  clientPort: 443,
  tunnelStability: true
});

function createProxy(pathPrefix) {
  return {
    target: BACKEND_TARGET,
    changeOrigin: true,
    secure: false,
    ws: pathPrefix === '/api' || pathPrefix === '/admin' || pathPrefix === '/ws',
    configure: (proxy) => {
      const isMedia = pathPrefix === '/videos' || pathPrefix === '/thumbs';
      if (isMedia) {
        proxy.on('proxyReq', (proxyReq) => {
          proxyReq.removeHeader('accept-encoding');
        });
        proxy.on('proxyRes', (proxyRes) => {
          delete proxyRes.headers['content-encoding'];
        });
      }
      proxy.on('error', (err, _req, res) => {
        console.warn(`[vite proxy ${pathPrefix}] Backend unavailable (${err.message}). Is backend running on ${BACKEND_TARGET}?`);
        if (res && !res.headersSent && typeof res.writeHead === 'function') {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Backend unavailable', retryInSeconds: 5 }));
        }
      });
      proxy.on('proxyReq', (_proxyReq, _req, res) => {
        res.on('close', () => {
          if (!res.writableEnded && !res.headersSent) {
            console.warn(`[vite proxy ${pathPrefix}] Connection closed before response`);
          }
        });
      });
    }
  };
}

function requireProductionBackendUrl() {
  return {
    name: 'reelforge-require-backend-url',
    config(_config, { command, mode }) {
      if (command === 'build') {
        const env = loadEnv(mode, process.cwd(), '');
        const url = env.VITE_API_URL || env.VITE_BACKEND_URL || env.VITE_API_BASE_URL;
        if (!url || !String(url).trim()) {
            throw new Error(
                'Production build requires VITE_API_URL (or VITE_BACKEND_URL / VITE_API_BASE_URL). See frontend/.env.example'
            );
        }
      }
    }
  };
}

export default defineConfig({
  plugins: [requireProductionBackendUrl(), svelte()],
  define: {
    'import.meta.env.VITE_BACKEND_PORT': JSON.stringify(BACKEND_PORT),
    __DEPLOY_TIMESTAMP__: JSON.stringify(Date.now())
  },
  server: {
    port: 5173,
    host: 'localhost',
    allowedHosts: VITE_ALLOWED_HOSTS,
    cors: true,
    hmr: {
      protocol: 'wss',
      clientPort: 443,
      overlay: false
    },
    proxy: {
      '/api': createProxy('/api'),
      '/admin': createProxy('/admin'),
      '/health': createProxy('/health'),
      '/ws': createProxy('/ws'),
      '/videos': { ...createProxy('/videos'), timeout: 0 },
      '/thumbs': { ...createProxy('/thumbs'), timeout: 0 },
      '/ingest': createProxy('/ingest')
    }
  },
  preview: {
    allowedHosts: VITE_ALLOWED_HOSTS
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@stores': path.resolve(__dirname, './src/stores'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@assets': path.resolve(__dirname, './src/assets')
    }
  },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash].js`,
        chunkFileNames: `assets/[name]-[hash].js`,
        assetFileNames: `assets/[name]-[hash].[ext]`,
        manualChunks: {
          vendor: ['svelte']
        }
      }
    }
  }
});

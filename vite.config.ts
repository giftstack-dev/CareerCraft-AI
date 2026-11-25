import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {defineConfig} from 'vite';

const frontendDir = path.resolve(__dirname, 'frontend');
const DEFAULT_DEPLOYED_BACKEND_URL = 'https://careercraft-ai-backend-1gec.onrender.com';

function getHtmlInputs() {
  if (!fs.existsSync(frontendDir)) {
    return {};
  }
  const entries: Record<string, string> = {};
  for (const file of fs.readdirSync(frontendDir)) {
    if (file.endsWith('.html')) {
      const name = file.replace(/\.html$/, '');
      entries[name] = path.resolve(frontendDir, file);
    }
  }
  return entries;
}

function getSafePublicRuntimeConfigScript(mode: string): string {
  // Reload .env if present so dev server reflects local updates without exposing secrets.
  dotenv.config({path: path.resolve(__dirname, '.env'), override: false});

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const supabasePublishableKey = (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();

  const envBackendUrl = (process.env.BACKEND_API_URL || process.env.VITE_BACKEND_API_URL || '').trim();
  const cleanEnvBackendUrl = envBackendUrl.startsWith('your_') ? '' : envBackendUrl;
  const apiBaseUrl =
    cleanEnvBackendUrl || (mode === 'production' ? DEFAULT_DEPLOYED_BACKEND_URL : '');

  // Strict allowlist: NEVER include SUPABASE_SECRET_KEY, GEMINI_API_KEY, or FLASK_SECRET_KEY.
  const payload = {
    supabaseUrl: supabaseUrl.startsWith('your_') ? '' : supabaseUrl,
    supabasePublishableKey: supabasePublishableKey.startsWith('your_')
      ? ''
      : supabasePublishableKey,
    apiBaseUrl,
  };

  return `window.__CAREERCRAFT_CONFIG__ = Object.freeze(${JSON.stringify(payload)});\n`;
}

export default defineConfig(({mode}) => {
  dotenv.config({path: path.resolve(__dirname, '.env'), override: false});
  const devProxyTarget =
    (process.env.BACKEND_API_URL || '').trim() || DEFAULT_DEPLOYED_BACKEND_URL;

  return {
    root: frontendDir,
    publicDir: path.resolve(__dirname, 'public'),
    plugins: [
      {
        name: 'careercraft-safe-runtime-config',
        configureServer(server) {
          server.middlewares.use('/runtime-config.js', (_req, res) => {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(getSafePublicRuntimeConfigScript(mode));
          });
        },
        closeBundle(error?: Error): void {
          if (error) return;
          const distDir = path.resolve(__dirname, 'dist');
          if (fs.existsSync(distDir)) {
            fs.writeFileSync(
              path.resolve(distDir, 'runtime-config.js'),
              getSafePublicRuntimeConfigScript(mode),
              'utf-8'
            );
          }
        },
      },
    ],
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
      rollupOptions: {
        input: getHtmlInputs(),
      },
    },
    server: {
      // Proxy /api requests in dev/AI Studio preview cleanly to the Flask backend.
      proxy: {
        '/api': {
          target: devProxyTarget,
          changeOrigin: true,
          secure: true,
        },
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

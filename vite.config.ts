import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {defineConfig} from 'vite';

const frontendDir = path.resolve(__dirname, 'frontend');

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

function getSafePublicRuntimeConfigScript(): string {
  // Reload .env if present so dev server reflects local updates without exposing secrets.
  dotenv.config({path: path.resolve(__dirname, '.env'), override: false});

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const supabasePublishableKey = (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();
  const apiBaseUrl = (process.env.BACKEND_API_URL || 'http://127.0.0.1:5000').trim();

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

export default defineConfig(() => {
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
            res.end(getSafePublicRuntimeConfigScript());
          });
        },
        closeBundle(error?: Error): void {
          if (error) return;
          const distDir = path.resolve(__dirname, 'dist');
          if (fs.existsSync(distDir)) {
            fs.writeFileSync(
              path.resolve(distDir, 'runtime-config.js'),
              getSafePublicRuntimeConfigScript(),
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
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

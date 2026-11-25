import fs from 'fs';
import path from 'path';
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

export default defineConfig(() => {
  return {
    root: frontendDir,
    publicDir: path.resolve(__dirname, 'public'),
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

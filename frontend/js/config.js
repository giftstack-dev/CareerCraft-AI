/**
 * CareerCraft AI — Public Frontend Configuration
 * Loads ONLY public values (Supabase URL, Publishable Key, Backend API URL).
 * Never stores or references SUPABASE_SECRET_KEY, GEMINI_API_KEY, or FLASK_SECRET_KEY.
 */

const initial = window.__CAREERCRAFT_CONFIG__ || {};

export const APP_CONFIG = {
  appName: 'CareerCraft AI',
  apiBaseUrl: initial.apiBaseUrl || 'http://127.0.0.1:5000',
  supabaseUrl: initial.supabaseUrl || '',
  supabasePublishableKey: initial.supabasePublishableKey || '',
};

let configLoaded = false;

export function isSupabasePublicConfigured() {
  return Boolean(
    APP_CONFIG.supabaseUrl &&
      !APP_CONFIG.supabaseUrl.startsWith('your_') &&
      APP_CONFIG.supabasePublishableKey &&
      !APP_CONFIG.supabasePublishableKey.startsWith('your_')
  );
}

/**
 * Ensures public runtime configuration is loaded.
 * Uses Vite-injected /runtime-config.js first, then falls back to Flask GET /api/auth/config.
 */
export async function loadRuntimeConfig() {
  if (isSupabasePublicConfigured() || configLoaded) {
    return APP_CONFIG;
  }

  configLoaded = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);

  try {
    const base = APP_CONFIG.apiBaseUrl.replace(/\/$/, '');
    const resp = await fetch(`${base}/api/auth/config`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (resp.ok) {
      const json = await resp.json();
      if (json && json.success && json.data) {
        if (json.data.supabaseUrl) APP_CONFIG.supabaseUrl = json.data.supabaseUrl;
        if (json.data.supabasePublishableKey) {
          APP_CONFIG.supabasePublishableKey = json.data.supabasePublishableKey;
        }
      }
    }
  } catch {
    // Backend may not be running in static preview; runtime-config.js remains primary source.
  } finally {
    clearTimeout(timer);
  }

  return APP_CONFIG;
}

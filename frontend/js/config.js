/**
 * CareerCraft AI — Public Frontend Configuration
 * Loads ONLY public values (Supabase URL, Publishable Key, Backend API URL).
 * Never stores or references SUPABASE_SECRET_KEY, GEMINI_API_KEY, or FLASK_SECRET_KEY.
 */

const DEFAULT_RENDER_BACKEND_URL = 'https://careercraft-ai-backend-1gec.onrender.com';
const initial = window.__CAREERCRAFT_CONFIG__ || {};

function isLocalHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isLocalUrl(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(String(url || '').trim());
}

function resolveInitialApiBaseUrl() {
  const configured = String(initial.apiBaseUrl || '').trim();
  const host = typeof window !== 'undefined' ? window.location.hostname : '';

  // Never let a build-time localhost fallback leak onto deployed HTTPS hosts (e.g., Netlify).
  if (configured && (!isLocalUrl(configured) || isLocalHostname(host))) {
    return configured.replace(/\/$/, '');
  }

  // In local Vite dev or AI Studio preview (.run.app), use same-origin /api proxy.
  if (isLocalHostname(host) || host.endsWith('.run.app')) {
    return '';
  }

  return DEFAULT_RENDER_BACKEND_URL;
}

export const APP_CONFIG = {
  appName: 'CareerCraft AI',
  apiBaseUrl: resolveInitialApiBaseUrl(),
  supabaseUrl: String(initial.supabaseUrl || '').trim(),
  supabasePublishableKey: String(initial.supabasePublishableKey || '').trim(),
};

let inFlightConfigPromise = null;

export function isSupabasePublicConfigured() {
  return Boolean(
    APP_CONFIG.supabaseUrl &&
      !APP_CONFIG.supabaseUrl.startsWith('your_') &&
      APP_CONFIG.supabasePublishableKey &&
      !APP_CONFIG.supabasePublishableKey.startsWith('your_')
  );
}

async function fetchPublicConfigFromEndpoint(endpointUrl, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(endpointUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!resp.ok) return false;
    const json = await resp.json();
    if (json && json.success && json.data) {
      if (json.data.supabaseUrl) {
        APP_CONFIG.supabaseUrl = String(json.data.supabaseUrl).trim();
      }
      if (json.data.supabasePublishableKey) {
        APP_CONFIG.supabasePublishableKey = String(json.data.supabasePublishableKey).trim();
      }
      return isSupabasePublicConfigured();
    }
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ensures public runtime configuration is loaded.
 * Uses Vite-injected /runtime-config.js first, then falls back to Flask GET /api/auth/config
 * (Render backend primary, with same-origin /api/auth/config proxy fallback).
 */
export async function loadRuntimeConfig() {
  if (isSupabasePublicConfigured()) {
    return APP_CONFIG;
  }

  if (inFlightConfigPromise) {
    return inFlightConfigPromise;
  }

  inFlightConfigPromise = (async () => {
    const base = APP_CONFIG.apiBaseUrl.replace(/\/$/, '');
    const primaryUrl = base ? `${base}/api/auth/config` : '/api/auth/config';

    let ok = await fetchPublicConfigFromEndpoint(primaryUrl, 12000);

    // Retry same-origin /api/auth/config (Netlify proxy) if direct Render request failed
    if (!ok && base) {
      ok = await fetchPublicConfigFromEndpoint('/api/auth/config', 10000);
      if (ok) {
        APP_CONFIG.apiBaseUrl = '';
      }
    }

    // One additional retry in case Render free tier was waking from cold start
    if (!ok) {
      await fetchPublicConfigFromEndpoint(primaryUrl, 15000);
    }

    return APP_CONFIG;
  })();

  try {
    return await inFlightConfigPromise;
  } finally {
    inFlightConfigPromise = null;
  }
}

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

function makeAbortError(message = 'Configuration loading cancelled.') {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function sleepWithSignal(ms, externalSignal) {
  return new Promise((resolve, reject) => {
    if (externalSignal && externalSignal.aborted) {
      reject(makeAbortError());
      return;
    }
    const timer = setTimeout(() => {
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(makeAbortError());
    };
    if (externalSignal) {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function fetchPublicConfigFromEndpoint(endpointUrl, timeoutMs = 25000, externalSignal = null) {
  if (externalSignal && externalSignal.aborted) {
    throw makeAbortError();
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const resp = await fetch(endpointUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
    if (!resp.ok || !contentType.includes('application/json')) {
      return false;
    }
    const json = await resp.json();
    if (json && json.success === true && json.data) {
      if (json.data.supabaseUrl) {
        APP_CONFIG.supabaseUrl = String(json.data.supabaseUrl).trim();
      }
      if (json.data.supabasePublishableKey) {
        APP_CONFIG.supabasePublishableKey = String(json.data.supabasePublishableKey).trim();
      }
      return isSupabasePublicConfigured();
    }
    return false;
  } catch (err) {
    if (externalSignal && externalSignal.aborted) {
      throw makeAbortError();
    }
    if (timedOut) {
      return false;
    }
    if (err && err.name === 'AbortError') {
      throw err;
    }
    return false;
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

function raceWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(makeAbortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(makeAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (val) => {
        signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

/**
 * Ensures public runtime configuration is loaded.
 * Uses build-injected /runtime-config.js first (instant, zero cold-start wait),
 * then falls back to Flask GET /api/auth/config with >60s Render cold-start tolerance.
 */
export async function loadRuntimeConfig(options = {}) {
  const { signal = null, onSlowLoad = null } = options;

  if (isSupabasePublicConfigured()) {
    return APP_CONFIG;
  }
  if (signal && signal.aborted) {
    throw makeAbortError();
  }

  let slowTimer = null;
  if (typeof onSlowLoad === 'function') {
    slowTimer = setTimeout(() => {
      onSlowLoad(
        'Waking up the CareerCraft AI backend service on free hosting (this can take up to 50–60 seconds after inactivity)...'
      );
    }, 5500);
  }

  try {
    if (!inFlightConfigPromise) {
      inFlightConfigPromise = (async () => {
        const base = APP_CONFIG.apiBaseUrl.replace(/\/$/, '');
        const primaryUrl = base ? `${base}/api/auth/config` : '/api/auth/config';

        // Attempt 1: up to 30s for direct wake
        let ok = await fetchPublicConfigFromEndpoint(primaryUrl, 30000);

        // Attempt 2: same-origin Netlify proxy fallback (up to 20s)
        if (!ok && base) {
          ok = await fetchPublicConfigFromEndpoint('/api/auth/config', 20000);
          if (ok) {
            APP_CONFIG.apiBaseUrl = '';
          }
        }

        // Attempt 3: final cold-start wake check (up to 20s)
        if (!ok) {
          await new Promise((r) => setTimeout(r, 1500));
          await fetchPublicConfigFromEndpoint(primaryUrl, 20000);
        }

        return APP_CONFIG;
      })().finally(() => {
        inFlightConfigPromise = null;
      });
    }

    return await raceWithSignal(inFlightConfigPromise, signal);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw err;
    }
    return APP_CONFIG;
  } finally {
    if (slowTimer) clearTimeout(slowTimer);
    if (signal && signal.aborted) {
      // Ensure caller sees cancellation even if in-flight promise settled later
      await sleepWithSignal(0, signal);
    }
  }
}

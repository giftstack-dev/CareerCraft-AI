/**
 * CareerCraft AI — REST API Fetch Client
 */

import { APP_CONFIG, loadRuntimeConfig } from './config.js';

export async function apiRequest(path, options = {}) {
  await loadRuntimeConfig();

  const base = APP_CONFIG.apiBaseUrl.replace(/\/$/, '');
  const primaryUrl = `${base}${path}`;
  const headers = {
    Accept: 'application/json',
    ...(options.body && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(options.headers || {}),
  };

  const executeFetch = async (targetUrl) => {
    const response = await fetch(targetUrl, {
      ...options,
      headers,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const errorMessage =
        (payload && (payload.message || (payload.error && payload.error.message))) ||
        `Request failed with status ${response.status}.`;
      return {
        success: false,
        status: response.status,
        data: null,
        message: errorMessage,
        error: (payload && payload.error) || { code: 'request_failed', message: errorMessage },
      };
    }

    return {
      success: true,
      status: response.status,
      data: payload ? payload.data : null,
      message: payload ? payload.message : 'OK',
      error: null,
    };
  };

  try {
    return await executeFetch(primaryUrl);
  } catch (networkError) {
    // Fallback to same-origin /api proxy if direct cross-origin backend fetch failed (e.g. preview origin)
    if (base && path.startsWith('/api/')) {
      try {
        return await executeFetch(path);
      } catch {
        // Fall through to standard network error envelope below
      }
    }
    return {
      success: false,
      status: 0,
      data: null,
      message:
        'Unable to reach the CareerCraft AI backend service. Check your connection or verify the Flask server is running.',
      error: { code: 'network_error', message: String(networkError) },
    };
  }
}

/**
 * CareerCraft AI — Hardened REST API Fetch Client
 * Supports AbortController cancellation, configurable timeouts, strict JSON envelope validation,
 * slow-request callbacks for Render cold starts, in-flight GET deduplication, and bounded
 * idempotent-only retries.
 */

import { APP_CONFIG, loadRuntimeConfig } from './config.js';

const inFlightGets = new Map();

function isIdempotentMethod(method) {
  const m = String(method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

function defaultTimeoutForPath(path) {
  if (
    path.includes('/generate') ||
    path.includes('/parse') ||
    path.includes('/analyze') ||
    path.includes('/compatibility') ||
    path.includes('/upload')
  ) {
    return 95000;
  }
  return 65000;
}

function isGatewayColdStartStatus(status) {
  return status === 502 || status === 503 || status === 504;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      const err = new Error('Cancelled');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error('Cancelled');
      err.name = 'AbortError';
      reject(err);
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function performSingleFetch(targetUrl, fetchInit, timeoutMs, externalSignal) {
  if (externalSignal && externalSignal.aborted) {
    return {
      success: false,
      status: 0,
      cancelled: true,
      data: null,
      message: 'Request cancelled.',
      error: { code: 'cancelled', message: 'Request cancelled.' },
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onAbort = () => controller.abort();
  if (externalSignal) {
    externalSignal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const response = await fetch(targetUrl, {
      ...fetchInit,
      signal: controller.signal,
    });

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const rawText = await response.text().catch(() => '');
    let payload = null;
    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const gatewayWake = isGatewayColdStartStatus(response.status) && !contentType.includes('application/json');
      const errorMessage = gatewayWake
        ? 'The backend service is currently waking up or temporarily unavailable. Please retry in a few seconds.'
        : (payload && (payload.message || (payload.error && payload.error.message))) ||
          `Request failed with status ${response.status}.`;
      return {
        success: false,
        status: response.status,
        data: null,
        message: errorMessage,
        error: (payload && payload.error) || {
          code: isGatewayColdStartStatus(response.status) ? 'service_waking' : 'request_failed',
          message: errorMessage,
        },
        _retryable: isGatewayColdStartStatus(response.status),
      };
    }

    if (!payload || typeof payload !== 'object' || payload.success !== true) {
      const invalidMsg =
        (payload && (payload.message || (payload.error && payload.error.message))) ||
        'Backend returned an unexpected non-JSON response. Please check service health and retry.';
      return {
        success: false,
        status: response.status,
        data: null,
        message: invalidMsg,
        error: (payload && payload.error) || { code: 'invalid_response', message: invalidMsg },
        _retryable: false,
      };
    }

    return {
      success: true,
      status: response.status,
      data: Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : null,
      message: payload.message || 'OK',
      error: null,
    };
  } catch (err) {
    if (externalSignal && externalSignal.aborted) {
      return {
        success: false,
        status: 0,
        cancelled: true,
        data: null,
        message: 'Request cancelled.',
        error: { code: 'cancelled', message: 'Request cancelled.' },
      };
    }
    if (timedOut || (err && err.name === 'AbortError')) {
      return {
        success: false,
        status: 0,
        timedOut: true,
        data: null,
        message:
          'Request timed out while waiting for the backend service. Free hosting instances can take up to 50–60 seconds to wake after inactivity.',
        error: { code: 'timeout', message: 'Request timed out.' },
        _retryable: true,
      };
    }
    return {
      success: false,
      status: 0,
      data: null,
      message:
        'Unable to reach the CareerCraft AI backend service. Check your connection or retry shortly.',
      error: { code: 'network_error', message: String(err) },
      _retryable: true,
    };
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onAbort);
    }
  }
}

export async function apiRequest(path, options = {}) {
  const {
    timeoutMs = defaultTimeoutForPath(path),
    signal = null,
    onSlowRequest = null,
    dedupeKey = null,
    ...fetchOptions
  } = options;

  const method = String(fetchOptions.method || 'GET').toUpperCase();
  const idempotent = isIdempotentMethod(method);
  const autoDedupeKey = dedupeKey || (idempotent ? `${method}:${path}` : null);

  if (autoDedupeKey && inFlightGets.has(autoDedupeKey) && !signal) {
    return inFlightGets.get(autoDedupeKey);
  }

  const run = async () => {
    let slowTimer = null;
    if (typeof onSlowRequest === 'function') {
      slowTimer = setTimeout(() => {
        onSlowRequest(
          'Backend service is taking longer than expected (free hosting cold start can take up to 50–60s)...'
        );
      }, 5500);
    }

    try {
      try {
        await loadRuntimeConfig({ signal, onSlowLoad: onSlowRequest });
      } catch (cfgErr) {
        if (cfgErr && cfgErr.name === 'AbortError') {
          return {
            success: false,
            status: 0,
            cancelled: true,
            data: null,
            message: 'Request cancelled.',
            error: { code: 'cancelled', message: 'Request cancelled.' },
          };
        }
      }

      const base = APP_CONFIG.apiBaseUrl.replace(/\/$/, '');
      const primaryUrl = `${base}${path}`;
      const headers = {
        Accept: 'application/json',
        ...(fetchOptions.body && !(fetchOptions.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(fetchOptions.headers || {}),
      };
      const fetchInit = { ...fetchOptions, method, headers };

      // First attempt
      const firstResult = await performSingleFetch(primaryUrl, fetchInit, timeoutMs, signal);
      if (firstResult.success || firstResult.cancelled || !idempotent || !firstResult._retryable) {
        delete firstResult._retryable;
        return firstResult;
      }

      // Bounded idempotent retries ONLY (GET/HEAD/OPTIONS) for transient cold-start/network errors
      const retryTargets = [];
      if (base && path.startsWith('/api/')) {
        retryTargets.push({ url: path, delayMs: 1200 });
      }
      retryTargets.push({ url: primaryUrl, delayMs: 3000 });

      let lastResult = firstResult;
      for (const attempt of retryTargets) {
        try {
          await sleep(attempt.delayMs, signal);
        } catch {
          return {
            success: false,
            status: 0,
            cancelled: true,
            data: null,
            message: 'Request cancelled.',
            error: { code: 'cancelled', message: 'Request cancelled.' },
          };
        }
        const retryRes = await performSingleFetch(attempt.url, fetchInit, timeoutMs, signal);
        if (retryRes.success || retryRes.cancelled || !retryRes._retryable) {
          delete retryRes._retryable;
          return retryRes;
        }
        lastResult = retryRes;
      }

      delete lastResult._retryable;
      return lastResult;
    } finally {
      if (slowTimer) clearTimeout(slowTimer);
    }
  };

  const promise = run().finally(() => {
    if (autoDedupeKey && inFlightGets.get(autoDedupeKey) === promise) {
      inFlightGets.delete(autoDedupeKey);
    }
  });

  if (autoDedupeKey && !signal) {
    inFlightGets.set(autoDedupeKey, promise);
  }

  return promise;
}

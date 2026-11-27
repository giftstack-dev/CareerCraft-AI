/**
 * CareerCraft AI — Supabase Auth & Persistent Profile Client
 * Uses @supabase/supabase-js with SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.
 */

import { createClient } from '@supabase/supabase-js';
import { apiRequest } from './api.js';
import { APP_CONFIG, isSupabasePublicConfigured, loadRuntimeConfig } from './config.js';

let supabaseInstance = null;

export async function getSupabaseClient(options = {}) {
  const { signal = null, onSlowLoad = null } = options;
  await loadRuntimeConfig({ signal, onSlowLoad });

  if (!isSupabasePublicConfigured()) {
    return null;
  }

  if (!supabaseInstance) {
    supabaseInstance = createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }

  return supabaseInstance;
}

/**
 * Check server-confirmed email verification timestamps and verified OAuth identities
 * from the Supabase Auth user record returned by supabase.auth.getUser().
 * Never rely on user-editable user_metadata fields.
 */
export function isUserEmailVerified(user) {
  if (!user || typeof user !== 'object') return false;
  if (user.email_confirmed_at || user.confirmed_at) {
    return true;
  }

  const userEmail = String(user.email || '').trim().toLowerCase();
  if (Array.isArray(user.identities)) {
    return user.identities.some((ident) => {
      if (!ident || typeof ident !== 'object') return false;
      const provider = String(ident.provider || '').trim().toLowerCase();
      const identData = ident.identity_data && typeof ident.identity_data === 'object' ? ident.identity_data : {};
      const identEmail = String(identData.email || ident.email || '').trim().toLowerCase();
      return (
        provider === 'google' &&
        identData.email_verified === true &&
        (!userEmail || !identEmail || identEmail === userEmail)
      );
    });
  }

  return false;
}

/**
 * Verifies session against Flask /api/auth/me and initializes user profile.
 * Strictly distinguishes unverified accounts (403 email_not_verified), invalid sessions (401),
 * cancellations, and backend/SDK/database availability errors (503).
 */
export async function syncUserProfile(session, user, options = {}) {
  if (!session || !user) {
    return { errorStatus: 401, errorCode: 'missing_session', message: 'No active session found.' };
  }

  const { signal = null, onSlowLoad = null, timeoutMs = 70000 } = options;

  const apiRes = await apiRequest('/api/auth/me', {
    method: 'GET',
    timeoutMs,
    signal,
    onSlowRequest: onSlowLoad,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (apiRes.cancelled) {
    return {
      errorStatus: 0,
      cancelled: true,
      errorCode: 'cancelled',
      message: apiRes.message || 'Verification cancelled.',
    };
  }

  if (apiRes.success && apiRes.data && apiRes.data.profile) {
    return apiRes.data.profile;
  }

  const errorCode = (apiRes.error && apiRes.error.code) || '';

  if (apiRes.status === 401) {
    return {
      errorStatus: 401,
      errorCode: errorCode || 'invalid_session',
      message: apiRes.message || 'Your session is invalid or has expired. Please sign in again.',
    };
  }

  if (apiRes.status === 403) {
    return {
      errorStatus: 403,
      errorCode: errorCode || 'forbidden',
      message: apiRes.message || 'Access denied for this account.',
    };
  }

  // Read-only RLS profile lookup ONLY if the backend was unreachable (status 0),
  // so existing returning users are not blocked unnecessarily while missing/broken schemas are surfaced accurately.
  if (apiRes.status === 0 && !(signal && signal.aborted)) {
    try {
      const supabase = await getSupabaseClient({ signal });
      if (supabase) {
        const { data: existing, error: selectErr } = await supabase
          .from('profiles')
          .select('id, full_name, email, onboarding_status, onboarding_step, created_at, updated_at')
          .eq('id', user.id)
          .maybeSingle();

        if (!selectErr && existing) {
          return existing;
        }
        if (selectErr && String(selectErr.code || '') === 'PGRST205') {
          return {
            errorStatus: 503,
            errorCode: 'schema_not_initialized',
            message:
              'The Supabase database tables have not been initialized yet. Execute the SQL schema and migrations in Supabase before signing in.',
          };
        }
        if (selectErr) {
          console.warn('[CareerCraft] Direct Supabase profile fallback failed:', selectErr.code || 'unknown_error');
        }
      }
    } catch {
      // Fall through to structured backend unavailable response below
    }
  }

  return {
    errorStatus: apiRes.status || 503,
    errorCode: errorCode || 'backend_unavailable',
    message:
      apiRes.message ||
      'Unable to initialize or load your profile from the CareerCraft AI backend. Please retry shortly.',
  };
}

export async function signOutAndRedirect(redirectUrl = '/login.html?logged_out=1') {
  try {
    const supabase = await getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
  } catch {
    // Proceed to clear local client state and redirect
  }
  sessionStorage.removeItem('cc_pending_verification_email');
  window.location.replace(redirectUrl);
}

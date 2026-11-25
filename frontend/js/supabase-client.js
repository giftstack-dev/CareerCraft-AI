/**
 * CareerCraft AI — Supabase Auth & Persistent Profile Client
 * Uses @supabase/supabase-js with SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.
 */

import { createClient } from '@supabase/supabase-js';
import { apiRequest } from './api.js';
import { APP_CONFIG, isSupabasePublicConfigured, loadRuntimeConfig } from './config.js';

let supabaseInstance = null;

export async function getSupabaseClient() {
  await loadRuntimeConfig();

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
 * Check server-confirmed email verification timestamps from Supabase Auth.
 * Never rely solely on user-editable metadata fields.
 */
export function isUserEmailVerified(user) {
  if (!user) return false;
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

/**
 * Verifies session against Flask /api/auth/me and initializes user profile.
 * Distinguishes auth errors (401/403) from backend/database availability errors.
 */
export async function syncUserProfile(session, user) {
  if (!session || !user) {
    return { errorStatus: 401, errorCode: 'missing_session', message: 'No active session found.' };
  }

  const apiRes = await apiRequest('/api/auth/me', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (apiRes.success && apiRes.data && apiRes.data.profile) {
    return apiRes.data.profile;
  }

  if (apiRes.status === 401 || apiRes.status === 403) {
    return {
      errorStatus: apiRes.status,
      errorCode: (apiRes.error && apiRes.error.code) || 'auth_failed',
      message: apiRes.message,
    };
  }

  // Fallback to direct RLS-enforced Supabase profile query only if backend was temporarily unreachable (status 0)
  if (apiRes.status === 0) {
    const supabase = await getSupabaseClient();
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
    }
  }

  return {
    errorStatus: apiRes.status || 503,
    errorCode: (apiRes.error && apiRes.error.code) || 'backend_unavailable',
    message:
      apiRes.message ||
      'Unable to verify your profile with the CareerCraft AI backend. Please retry shortly.',
  };
}

export async function signOutAndRedirect(redirectUrl = '/login.html?logged_out=1') {
  const supabase = await getSupabaseClient();
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Proceed to clear local client state and redirect
    }
  }
  sessionStorage.removeItem('cc_pending_verification_email');
  window.location.replace(redirectUrl);
}

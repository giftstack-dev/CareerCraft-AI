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

export function isUserEmailVerified(user) {
  if (!user) return false;
  return Boolean(
    user.email_confirmed_at ||
      user.confirmed_at ||
      (user.user_metadata && user.user_metadata.email_verified === true)
  );
}

/**
 * Verifies session against Flask /api/auth/me when backend is online,
 * or falls back cleanly to RLS-protected Supabase profiles table query.
 */
export async function syncUserProfile(session, user) {
  if (!session || !user) return null;

  // 1. Try Flask backend verification + server-side initialization first
  const apiRes = await apiRequest('/api/auth/me', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (apiRes.success && apiRes.data && apiRes.data.profile) {
    return apiRes.data.profile;
  }

  // If backend rejected auth explicitly (401/403), do not bypass
  if (apiRes.status === 401 || apiRes.status === 403) {
    return { errorStatus: apiRes.status, message: apiRes.message };
  }

  // 2. If Flask server is unreachable (e.g., static preview), use RLS-enforced Supabase query
  const supabase = await getSupabaseClient();
  if (!supabase) return null;

  const { data: existing, error: selectErr } = await supabase
    .from('profiles')
    .select('id, full_name, email, onboarding_status, onboarding_step, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle();

  if (selectErr) {
    return null;
  }

  if (existing) {
    return existing;
  }

  const fullName = (user.user_metadata && user.user_metadata.full_name) || '';
  const { data: inserted } = await supabase
    .from('profiles')
    .insert({
      id: user.id,
      email: user.email || '',
      full_name: fullName,
      onboarding_status: 'not_started',
      onboarding_step: 1,
    })
    .select('id, full_name, email, onboarding_status, onboarding_step, created_at, updated_at')
    .single();

  return inserted || null;
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

/**
 * CareerCraft AI — Protected Route Guard & Session Enforcement
 * Guards protected pages (onboarding, dashboard, profile, studio, etc.).
 */

import {
  getSupabaseClient,
  isUserEmailVerified,
  signOutAndRedirect,
  syncUserProfile,
} from './supabase-client.js';

export async function enforceProtectedRoute() {
  const loadingGate = document.getElementById('auth-loading-gate');
  const appShell = document.getElementById('protected-app-shell');

  const supabase = await getSupabaseClient();
  if (!supabase) {
    window.location.replace('/login.html');
    return null;
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const session = sessionData && sessionData.session;

  if (sessionError || !session) {
    const nextPath = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login.html?next=${nextPath}`);
    return null;
  }

  // Always verify user state from Supabase Auth server rather than trusting cached claims alone
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData && userData.user;

  if (userError || !user) {
    await supabase.auth.signOut().catch(() => {});
    window.location.replace('/session-expired.html');
    return null;
  }

  if (!isUserEmailVerified(user)) {
    sessionStorage.setItem('cc_pending_verification_email', user.email || '');
    window.location.replace('/verify-email.html');
    return null;
  }

  const profile = await syncUserProfile(session, user);
  if (profile && profile.errorStatus === 401) {
    await supabase.auth.signOut().catch(() => {});
    window.location.replace('/session-expired.html');
    return null;
  }
  if (profile && profile.errorStatus === 403) {
    window.location.replace('/verify-email.html');
    return null;
  }

  // Subscribe to auth state changes (e.g., sign-out in another tab or expired token)
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      window.location.replace('/login.html?logged_out=1');
    }
  });

  // Wire logout buttons
  document.querySelectorAll('[data-logout-btn]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await signOutAndRedirect('/login.html?logged_out=1');
    });
  });

  if (loadingGate) loadingGate.hidden = true;
  if (appShell) appShell.hidden = false;

  return { supabase, session, user, profile };
}

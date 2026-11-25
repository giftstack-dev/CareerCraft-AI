/**
 * CareerCraft AI — Protected Route Guard, Loading Gate & Error Recovery
 * Guards all protected pages: never renders protected UI before verified auth,
 * always removes loading screen upon success, and provides error/retry state on failure.
 */

import {
  getSupabaseClient,
  isUserEmailVerified,
  signOutAndRedirect,
  syncUserProfile,
} from './supabase-client.js';
import { initWorkspaceShell } from './workspace-shell.js';

function withTimeout(promise, ms, label = 'Request timed out') {
  let timerId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timerId) clearTimeout(timerId);
  });
}

function renderGateError(loadingGate, title, message, showSignIn = true) {
  if (!loadingGate) return;
  loadingGate.hidden = false;
  loadingGate.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'auth-gate-card';

  const heading = document.createElement('h1');
  heading.className = 'card-title';
  heading.textContent = title;

  const copy = document.createElement('p');
  copy.className = 'card-text';
  copy.style.marginBottom = '1.25rem';
  copy.textContent = message;

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '0.75rem';
  actions.style.justifyContent = 'center';
  actions.style.flexWrap = 'wrap';

  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'btn btn-primary';
  retryBtn.textContent = 'Retry';
  retryBtn.addEventListener('click', () => window.location.reload());
  actions.appendChild(retryBtn);

  if (showSignIn) {
    const loginLink = document.createElement('a');
    loginLink.href = '/login.html';
    loginLink.className = 'btn btn-secondary';
    loginLink.textContent = 'Back to Login';
    actions.appendChild(loginLink);
  }

  card.appendChild(heading);
  card.appendChild(copy);
  card.appendChild(actions);
  loadingGate.appendChild(card);
}

export async function enforceProtectedRoute() {
  const loadingGate = document.getElementById('auth-loading-gate');
  const appShell = document.getElementById('protected-app-shell');

  if (appShell) appShell.hidden = true;
  if (loadingGate) loadingGate.hidden = false;

  try {
    const supabase = await withTimeout(
      getSupabaseClient(),
      16000,
      'Loading authentication configuration timed out. The backend service may be waking up.'
    );

    if (!supabase) {
      renderGateError(
        loadingGate,
        'Configuration Unavailable',
        'Could not load Supabase configuration from the backend service. Please retry in a few seconds.'
      );
      return null;
    }

    const { data: sessionData, error: sessionError } = await withTimeout(
      supabase.auth.getSession(),
      12000,
      'Checking your session timed out.'
    );
    const session = sessionData && sessionData.session;

    if (sessionError || !session) {
      const nextPath = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login.html?next=${nextPath}`);
      return null;
    }

    // Verify user state directly against Supabase Auth server
    const { data: userData, error: userError } = await withTimeout(
      supabase.auth.getUser(),
      12000,
      'Verifying your account with Supabase Auth timed out.'
    );
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

    const profile = await withTimeout(
      syncUserProfile(session, user),
      18000,
      'Verifying your profile with the backend timed out.'
    );

    if (profile && profile.errorStatus === 401) {
      await supabase.auth.signOut().catch(() => {});
      window.location.replace('/session-expired.html');
      return null;
    }

    if (profile && profile.errorStatus === 403) {
      sessionStorage.setItem('cc_pending_verification_email', user.email || '');
      window.location.replace('/verify-email.html');
      return null;
    }

    if (profile && profile.errorStatus) {
      renderGateError(
        loadingGate,
        profile.errorCode === 'schema_not_initialized'
          ? 'Database Setup Required'
          : 'Workspace Connection Issue',
        profile.message ||
          'We verified your identity, but could not load your workspace profile from the backend service.'
      );
      return null;
    }

    // Subscribe to auth state changes across tabs
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        window.location.replace('/login.html?logged_out=1');
      }
    });

    // Render consistent 10-item sidebar + mobile drawer + logout handlers
    initWorkspaceShell({ user, profile });

    // Remove loading gate and reveal protected workspace from top of viewport
    if (loadingGate) {
      loadingGate.hidden = true;
      loadingGate.remove();
    }
    if (appShell) {
      appShell.hidden = false;
    }
    window.scrollTo({ top: 0, behavior: 'auto' });

    return { supabase, session, user, profile };
  } catch (err) {
    renderGateError(
      loadingGate,
      'Session Verification Timed Out',
      (err && err.message) ||
        'Could not complete session verification. Check your connection and retry.'
    );
    return null;
  }
}

export { signOutAndRedirect };

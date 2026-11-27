/**
 * CareerCraft AI — Protected Route Guard, Cold-Start Recovery & Loading Gate
 * Guards all protected pages: never renders protected UI before verified auth,
 * tolerates >60s Render free-tier wakes with progressive feedback and cancellation,
 * and always clears the loading gate upon completion or failure.
 */

import {
  getSupabaseClient,
  isUserEmailVerified,
  signOutAndRedirect,
  syncUserProfile,
} from './supabase-client.js';
import { initWorkspaceShell } from './workspace-shell.js';

let authListenerAttached = false;

function withTimeout(promise, ms, label = 'Request timed out', signal = null) {
  let timerId = null;
  let onAbort = null;
  const guardPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(label)), ms);
    if (signal) {
      if (signal.aborted) {
        reject(Object.assign(new Error('Verification cancelled.'), { name: 'AbortError' }));
        return;
      }
      onAbort = () => reject(Object.assign(new Error('Verification cancelled.'), { name: 'AbortError' }));
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  return Promise.race([promise, guardPromise]).finally(() => {
    if (timerId) clearTimeout(timerId);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  });
}

function attachGateCancelControl(loadingGate, controller) {
  if (!loadingGate) return;
  const card = loadingGate.querySelector('.auth-gate-card');
  if (!card || card.querySelector('[data-gate-cancel]')) return;

  const copyEl = card.querySelector('.card-text');
  const btnWrap = document.createElement('div');
  btnWrap.style.marginTop = '1rem';
  btnWrap.style.display = 'flex';
  btnWrap.style.justifyContent = 'center';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary btn-sm';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.setAttribute('data-gate-cancel', '1');
  cancelBtn.addEventListener('click', () => {
    cancelBtn.disabled = true;
    if (copyEl) copyEl.textContent = 'Cancelling verification...';
    controller.abort();
  });

  btnWrap.appendChild(cancelBtn);
  card.appendChild(btnWrap);
}

function updateGateStatus(loadingGate, message) {
  if (!loadingGate || !message) return;
  const copyEl = loadingGate.querySelector('.card-text');
  if (copyEl) {
    copyEl.textContent = message;
  }
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

  const gateController = new AbortController();
  attachGateCancelControl(loadingGate, gateController);

  const onSlowWake = (msg) => updateGateStatus(loadingGate, msg);

  try {
    const supabase = await withTimeout(
      getSupabaseClient({ signal: gateController.signal, onSlowLoad: onSlowWake }),
      72000,
      'Loading authentication configuration timed out while waiting for the backend service. Please retry.',
      gateController.signal
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
      20000,
      'Checking your local session timed out.',
      gateController.signal
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
      20000,
      'Verifying your account with Supabase Auth timed out.',
      gateController.signal
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

    updateGateStatus(loadingGate, 'Synchronizing your verified CareerCraft AI workspace...');

    const profile = await withTimeout(
      syncUserProfile(session, user, {
        signal: gateController.signal,
        onSlowLoad: onSlowWake,
        timeoutMs: 70000,
      }),
      72000,
      'Verifying your profile with the backend service timed out (free hosting cold start may still be waking up). Please retry.',
      gateController.signal
    );

    if (profile && profile.cancelled) {
      renderGateError(
        loadingGate,
        'Verification Cancelled',
        'Session verification was cancelled. Click Retry whenever you are ready to load your workspace.'
      );
      return null;
    }

    if (profile && profile.errorStatus === 401) {
      await supabase.auth.signOut().catch(() => {});
      window.location.replace('/session-expired.html');
      return null;
    }

    if (profile && profile.errorStatus === 403 && profile.errorCode === 'email_not_verified') {
      sessionStorage.setItem('cc_pending_verification_email', user.email || '');
      window.location.replace('/verify-email.html');
      return null;
    }

    if (profile && profile.errorStatus) {
      const errorTitle =
        profile.errorCode === 'schema_not_initialized'
          ? 'Database Setup Required'
          : profile.errorCode === 'supabase_key_error' || profile.errorCode === 'supabase_key_misconfigured'
            ? 'Authentication Key Configuration Issue'
            : profile.errorCode === 'profile_initialization_failed'
              ? 'Profile Initialization Issue'
              : profile.errorStatus === 403
                ? 'Account Access Restricted'
                : 'Workspace Connection Issue';
      renderGateError(
        loadingGate,
        errorTitle,
        profile.message ||
          'We verified your identity, but could not load your workspace profile from the backend service.'
      );
      return null;
    }

    // Subscribe to auth state changes once per page load
    if (!authListenerAttached) {
      authListenerAttached = true;
      supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
          window.location.replace('/login.html?logged_out=1');
        }
      });
    }

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
    if (err && err.name === 'AbortError') {
      renderGateError(
        loadingGate,
        'Verification Cancelled',
        'Workspace verification was cancelled. Click Retry to reconnect.'
      );
      return null;
    }
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

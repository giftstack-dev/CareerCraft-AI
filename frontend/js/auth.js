/**
 * CareerCraft AI — Real Supabase Authentication Workflows
 * Handles Google OAuth, email/password registration, email verification,
 * resend verification, login, forgot password, and password reset with
 * rate-limit cooldown handling.
 */

import {
  getSupabaseClient,
  isUserEmailVerified,
  syncUserProfile,
} from './supabase-client.js';
import { clearAlert, isValidEmail, setFieldError, showAlert } from './utils.js';

const PENDING_EMAIL_KEY = 'cc_pending_verification_email';
const RESEND_COOLDOWN_UNTIL_KEY = 'cc_resend_cooldown_until';
const RESET_COOLDOWN_UNTIL_KEY = 'cc_reset_cooldown_until';
const OAUTH_NEXT_KEY = 'cc_oauth_next_path';
const DEFAULT_EMAIL_COOLDOWN_SEC = 60;

function getMissingConfigMessage() {
  return 'Supabase runtime configuration was not found. Ensure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are set in your environment and restart the server.';
}

function isSafeInternalPath(path) {
  if (!path || typeof path !== 'string') return false;
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return false;
  try {
    const resolved = new URL(path, window.location.origin);
    return resolved.origin === window.location.origin;
  } catch {
    return false;
  }
}

function isRateLimitError(err) {
  if (!err) return false;
  const status = Number(err.status || 0);
  const code = String(err.code || '').toLowerCase();
  const msg = String(err.message || '').toLowerCase();
  return (
    status === 429 ||
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    msg.includes('rate limit') ||
    msg.includes('too many') ||
    msg.includes('only request this after')
  );
}

function parseCooldownSeconds(err, fallback = DEFAULT_EMAIL_COOLDOWN_SEC) {
  const msg = String((err && err.message) || '');
  const match = msg.match(/after\s+(\d+)\s+second/i);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(Math.max(parsed, 15), 300);
    }
  }
  return fallback;
}

async function getSupabaseWithFeedback(alertBox, buttonEl = null, slowMessage = null) {
  let shownSlow = false;
  return getSupabaseClient({
    onSlowLoad: () => {
      if (shownSlow) return;
      shownSlow = true;
      if (buttonEl && !buttonEl.dataset.originalText) {
        buttonEl.dataset.originalText = buttonEl.textContent || '';
      }
      if (buttonEl) {
        buttonEl.textContent = 'Waking backend service...';
      }
      if (alertBox) {
        showAlert(
          alertBox,
          slowMessage ||
            'Waking up the CareerCraft AI backend service on free hosting (this can take up to 50–60 seconds after inactivity)...',
          'info'
        );
      }
    },
  });
}

function formatAuthErrorMessage(err, context = 'auth') {
  const msg = String((err && err.message) || '');
  const lower = msg.toLowerCase();

  if (isRateLimitError(err)) {
    const waitSec = parseCooldownSeconds(err, DEFAULT_EMAIL_COOLDOWN_SEC);
    if (context === 'recovery') {
      return `Too many password recovery emails were requested. Please wait ${waitSec} seconds before requesting another link.`;
    }
    return `Too many verification emails were requested. Please wait ${waitSec} seconds before requesting another email.`;
  }

  if (
    lower.includes('error sending confirmation email') ||
    lower.includes('error sending recovery email') ||
    lower.includes('smtp') ||
    lower.includes('mail')
  ) {
    return 'Unable to send the email right now. Please confirm Brevo custom SMTP settings are active in Supabase Authentication and try again shortly.';
  }

  if (lower.includes('provider is not enabled') || lower.includes('unsupported provider')) {
    return 'Google sign-in is not enabled yet in Supabase Authentication Providers. Please sign in with email and password or enable Google OAuth in Supabase.';
  }

  if (lower.includes('already registered') || lower.includes('already exists')) {
    return 'An account with this email address already exists. Please sign in or reset your password.';
  }

  if (lower.includes('invalid login credentials') || lower.includes('invalid credentials')) {
    return 'Invalid email address or password.';
  }

  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('timed out')) {
    return 'Unable to reach the authentication service. Check your connection and try again.';
  }

  return msg || 'Authentication request failed. Please try again.';
}

function attachPersistedCooldown({ storageKey, button, idleLabel, activePrefix }) {
  if (!button) {
    return { start() {}, stop() {}, isActive: () => false };
  }

  let timerId = null;

  const stop = () => {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    sessionStorage.removeItem(storageKey);
    button.disabled = false;
    button.textContent = idleLabel;
  };

  const runTick = (untilMs) => {
    if (timerId) clearInterval(timerId);
    const update = () => {
      const remaining = Math.ceil((untilMs - Date.now()) / 1000);
      if (remaining <= 0) {
        stop();
        return;
      }
      button.disabled = true;
      button.textContent = `${activePrefix} ${remaining}s`;
    };
    update();
    timerId = setInterval(update, 1000);
  };

  const savedRaw = Number(sessionStorage.getItem(storageKey) || 0);
  if (savedRaw > Date.now()) {
    runTick(savedRaw);
  }

  return {
    start(seconds = DEFAULT_EMAIL_COOLDOWN_SEC, persist = true) {
      const untilMs = Date.now() + Math.max(1, seconds) * 1000;
      if (persist) {
        sessionStorage.setItem(storageKey, String(untilMs));
      }
      runTick(untilMs);
    },
    stop,
    isActive: () => Number(sessionStorage.getItem(storageKey) || 0) > Date.now(),
  };
}

function redirectAfterVerifiedAuth(profile, alertBox) {
  if (profile && profile.errorStatus) {
    if (alertBox) {
      showAlert(
        alertBox,
        profile.message || 'Unable to verify your workspace profile right now. Please try again.',
        'error'
      );
    }
    return false;
  }

  const status = profile && profile.onboarding_status;
  if (status === 'completed' || status === 'skipped') {
    window.location.replace('/dashboard.html');
    return true;
  }
  if (status === 'in_progress' && profile.onboarding_step) {
    window.location.replace(`/onboarding.html?step=${encodeURIComponent(profile.onboarding_step)}`);
    return true;
  }
  window.location.replace('/onboarding.html');
  return true;
}

/* --------------------------------------------------------------------------
   Google OAuth Helper (Shared by login.html & register.html)
   -------------------------------------------------------------------------- */
function initGoogleOAuthButton(alertBox, params) {
  const googleBtn = document.getElementById('google-oauth-btn');
  if (!googleBtn) return;

  const originalHtml = googleBtn.innerHTML;
  let redirecting = false;

  googleBtn.addEventListener('click', async () => {
    if (redirecting) return;
    clearAlert(alertBox);

    redirecting = true;
    googleBtn.disabled = true;
    googleBtn.textContent = 'Connecting to Google...';

    try {
      const supabase = await getSupabaseWithFeedback(alertBox, googleBtn);
      if (!supabase) {
        showAlert(alertBox, getMissingConfigMessage(), 'error');
        return;
      }

      const nextUrl = params ? params.get('next') : '';
      if (isSafeInternalPath(nextUrl)) {
        sessionStorage.setItem(OAUTH_NEXT_KEY, nextUrl);
      } else {
        sessionStorage.removeItem(OAUTH_NEXT_KEY);
      }

      const redirectTo = `${window.location.origin}/auth-callback.html`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account',
          },
        },
      });

      if (error) {
        showAlert(alertBox, formatAuthErrorMessage(error, 'oauth'), 'error');
      }
    } catch (err) {
      showAlert(alertBox, formatAuthErrorMessage(err, 'oauth'), 'error');
    } finally {
      redirecting = false;
      googleBtn.disabled = false;
      googleBtn.innerHTML = originalHtml;
    }
  });
}

/* --------------------------------------------------------------------------
   0. Google OAuth Callback (auth-callback.html)
   -------------------------------------------------------------------------- */
async function initAuthCallbackPage() {
  const section = document.getElementById('auth-callback-section');
  if (!section) return;

  const spinner = document.getElementById('oauth-spinner');
  const heading = document.getElementById('oauth-status-heading');
  const copy = document.getElementById('oauth-status-copy');
  const alertBox = document.getElementById('oauth-alert');
  const fallbackActions = document.getElementById('oauth-fallback-actions');

  const showCallbackError = (title, message) => {
    if (spinner) spinner.hidden = true;
    if (heading) heading.textContent = title;
    if (copy) copy.textContent = 'You can return to the login or registration page to try again.';
    showAlert(alertBox, message, 'error');
    if (fallbackActions) fallbackActions.hidden = false;
  };

  const queryParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const oauthError = queryParams.get('error') || hashParams.get('error');
  const oauthErrorDesc =
    queryParams.get('error_description') || hashParams.get('error_description');
  const code = queryParams.get('code');

  if (oauthError || oauthErrorDesc) {
    window.history.replaceState({}, document.title, window.location.pathname);
    if (String(oauthError || '').toLowerCase() === 'access_denied') {
      showCallbackError(
        'Google sign-in cancelled',
        'Google sign-in was cancelled before completion. Try again or continue with email and password.'
      );
      return;
    }
    showCallbackError(
      'Google sign-in failed',
      oauthErrorDesc || 'Authentication with Google could not be completed. Please try again.'
    );
    return;
  }

  const supabase = await getSupabaseWithFeedback(
    alertBox,
    null,
    'Waking up the CareerCraft AI backend service on free hosting (this can take up to 50–60 seconds after inactivity)...'
  );
  if (!supabase) {
    showCallbackError('Configuration unavailable', getMissingConfigMessage());
    return;
  }

  try {
    let { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    let session = sessionData && sessionData.session;

    if (!session && code) {
      const { data: exchangeData, error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeErr) {
        window.history.replaceState({}, document.title, window.location.pathname);
        showCallbackError(
          'Sign-in link expired',
          exchangeErr.message || 'The Google authentication session could not be verified. Please sign in again.'
        );
        return;
      }
      session = exchangeData && exchangeData.session;
    }

    // Wait briefly for Supabase client URL/hash session detection if not yet resolved
    if (!session) {
      session = await new Promise((resolve) => {
        let settled = false;
        const finish = (sess) => {
          if (settled) return;
          settled = true;
          resolve(sess || null);
        };
        const timer = setTimeout(() => finish(null), 2500);
        const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
          if (nextSession && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED')) {
            clearTimeout(timer);
            if (listener && listener.subscription) listener.subscription.unsubscribe();
            finish(nextSession);
          }
        });
      });
    }

    // Remove OAuth code/fragment from browser history
    if (window.location.search || window.location.hash) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (sessionErr || !session) {
      showCallbackError(
        'No active sign-in session',
        'We could not establish an authenticated Google session. Please try signing in again.'
      );
      return;
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const user = (userData && userData.user) || session.user;
    if (userErr || !user) {
      await supabase.auth.signOut().catch(() => {});
      showCallbackError(
        'Account verification failed',
        'Unable to confirm your identity with Supabase Auth. Please sign in again.'
      );
      return;
    }

    if (!isUserEmailVerified(user)) {
      sessionStorage.setItem(PENDING_EMAIL_KEY, user.email || '');
      window.location.replace('/verify-email.html');
      return;
    }

    if (heading) heading.textContent = 'Preparing your workspace';
    if (copy) copy.textContent = 'Initializing your career profile and checking onboarding status...';

    const profile = await syncUserProfile(session, user, {
      onSlowLoad: () => {
        if (copy) {
          copy.textContent =
            'Waking up the backend service on free hosting (this can take up to 50–60 seconds)...';
        }
      },
    });
    if (profile && profile.errorStatus === 403) {
      sessionStorage.setItem(PENDING_EMAIL_KEY, user.email || '');
      window.location.replace('/verify-email.html');
      return;
    }
    if (profile && profile.errorStatus) {
      showCallbackError(
        profile.errorCode === 'schema_not_initialized'
          ? 'Database setup required'
          : 'Profile synchronization issue',
        profile.message || 'Signed in with Google, but we could not load your profile. Please retry.'
      );
      return;
    }

    const storedNext = sessionStorage.getItem(OAUTH_NEXT_KEY);
    sessionStorage.removeItem(OAUTH_NEXT_KEY);
    if (isSafeInternalPath(storedNext)) {
      window.location.replace(storedNext);
      return;
    }

    redirectAfterVerifiedAuth(profile, alertBox);
  } catch (err) {
    showCallbackError(
      'Sign-in error',
      formatAuthErrorMessage(err, 'oauth')
    );
  }
}

/* --------------------------------------------------------------------------
   1. Registration (register.html)
   -------------------------------------------------------------------------- */
function initRegisterPage() {
  const form = document.getElementById('register-form');
  if (!form) return;

  const alertBox = document.getElementById('auth-alert');
  const submitBtn = document.getElementById('register-submit');
  const params = new URLSearchParams(window.location.search);
  let submitting = false;

  initGoogleOAuthButton(alertBox, params);

  // Pre-warm public Supabase config in background while user completes form
  getSupabaseClient().catch(() => {});

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    clearAlert(alertBox);

    const nameInput = document.getElementById('full-name');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const confirmInput = document.getElementById('confirm-password');
    const termsInput = document.getElementById('accept-terms');

    const nameErr = document.getElementById('full-name-error');
    const emailErr = document.getElementById('email-error');
    const passErr = document.getElementById('password-error');
    const confirmErr = document.getElementById('confirm-password-error');
    const termsErr = document.getElementById('terms-error');

    const fullName = nameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const confirmPassword = confirmInput.value;

    setFieldError(nameInput, nameErr, '');
    setFieldError(emailInput, emailErr, '');
    setFieldError(passwordInput, passErr, '');
    setFieldError(confirmInput, confirmErr, '');
    setFieldError(termsInput, termsErr, '');

    let valid = true;
    if (fullName.length < 2) {
      setFieldError(nameInput, nameErr, 'Please enter your full name.');
      valid = false;
    }
    if (!isValidEmail(email)) {
      setFieldError(emailInput, emailErr, 'Please enter a valid email address.');
      valid = false;
    }
    if (password.length < 8) {
      setFieldError(passwordInput, passErr, 'Password must be at least 8 characters long.');
      valid = false;
    }
    if (password !== confirmPassword) {
      setFieldError(confirmInput, confirmErr, 'Passwords do not match.');
      valid = false;
    }
    if (!termsInput.checked) {
      setFieldError(termsInput, termsErr, 'You must accept the Terms of Use and Privacy Policy.');
      valid = false;
    }

    if (!valid) return;

    submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating Account...';

    try {
      const supabase = await getSupabaseWithFeedback(alertBox, submitBtn);
      if (!supabase) {
        showAlert(alertBox, getMissingConfigMessage(), 'error');
        return;
      }

      const emailRedirectTo = `${window.location.origin}/verify-email.html`;
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo,
        },
      });

      if (error) {
        if (isRateLimitError(error)) {
          const waitSec = parseCooldownSeconds(error, DEFAULT_EMAIL_COOLDOWN_SEC);
          sessionStorage.setItem(RESEND_COOLDOWN_UNTIL_KEY, String(Date.now() + waitSec * 1000));
        }
        showAlert(alertBox, formatAuthErrorMessage(error, 'registration'), 'error');
        return;
      }

      // Supabase returns empty identities array when email already exists and confirmation is enabled
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        showAlert(
          alertBox,
          'An account with this email address already exists. Try signing in, using Continue with Google, or requesting a password reset.',
          'info'
        );
        return;
      }

      sessionStorage.setItem(PENDING_EMAIL_KEY, email);

      // If Supabase returned an already-confirmed active session
      if (data.session && isUserEmailVerified(data.user)) {
        const profile = await syncUserProfile(data.session, data.user, {
          onSlowLoad: () => {
            showAlert(
              alertBox,
              'Account verified! Initializing your workspace while the backend finishes waking up...',
              'info'
            );
          },
        });
        redirectAfterVerifiedAuth(profile, alertBox);
        return;
      }

      sessionStorage.setItem(
        RESEND_COOLDOWN_UNTIL_KEY,
        String(Date.now() + DEFAULT_EMAIL_COOLDOWN_SEC * 1000)
      );
      window.location.replace('/verify-email.html?sent=1');
    } catch (err) {
      showAlert(alertBox, formatAuthErrorMessage(err, 'registration'), 'error');
    } finally {
      submitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Free Account';
    }
  });
}

/* --------------------------------------------------------------------------
   2. Email Verification & Resend (verify-email.html)
   -------------------------------------------------------------------------- */
async function initVerifyEmailPage() {
  const container = document.getElementById('verify-email-section');
  if (!container) return;

  const alertBox = document.getElementById('verify-alert');
  const statusHeading = document.getElementById('verify-heading');
  const statusCopy = document.getElementById('verify-subtitle');
  const resendForm = document.getElementById('resend-form');
  const resendEmailInput = document.getElementById('resend-email');
  const resendBtn = document.getElementById('resend-submit');
  const resendErr = document.getElementById('resend-email-error');

  const pendingEmail = sessionStorage.getItem(PENDING_EMAIL_KEY) || '';
  if (resendEmailInput && pendingEmail) {
    resendEmailInput.value = pendingEmail;
  }

  const cooldown = attachPersistedCooldown({
    storageKey: RESEND_COOLDOWN_UNTIL_KEY,
    button: resendBtn,
    idleLabel: 'Resend Verification Email',
    activePrefix: 'Resend available in',
  });

  const supabase = await getSupabaseWithFeedback(alertBox, null);
  if (!supabase) {
    showAlert(alertBox, getMissingConfigMessage(), 'error');
    return;
  }

  const queryParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));

  const linkError =
    queryParams.get('error_description') ||
    hashParams.get('error_description') ||
    queryParams.get('error') ||
    hashParams.get('error');

  if (linkError) {
    showAlert(
      alertBox,
      'Your verification link is invalid or has expired. Enter your email below to request a new link.',
      'error'
    );
  } else if (queryParams.get('sent') === '1') {
    showAlert(
      alertBox,
      pendingEmail
        ? `A verification email has been sent to ${pendingEmail}. Click the link in your inbox to activate your account.`
        : 'A verification email has been sent to your inbox. Click the link in the email to activate your account.',
      'info'
    );
    if (!cooldown.isActive()) {
      cooldown.start(DEFAULT_EMAIL_COOLDOWN_SEC);
    }
  }

  // Complete token_hash or PKCE code verification if present in URL
  const tokenHash = queryParams.get('token_hash');
  const type = queryParams.get('type') || 'signup';
  const code = queryParams.get('code');

  try {
    if (tokenHash) {
      statusHeading.textContent = 'Verifying your email...';
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) {
        showAlert(
          alertBox,
          'This verification link has expired or is invalid. Please request a fresh verification email below.',
          'error'
        );
        statusHeading.textContent = 'Verify your email address';
      }
    }

    let { data: sessionData } = await supabase.auth.getSession();
    let session = sessionData && sessionData.session;

    if (!session && code) {
      statusHeading.textContent = 'Verifying your email...';
      const { data: exchangeData, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        showAlert(
          alertBox,
          'This verification link has expired or was already used. Request a new link or try signing in.',
          'error'
        );
        statusHeading.textContent = 'Verify your email address';
      } else if (exchangeData && exchangeData.session) {
        session = exchangeData.session;
      }
    }

    if (session) {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData && userData.user;
      if (user && isUserEmailVerified(user)) {
        sessionStorage.removeItem(PENDING_EMAIL_KEY);
        sessionStorage.removeItem(RESEND_COOLDOWN_UNTIL_KEY);
        statusHeading.textContent = 'Email verified';
        statusCopy.textContent = 'Initializing your career profile and checking onboarding status...';
        const profile = await syncUserProfile(session, user, {
          onSlowLoad: () => {
            statusCopy.textContent =
              'Waking up the backend service on free hosting (this can take up to 50–60 seconds)...';
          },
        });
        if (profile && profile.errorStatus) {
          showAlert(
            alertBox,
            profile.message || 'Your email is verified, but we could not initialize your profile in Supabase. Please sign in or retry.',
            'error'
          );
          statusHeading.textContent = 'Profile initialization issue';
          return;
        }
        showAlert(alertBox, 'Your email address has been verified. Redirecting...', 'success');
        setTimeout(() => {
          redirectAfterVerifiedAuth(profile, alertBox);
        }, 500);
        return;
      }
    }
  } catch (err) {
    showAlert(alertBox, formatAuthErrorMessage(err, 'verification'), 'error');
  }

  if (resendForm) {
    resendForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (cooldown.isActive()) return;
      clearAlert(alertBox);
      setFieldError(resendEmailInput, resendErr, '');

      const email = resendEmailInput.value.trim();
      if (!isValidEmail(email)) {
        setFieldError(resendEmailInput, resendErr, 'Please enter a valid email address.');
        return;
      }

      resendBtn.disabled = true;
      resendBtn.textContent = 'Sending...';

      try {
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/verify-email.html`,
          },
        });

        if (error) {
          showAlert(alertBox, formatAuthErrorMessage(error, 'resend'), 'error');
          if (isRateLimitError(error)) {
            cooldown.start(parseCooldownSeconds(error, DEFAULT_EMAIL_COOLDOWN_SEC));
          } else {
            resendBtn.disabled = false;
            resendBtn.textContent = 'Resend Verification Email';
          }
          return;
        }

        sessionStorage.setItem(PENDING_EMAIL_KEY, email);
        showAlert(
          alertBox,
          `Verification link sent to ${email}. Please check your inbox and spam folder.`,
          'success'
        );
        cooldown.start(DEFAULT_EMAIL_COOLDOWN_SEC);
      } catch {
        showAlert(alertBox, 'Network error while resending verification email.', 'error');
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend Verification Email';
      }
    });
  }
}

/* --------------------------------------------------------------------------
   3. Login (login.html)
   -------------------------------------------------------------------------- */
async function initLoginPage() {
  const form = document.getElementById('login-form');
  if (!form) return;

  const alertBox = document.getElementById('auth-alert');
  const submitBtn = document.getElementById('login-submit');
  const params = new URLSearchParams(window.location.search);

  initGoogleOAuthButton(alertBox, params);

  if (params.get('logged_out') === '1') {
    showAlert(alertBox, 'You have been signed out securely.', 'info');
  } else if (params.get('reset') === 'success') {
    showAlert(alertBox, 'Your password has been updated. Sign in with your new password.', 'success');
  } else if (params.get('expired') === '1') {
    showAlert(alertBox, 'Your session expired. Please sign in again.', 'info');
  }

  const supabase = await getSupabaseWithFeedback(alertBox, null);
  if (supabase) {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData && sessionData.session) {
      const { data: userData } = await supabase.auth.getUser().catch(() => ({ data: null }));
      const verifiedUser = userData && userData.user;
      if (verifiedUser && isUserEmailVerified(verifiedUser)) {
        const profile = await syncUserProfile(sessionData.session, verifiedUser, {
          onSlowLoad: () => {
            showAlert(
              alertBox,
              'Waking up the backend service on free hosting to restore your session (up to 50–60s)...',
              'info'
            );
          },
        });
        if (profile && !profile.errorStatus) {
          const nextUrl = params.get('next');
          if (isSafeInternalPath(nextUrl)) {
            window.location.replace(nextUrl);
          } else {
            redirectAfterVerifiedAuth(profile, alertBox);
          }
          return;
        }
      }
    }
  }

  let submitting = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    clearAlert(alertBox);

    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const emailErr = document.getElementById('email-error');
    const passErr = document.getElementById('password-error');

    setFieldError(emailInput, emailErr, '');
    setFieldError(passwordInput, passErr, '');

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    let valid = true;
    if (!isValidEmail(email)) {
      setFieldError(emailInput, emailErr, 'Please enter a valid email address.');
      valid = false;
    }
    if (!password) {
      setFieldError(passwordInput, passErr, 'Please enter your password.');
      valid = false;
    }

    if (!valid) return;

    submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing In...';

    try {
      const client = await getSupabaseWithFeedback(alertBox, submitBtn);
      if (!client) {
        showAlert(alertBox, getMissingConfigMessage(), 'error');
        return;
      }

      const { data, error } = await client.auth.signInWithPassword({ email, password });

      if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
          sessionStorage.setItem(PENDING_EMAIL_KEY, email);
          showAlert(
            alertBox,
            'Your email address has not been verified yet. Redirecting to the email verification page...',
            'error'
          );
          setTimeout(() => {
            window.location.href = '/verify-email.html';
          }, 1200);
          return;
        }
        if (isRateLimitError(error)) {
          showAlert(
            alertBox,
            'Too many sign-in attempts in a short time. Please wait a minute and try again.',
            'error'
          );
          return;
        }
        showAlert(alertBox, formatAuthErrorMessage(error, 'login'), 'error');
        return;
      }

      const { data: userData } = await client.auth.getUser();
      const verifiedUser = (userData && userData.user) || data.user;
      if (!data.session || !verifiedUser || !isUserEmailVerified(verifiedUser)) {
        sessionStorage.setItem(PENDING_EMAIL_KEY, email);
        await client.auth.signOut();
        showAlert(alertBox, 'Please verify your email address before signing in.', 'error');
        setTimeout(() => {
          window.location.href = '/verify-email.html';
        }, 1200);
        return;
      }

      const profile = await syncUserProfile(data.session, verifiedUser, {
        onSlowLoad: () => {
          submitBtn.textContent = 'Waking backend...';
          showAlert(
            alertBox,
            'Signed in! Waking up the CareerCraft AI backend service on free hosting (this can take up to 50–60 seconds)...',
            'info'
          );
        },
      });
      if (profile && profile.errorStatus === 403) {
        window.location.replace('/verify-email.html');
        return;
      }
      if (profile && profile.errorStatus) {
        showAlert(
          alertBox,
          profile.message || 'Sign-in succeeded, but we could not load your database profile. Please retry.',
          'error'
        );
        return;
      }

      const nextUrl = params.get('next');
      if (isSafeInternalPath(nextUrl)) {
        window.location.replace(nextUrl);
      } else {
        redirectAfterVerifiedAuth(profile, alertBox);
      }
    } catch (err) {
      showAlert(alertBox, formatAuthErrorMessage(err, 'login'), 'error');
    } finally {
      submitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  });
}

/* --------------------------------------------------------------------------
   4. Forgot Password (forgot-password.html)
   -------------------------------------------------------------------------- */
function initForgotPasswordPage() {
  const form = document.getElementById('forgot-password-form');
  if (!form) return;

  const alertBox = document.getElementById('auth-alert');
  const submitBtn = form.querySelector('button[type="submit"]');
  let submitting = false;

  const cooldown = attachPersistedCooldown({
    storageKey: RESET_COOLDOWN_UNTIL_KEY,
    button: submitBtn,
    idleLabel: 'Send Recovery Link',
    activePrefix: 'Wait',
  });

  getSupabaseClient().catch(() => {});

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || cooldown.isActive()) return;
    clearAlert(alertBox);

    const emailInput = document.getElementById('email');
    const emailErr = document.getElementById('email-error');
    setFieldError(emailInput, emailErr, '');

    const email = emailInput.value.trim();
    if (!isValidEmail(email)) {
      setFieldError(emailInput, emailErr, 'Please enter a valid email address.');
      return;
    }

    submitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending Link...';
    }

    let cooldownStarted = false;
    try {
      const supabase = await getSupabaseWithFeedback(alertBox, submitBtn);
      if (!supabase) {
        showAlert(alertBox, getMissingConfigMessage(), 'error');
        return;
      }

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password.html`,
      });

      if (error) {
        showAlert(alertBox, formatAuthErrorMessage(error, 'recovery'), 'error');
        if (isRateLimitError(error)) {
          cooldown.start(parseCooldownSeconds(error, DEFAULT_EMAIL_COOLDOWN_SEC));
          cooldownStarted = true;
        }
        return;
      }

      showAlert(
        alertBox,
        'If an account exists for that email address, a password recovery link has been sent. Please check your inbox and spam folder.',
        'success'
      );
      form.reset();
      cooldown.start(DEFAULT_EMAIL_COOLDOWN_SEC);
      cooldownStarted = true;
    } catch (err) {
      showAlert(alertBox, formatAuthErrorMessage(err, 'recovery'), 'error');
    } finally {
      submitting = false;
      if (submitBtn && !cooldownStarted && !cooldown.isActive()) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Recovery Link';
      }
    }
  });
}

/* --------------------------------------------------------------------------
   5. Password Reset (reset-password.html)
   -------------------------------------------------------------------------- */
async function initResetPasswordPage() {
  const form = document.getElementById('reset-password-form');
  if (!form) return;

  const alertBox = document.getElementById('reset-alert');
  const submitBtn = document.getElementById('reset-submit');
  const supabase = await getSupabaseWithFeedback(alertBox, null);

  if (!supabase) {
    showAlert(alertBox, getMissingConfigMessage(), 'error');
    submitBtn.disabled = true;
    return;
  }

  const queryParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const linkError =
    queryParams.get('error_description') ||
    hashParams.get('error_description') ||
    queryParams.get('error') ||
    hashParams.get('error');

  if (linkError) {
    showAlert(
      alertBox,
      'Your password reset link is invalid or has expired. Request a new recovery link.',
      'error'
    );
    submitBtn.disabled = true;
    return;
  }

  const tokenHash = queryParams.get('token_hash');
  const code = queryParams.get('code');

  if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
    if (error) {
      showAlert(alertBox, 'This password reset link has expired or is invalid.', 'error');
      submitBtn.disabled = true;
      return;
    }
  }

  let { data: sessionData } = await supabase.auth.getSession();
  if ((!sessionData || !sessionData.session) && code) {
    const { data: exchangeData, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      showAlert(alertBox, 'This password reset link has expired or was already used.', 'error');
      submitBtn.disabled = true;
      return;
    }
    sessionData = exchangeData;
  }

  if (!sessionData || !sessionData.session) {
    showAlert(
      alertBox,
      'No active password recovery session was found. Please open the link from your recovery email or request a new one.',
      'error'
    );
    submitBtn.disabled = true;
    return;
  }

  let submitting = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    clearAlert(alertBox);

    const passInput = document.getElementById('new-password');
    const confirmInput = document.getElementById('confirm-new-password');
    const passErr = document.getElementById('new-password-error');
    const confirmErr = document.getElementById('confirm-new-password-error');

    setFieldError(passInput, passErr, '');
    setFieldError(confirmInput, confirmErr, '');

    const newPassword = passInput.value;
    const confirmPassword = confirmInput.value;

    let valid = true;
    if (newPassword.length < 8) {
      setFieldError(passInput, passErr, 'New password must be at least 8 characters long.');
      valid = false;
    }
    if (newPassword !== confirmPassword) {
      setFieldError(confirmInput, confirmErr, 'Passwords do not match.');
      valid = false;
    }
    if (!valid) return;

    submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Updating Password...';

    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        showAlert(alertBox, error.message || 'Unable to update password.', 'error');
        return;
      }

      sessionStorage.removeItem(RESET_COOLDOWN_UNTIL_KEY);
      await supabase.auth.signOut();
      window.location.replace('/login.html?reset=success');
    } catch {
      showAlert(alertBox, 'Network error while updating password.', 'error');
    } finally {
      submitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Update Password';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initAuthCallbackPage();
  initRegisterPage();
  initVerifyEmailPage();
  initLoginPage();
  initForgotPasswordPage();
  initResetPasswordPage();
});

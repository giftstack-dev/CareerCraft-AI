/**
 * CareerCraft AI — Real Supabase Authentication Workflows
 * Handles registration, email verification, resend verification, login,
 * forgot password, and password reset.
 */

import {
  getSupabaseClient,
  isUserEmailVerified,
  syncUserProfile,
} from './supabase-client.js';
import { clearAlert, isValidEmail, setFieldError, showAlert } from './utils.js';

const PENDING_EMAIL_KEY = 'cc_pending_verification_email';

function getMissingConfigMessage() {
  return 'Supabase runtime configuration was not found. Ensure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are set in your environment and restart the server.';
}

function redirectAfterVerifiedAuth(profile) {
  const status = profile && profile.onboarding_status;
  if (status === 'completed' || status === 'skipped') {
    window.location.replace('/dashboard.html');
  } else {
    window.location.replace('/onboarding.html');
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
  let submitting = false;

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
      const supabase = await getSupabaseClient();
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
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('already registered') || msg.includes('already exists')) {
          showAlert(
            alertBox,
            'An account with this email address already exists. Please sign in or reset your password.',
            'error'
          );
        } else {
          showAlert(alertBox, error.message || 'Unable to create account right now.', 'error');
        }
        return;
      }

      // Supabase returns empty identities array when email already exists and confirmation is enabled
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        showAlert(
          alertBox,
          'An account with this email address may already exist. Try signing in or requesting a password reset.',
          'info'
        );
        return;
      }

      sessionStorage.setItem(PENDING_EMAIL_KEY, email);

      // If Supabase returned an already-confirmed active session (when confirmation disabled)
      if (data.session && isUserEmailVerified(data.user)) {
        const profile = await syncUserProfile(data.session, data.user);
        redirectAfterVerifiedAuth(profile);
        return;
      }

      window.location.replace('/verify-email.html?sent=1');
    } catch {
      showAlert(
        alertBox,
        'Unable to connect to the authentication service. Please check your connection and try again.',
        'error'
      );
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

  const supabase = await getSupabaseClient();
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
    } else if (code) {
      statusHeading.textContent = 'Verifying your email...';
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        showAlert(
          alertBox,
          'This verification link has expired or was already used. Request a new link or try signing in.',
          'error'
        );
        statusHeading.textContent = 'Verify your email address';
      }
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData && sessionData.session;
    if (session) {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData && userData.user;
      if (user && isUserEmailVerified(user)) {
        sessionStorage.removeItem(PENDING_EMAIL_KEY);
        statusHeading.textContent = 'Email verified';
        statusCopy.textContent = 'Initializing your career profile and redirecting to onboarding...';
        showAlert(alertBox, 'Your email address has been verified. Redirecting to onboarding...', 'success');
        await syncUserProfile(session, user);
        setTimeout(() => {
          window.location.replace('/onboarding.html');
        }, 700);
        return;
      }
    }
  } catch {
    showAlert(alertBox, 'Unable to verify your email link. Please try requesting a new verification email.', 'error');
  }

  // Resend verification email with 60-second cooldown
  if (resendForm) {
    let cooldownTimer = null;

    const startCooldown = (seconds = 60) => {
      let remaining = seconds;
      resendBtn.disabled = true;
      resendBtn.textContent = `Resend available in ${remaining}s`;
      cooldownTimer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(cooldownTimer);
          resendBtn.disabled = false;
          resendBtn.textContent = 'Resend Verification Email';
        } else {
          resendBtn.textContent = `Resend available in ${remaining}s`;
        }
      }, 1000);
    };

    resendForm.addEventListener('submit', async (event) => {
      event.preventDefault();
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
          showAlert(alertBox, error.message || 'Unable to resend verification email right now.', 'error');
          resendBtn.disabled = false;
          resendBtn.textContent = 'Resend Verification Email';
          return;
        }

        sessionStorage.setItem(PENDING_EMAIL_KEY, email);
        showAlert(
          alertBox,
          `Verification link sent to ${email}. Please check your inbox and spam folder.`,
          'success'
        );
        startCooldown(60);
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

  if (params.get('logged_out') === '1') {
    showAlert(alertBox, 'You have been signed out securely.', 'info');
  } else if (params.get('reset') === 'success') {
    showAlert(alertBox, 'Your password has been updated. Sign in with your new password.', 'success');
  } else if (params.get('expired') === '1') {
    showAlert(alertBox, 'Your session expired. Please sign in again.', 'info');
  }

  const supabase = await getSupabaseClient();
  if (supabase) {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData && sessionData.session && isUserEmailVerified(sessionData.session.user)) {
      const profile = await syncUserProfile(sessionData.session, sessionData.session.user);
      redirectAfterVerifiedAuth(profile);
      return;
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
      const client = await getSupabaseClient();
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
        showAlert(alertBox, 'Invalid email address or password.', 'error');
        return;
      }

      if (!data.session || !data.user || !isUserEmailVerified(data.user)) {
        sessionStorage.setItem(PENDING_EMAIL_KEY, email);
        await client.auth.signOut();
        showAlert(alertBox, 'Please verify your email address before signing in.', 'error');
        setTimeout(() => {
          window.location.href = '/verify-email.html';
        }, 1200);
        return;
      }

      const profile = await syncUserProfile(data.session, data.user);
      if (profile && profile.errorStatus === 403) {
        window.location.replace('/verify-email.html');
        return;
      }

      const nextUrl = params.get('next');
      if (nextUrl && nextUrl.startsWith('/') && !nextUrl.startsWith('//')) {
        window.location.replace(nextUrl);
      } else {
        redirectAfterVerifiedAuth(profile);
      }
    } catch {
      showAlert(alertBox, 'Unable to reach the authentication service. Please try again.', 'error');
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

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
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

    try {
      const supabase = await getSupabaseClient();
      if (!supabase) {
        showAlert(alertBox, getMissingConfigMessage(), 'error');
        return;
      }

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password.html`,
      });

      if (error) {
        showAlert(alertBox, error.message || 'Unable to send recovery email right now.', 'error');
        return;
      }

      showAlert(
        alertBox,
        'If an account exists for that email address, a password recovery link has been sent. Please check your inbox.',
        'success'
      );
      form.reset();
    } catch {
      showAlert(alertBox, 'Network error while requesting password recovery.', 'error');
    } finally {
      submitting = false;
      if (submitBtn) {
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
  const supabase = await getSupabaseClient();

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
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      showAlert(alertBox, 'This password reset link has expired or was already used.', 'error');
      submitBtn.disabled = true;
      return;
    }
  }

  const { data: sessionData } = await supabase.auth.getSession();
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
  initRegisterPage();
  initVerifyEmailPage();
  initLoginPage();
  initForgotPasswordPage();
  initResetPasswordPage();
});

/**
 * CareerCraft AI — Public Authentication Form Handler (Phase 1 Validation + Phase 2 Readiness)
 * Enforces real client-side validation and prevents fake local authentication.
 */

import { isSupabasePublicConfigured } from './config.js';
import { clearAlert, isValidEmail, setFieldError, showAlert } from './utils.js';

function handleRegisterForm() {
  const form = document.getElementById('register-form');
  if (!form) return;

  const alertBox = document.getElementById('auth-alert');
  const submitBtn = document.getElementById('register-submit');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
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

    let valid = true;
    const fullName = nameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const confirmPassword = confirmInput.value;

    setFieldError(nameInput, nameErr, '');
    setFieldError(emailInput, emailErr, '');
    setFieldError(passwordInput, passErr, '');
    setFieldError(confirmInput, confirmErr, '');
    setFieldError(termsInput, termsErr, '');

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

    if (!isSupabasePublicConfigured()) {
      showAlert(
        alertBox,
        'Account registration requires Supabase Auth configuration (Phase 2). Configure SUPABASE_URL and SUPABASE_ANON_KEY to enable live email verification and sign-up.',
        'info'
      );
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating Account...';
  });
}

function handleLoginForm() {
  const form = document.getElementById('login-form');
  if (!form) return;

  const alertBox = document.getElementById('auth-alert');
  const submitBtn = document.getElementById('login-submit');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearAlert(alertBox);

    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const emailErr = document.getElementById('email-error');
    const passErr = document.getElementById('password-error');

    setFieldError(emailInput, emailErr, '');
    setFieldError(passwordInput, passErr, '');

    let valid = true;
    if (!isValidEmail(emailInput.value.trim())) {
      setFieldError(emailInput, emailErr, 'Please enter a valid email address.');
      valid = false;
    }
    if (!passwordInput.value) {
      setFieldError(passwordInput, passErr, 'Please enter your password.');
      valid = false;
    }

    if (!valid) return;

    if (!isSupabasePublicConfigured()) {
      showAlert(
        alertBox,
        'Sign-in requires Supabase Auth configuration (Phase 2). Configure SUPABASE_URL and SUPABASE_ANON_KEY to authenticate verified accounts.',
        'info'
      );
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing In...';
  });
}

function handleForgotPasswordForm() {
  const form = document.getElementById('forgot-password-form');
  if (!form) return;

  const alertBox = document.getElementById('auth-alert');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearAlert(alertBox);

    const emailInput = document.getElementById('email');
    const emailErr = document.getElementById('email-error');
    setFieldError(emailInput, emailErr, '');

    if (!isValidEmail(emailInput.value.trim())) {
      setFieldError(emailInput, emailErr, 'Please enter a valid email address.');
      return;
    }

    if (!isSupabasePublicConfigured()) {
      showAlert(
        alertBox,
        'Password recovery emails require Supabase Auth configuration (Phase 2).',
        'info'
      );
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  handleRegisterForm();
  handleLoginForm();
  handleForgotPasswordForm();
});

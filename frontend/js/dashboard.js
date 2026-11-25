/**
 * CareerCraft AI — Protected Dashboard Controller (Phase 2 Verified Identity & Persistence)
 */

import { enforceProtectedRoute } from './route-guard.js';

document.addEventListener('DOMContentLoaded', async () => {
  const ctx = await enforceProtectedRoute();
  if (!ctx) return;

  const { user, profile } = ctx;
  const fullName =
    (profile && profile.full_name) ||
    (user.user_metadata && user.user_metadata.full_name) ||
    '';
  const firstName = fullName ? fullName.split(/\s+/)[0] : 'there';

  const welcomeEl = document.getElementById('welcome-heading');
  const headerUserEl = document.getElementById('header-user-name');
  const profileNameEl = document.getElementById('account-full-name');
  const profileEmailEl = document.getElementById('account-email');
  const emailVerifiedEl = document.getElementById('account-verified-status');
  const onboardingStatusEl = document.getElementById('account-onboarding-status');

  if (welcomeEl) welcomeEl.textContent = `Welcome back, ${firstName}`;
  if (headerUserEl) headerUserEl.textContent = fullName || user.email || 'Account';
  if (profileNameEl) profileNameEl.textContent = fullName || 'Not set';
  if (profileEmailEl) profileEmailEl.textContent = user.email || '';
  if (emailVerifiedEl) emailVerifiedEl.textContent = 'Verified';
  if (onboardingStatusEl) {
    onboardingStatusEl.textContent = (profile && profile.onboarding_status) || 'not_started';
  }
});

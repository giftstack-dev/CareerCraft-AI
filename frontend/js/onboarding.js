/**
 * CareerCraft AI — Phase 2 Onboarding Foundation Controller
 * Verifies authenticated profile persistence and onboarding status updates.
 */

import { apiRequest } from './api.js';
import { enforceProtectedRoute } from './route-guard.js';
import { clearAlert, setFieldError, showAlert } from './utils.js';

async function updateOnboardingStatus(supabase, session, userId, status, fullName) {
  // Update profile full_name & status directly via RLS and/or backend API
  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: fullName,
      onboarding_status: status,
    })
    .eq('id', userId);

  if (error) {
    // Also attempt backend endpoint if direct update failed
    const res = await apiRequest('/api/auth/onboarding-status', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ onboarding_status: status }),
    });
    if (!res.success) {
      throw new Error(res.message || 'Unable to save onboarding status.');
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const ctx = await enforceProtectedRoute();
  if (!ctx) return;

  const { supabase, session, user, profile } = ctx;
  const fullNameInput = document.getElementById('onboarding-full-name');
  const emailDisplay = document.getElementById('onboarding-email');
  const statusDisplay = document.getElementById('onboarding-status-text');
  const userNameHeader = document.getElementById('header-user-name');
  const alertBox = document.getElementById('onboarding-alert');
  const form = document.getElementById('onboarding-form');
  const skipBtn = document.getElementById('skip-onboarding-btn');
  const saveBtn = document.getElementById('complete-onboarding-btn');
  const nameErr = document.getElementById('onboarding-name-error');

  const resolvedName =
    (profile && profile.full_name) ||
    (user.user_metadata && user.user_metadata.full_name) ||
    '';

  if (fullNameInput) fullNameInput.value = resolvedName;
  if (emailDisplay) emailDisplay.textContent = user.email || '';
  if (statusDisplay) statusDisplay.textContent = (profile && profile.onboarding_status) || 'not_started';
  if (userNameHeader) userNameHeader.textContent = resolvedName || user.email || 'Account';

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearAlert(alertBox);
      setFieldError(fullNameInput, nameErr, '');

      const updatedName = fullNameInput.value.trim();
      if (updatedName.length < 2) {
        setFieldError(fullNameInput, nameErr, 'Please enter your full name.');
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        await updateOnboardingStatus(supabase, session, user.id, 'completed', updatedName);
        await supabase.auth.updateUser({ data: { full_name: updatedName } });
        showAlert(alertBox, 'Account details saved to Supabase. Redirecting to your dashboard...', 'success');
        setTimeout(() => {
          window.location.replace('/dashboard.html');
        }, 600);
      } catch (err) {
        showAlert(alertBox, err.message || 'Unable to save onboarding details.', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save & Continue to Dashboard';
      }
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener('click', async () => {
      clearAlert(alertBox);
      skipBtn.disabled = true;
      try {
        const currentName = (fullNameInput && fullNameInput.value.trim()) || resolvedName;
        await updateOnboardingStatus(supabase, session, user.id, 'skipped', currentName);
        window.location.replace('/dashboard.html');
      } catch (err) {
        showAlert(alertBox, err.message || 'Unable to update onboarding status.', 'error');
        skipBtn.disabled = false;
      }
    });
  }
});

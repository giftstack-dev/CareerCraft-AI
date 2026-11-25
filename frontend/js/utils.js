/**
 * CareerCraft AI — Shared UI, Navigation, and Validation Utilities
 */

export function initMobileNavigation() {
  const toggleBtn = document.getElementById('mobile-menu-toggle');
  const drawer = document.getElementById('mobile-drawer');
  if (!toggleBtn || !drawer) return;

  toggleBtn.addEventListener('click', () => {
    const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
    toggleBtn.setAttribute('aria-expanded', String(!isExpanded));
    drawer.classList.toggle('is-open', !isExpanded);
  });

  // Close drawer on Escape key
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawer.classList.contains('is-open')) {
      toggleBtn.setAttribute('aria-expanded', 'false');
      drawer.classList.remove('is-open');
      toggleBtn.focus();
    }
  });
}

export function initPasswordToggles() {
  const toggleButtons = document.querySelectorAll('[data-password-toggle]');
  toggleButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-password-toggle');
      const input = targetId ? document.getElementById(targetId) : null;
      if (!input) return;

      const isHidden = input.getAttribute('type') === 'password';
      input.setAttribute('type', isHidden ? 'text' : 'password');
      btn.textContent = isHidden ? 'Hide' : 'Show';
      btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
    });
  });
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

export function showAlert(container, message, variant = 'info') {
  if (!container) return;
  container.className = `alert alert-${variant}`;
  container.textContent = message;
  container.hidden = false;
}

export function clearAlert(container) {
  if (!container) return;
  container.hidden = true;
  container.textContent = '';
}

export function setFieldError(inputEl, errorEl, message) {
  if (inputEl) {
    inputEl.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  if (errorEl) {
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initMobileNavigation();
  initPasswordToggles();
});

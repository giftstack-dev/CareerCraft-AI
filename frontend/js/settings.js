/**
 * CareerCraft AI — Settings, Daily AI Quota, Notifications & Account Deletion Controller
 */

import { enforceProtectedRoute, signOutAndRedirect } from './route-guard.js';
import { clearAlert, showAlert } from './utils.js';
import { authApiRequest, clearContainer, el, formatDateTime, statusBadgeClass } from './workspace-utils.js';

document.addEventListener('DOMContentLoaded', async () => {
  const ctx = await enforceProtectedRoute();
  if (!ctx) return;

  const { supabase, session, user, profile } = ctx;
  const alertBox = document.getElementById('settings-alert');

  document.getElementById('settings-full-name').textContent = (profile && profile.full_name) || 'Not set';
  document.getElementById('settings-email').textContent = user.email || '';
  document.getElementById('settings-onboarding').textContent = (profile && profile.onboarding_status) || 'not_started';

  async function loadUsage() {
    const res = await authApiRequest(session, '/api/usage', { method: 'GET' });
    if (!res.success || !res.data) return;

    const { daily_limit, used_today, reset_schedule, recent_records } = res.data;
    document.getElementById('usage-count-badge').textContent = `${used_today} / ${daily_limit} today`;
    document.getElementById('usage-reset-note').textContent = `${reset_schedule}. Free CareerCraft AI usage safeguard.`;
    const pct = daily_limit > 0 ? Math.min(Math.round((used_today / daily_limit) * 100), 100) : 0;
    document.getElementById('usage-progress-fill').style.width = `${pct}%`;

    const list = document.getElementById('usage-recent-list');
    clearContainer(list);
    if (!recent_records || recent_records.length === 0) {
      list.appendChild(el('p', { className: 'card-text', textContent: 'No AI preparation operations recorded yet.' }));
      return;
    }
    recent_records.slice(0, 5).forEach((rec) => {
      list.appendChild(
        el('div', { className: 'record-item' }, [
          el('div', {}, [
            el('strong', { textContent: String(rec.operation_type || '').replace(/_/g, ' ') }),
            el('p', { className: 'card-text', textContent: formatDateTime(rec.created_at) }),
          ]),
          el('span', { className: statusBadgeClass(rec.request_status), textContent: rec.request_status }),
        ])
      );
    });
  }

  async function loadNotifications() {
    const res = await authApiRequest(session, '/api/notifications', { method: 'GET' });
    const list = document.getElementById('notifications-list');
    clearContainer(list);
    if (!res.success || !res.data) {
      list.appendChild(el('p', { className: 'card-text', textContent: 'Unable to load notifications.' }));
      return;
    }

    const items = res.data.items || [];
    if (items.length === 0) {
      list.appendChild(el('p', { className: 'card-text', textContent: 'No activity notifications yet.' }));
      return;
    }

    items.slice(0, 10).forEach((notif) => {
      list.appendChild(
        el('div', { className: 'record-item' }, [
          el('div', {}, [
            el('strong', { textContent: notif.message }),
            el('p', { className: 'card-text', textContent: formatDateTime(notif.created_at) }),
          ]),
          notif.is_read
            ? el('span', { className: 'status-badge', textContent: 'Read' })
            : el('button', {
                type: 'button',
                className: 'btn btn-secondary btn-sm',
                textContent: 'Mark Read',
                onClick: async () => {
                  await authApiRequest(session, `/api/notifications/${notif.id}/read`, { method: 'PUT' });
                  await loadNotifications();
                },
              }),
        ])
      );
    });
  }

  document.getElementById('mark-all-read-btn').addEventListener('click', async () => {
    await authApiRequest(session, '/api/notifications/read-all', { method: 'POST' });
    await loadNotifications();
  });

  document.getElementById('password-update-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert(alertBox);
    const pw = document.getElementById('new-password-input').value;
    const confirm = document.getElementById('confirm-password-input').value;
    if (pw.length < 8) {
      return showAlert(alertBox, 'New password must be at least 8 characters.', 'error');
    }
    if (pw !== confirm) {
      return showAlert(alertBox, 'Passwords do not match.', 'error');
    }
    const btn = document.getElementById('password-update-btn');
    btn.disabled = true;
    const { error } = await supabase.auth.updateUser({ password: pw });
    btn.disabled = false;
    if (error) return showAlert(alertBox, error.message, 'error');
    e.target.reset();
    showAlert(alertBox, 'Password updated successfully.', 'success');
  });

  document.getElementById('delete-account-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert(alertBox);
    const confirmation = document.getElementById('delete-confirm-input').value.trim();
    if (confirmation !== 'DELETE') {
      return showAlert(alertBox, 'Please type DELETE in uppercase to confirm account deletion.', 'error');
    }
    const btn = document.getElementById('delete-account-btn');
    btn.disabled = true;
    btn.textContent = 'Deleting Account...';

    const res = await authApiRequest(session, '/api/account/delete', {
      method: 'POST',
      body: JSON.stringify({ confirmation }),
    });
    if (!res.success) {
      btn.disabled = false;
      btn.textContent = 'Permanently Delete Account';
      return showAlert(alertBox, res.message || 'Account deletion failed.', 'error');
    }
    await signOutAndRedirect('/login.html');
  });

  await Promise.all([loadUsage(), loadNotifications()]);
});

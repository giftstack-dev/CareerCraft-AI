/**
 * CareerCraft AI — Protected Dashboard Controller
 * Fetches real aggregated user metrics, profile completion, interviews, and activity from /api/dashboard.
 */

import { enforceProtectedRoute } from './route-guard.js';
import { showAlert } from './utils.js';
import {
  authApiRequest,
  clearContainer,
  el,
  formatDateTime,
  formatShortDate,
  statusBadgeClass,
} from './workspace-utils.js';

function renderEmpty(container, message, ctaLabel, ctaHref) {
  clearContainer(container);
  const box = el('div', { className: 'empty-state' }, [
    el('p', { className: 'card-text', textContent: message }),
    ctaLabel && ctaHref
      ? el('div', { style: 'margin-top: 0.75rem;' }, [
          el('a', { href: ctaHref, className: 'btn btn-secondary btn-sm', textContent: ctaLabel }),
        ])
      : null,
  ]);
  container.appendChild(box);
}

document.addEventListener('DOMContentLoaded', async () => {
  const ctx = await enforceProtectedRoute();
  if (!ctx) return;

  const { session, user, profile } = ctx;
  const alertBox = document.getElementById('dashboard-alert');
  const fullName =
    (profile && profile.full_name) ||
    (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) ||
    '';
  const firstName = fullName ? fullName.split(/\s+/)[0] : 'there';

  const welcomeEl = document.getElementById('welcome-heading');
  if (welcomeEl) welcomeEl.textContent = `Welcome back, ${firstName}`;

  const res = await authApiRequest(session, '/api/dashboard', { method: 'GET' });
  if (!res.success || !res.data) {
    showAlert(
      alertBox,
      res.message || 'Unable to load dashboard metrics right now. Please refresh shortly.',
      'error'
    );
    return;
  }

  const data = res.data;
  const counts = data.counts || {};
  document.getElementById('metric-opportunities').textContent = String(counts.saved_opportunities ?? 0);
  document.getElementById('metric-documents').textContent = String(counts.generated_documents ?? 0);
  document.getElementById('metric-applications').textContent = String(counts.recorded_applications ?? 0);
  document.getElementById('metric-cvs').textContent = String(counts.uploaded_cvs ?? 0);

  // Profile completion progress & actionable suggestions
  const completion = data.completion || { percentage: 0, completed_count: 0, total_sections: 6, suggestions: [] };
  const pct = Number(completion.percentage || 0);
  const badge = document.getElementById('completion-pct-badge');
  const summaryText = document.getElementById('completion-summary-text');
  const bar = document.getElementById('completion-progress-bar');
  const fill = document.getElementById('completion-progress-fill');
  const suggBox = document.getElementById('completion-suggestions');

  if (badge) {
    badge.textContent = `${pct}% Complete`;
    badge.className = pct === 100 ? 'status-badge status-badge-success tabular-nums' : 'status-badge status-badge-info tabular-nums';
  }
  if (summaryText) {
    summaryText.textContent =
      pct === 100
        ? 'All core career profile sections are confirmed and ready for tailored applications.'
        : `${completion.completed_count} of ${completion.total_sections} core sections confirmed. Completing your profile improves document grounding and compatibility matching.`;
  }
  if (bar) bar.setAttribute('aria-valuenow', String(pct));
  if (fill) fill.style.width = `${pct}%`;

  if (suggBox) {
    clearContainer(suggBox);
    const suggestions = completion.suggestions || [];
    if (suggestions.length === 0) {
      suggBox.appendChild(
        el('div', { className: 'record-item' }, [
          el('div', {}, [
            el('strong', { textContent: 'Profile complete' }),
            el('p', {
              className: 'card-text',
              textContent: 'Keep your experience, projects, or CV imports updated as you progress.',
            }),
          ]),
          el('a', { href: '/profile.html', className: 'btn btn-secondary btn-sm', textContent: 'Review Profile' }),
        ])
      );
    } else {
      suggestions.slice(0, 3).forEach((item) => {
        suggBox.appendChild(
          el('div', { className: 'record-item' }, [
            el('div', {}, [
              el('strong', { textContent: item.label }),
              el('p', { className: 'card-text', textContent: item.suggestion }),
            ]),
            el('a', { href: item.href || '/profile.html', className: 'btn btn-secondary btn-sm', textContent: 'Complete' }),
          ])
        );
      });
    }
  }

  // Application status summary
  const summaryGrid = document.getElementById('status-summary-grid');
  if (summaryGrid) {
    clearContainer(summaryGrid);
    const summary = data.application_status_summary || {};
    Object.entries(summary).forEach(([label, count]) => {
      summaryGrid.appendChild(
        el('div', {}, [
          el('div', { className: 'detail-item-label', textContent: label }),
          el('div', { className: 'detail-item-value tabular-nums', textContent: String(count) }),
        ])
      );
    });
  }

  // Upcoming interviews
  const interviewsBox = document.getElementById('upcoming-interviews-list');
  if (interviewsBox) {
    const interviews = data.upcoming_interviews || [];
    if (interviews.length === 0) {
      renderEmpty(
        interviewsBox,
        'No upcoming interviews scheduled in your Application Tracker yet.',
        'Open Application Tracker',
        '/applications.html'
      );
    } else {
      clearContainer(interviewsBox);
      interviews.forEach((item) => {
        interviewsBox.appendChild(
          el('div', { className: 'record-item' }, [
            el('div', {}, [
              el('strong', { textContent: `${item.job_title} — ${item.company_name}` }),
              el('p', { className: 'card-text', textContent: `Interview: ${formatDateTime(item.interview_date)}` }),
            ]),
            el('a', { href: '/interview-prep.html', className: 'btn btn-secondary btn-sm', textContent: 'Practice' }),
          ])
        );
      });
    }
  }

  // Recent applications
  const recentAppsBox = document.getElementById('recent-applications-list');
  if (recentAppsBox) {
    const apps = data.recent_applications || [];
    if (apps.length === 0) {
      renderEmpty(
        recentAppsBox,
        'You have not recorded any job applications yet.',
        'Record First Application',
        '/applications.html'
      );
    } else {
      clearContainer(recentAppsBox);
      apps.forEach((item) => {
        recentAppsBox.appendChild(
          el('div', { className: 'record-item' }, [
            el('div', {}, [
              el('strong', { textContent: `${item.job_title} — ${item.company_name}` }),
              el('p', {
                className: 'card-text',
                textContent: item.application_date ? `Applied ${formatShortDate(item.application_date)}` : 'Saved in tracker',
              }),
            ]),
            el('span', { className: statusBadgeClass(item.status), textContent: item.status }),
          ])
        );
      });
    }
  }

  // Recent activity
  const activityBox = document.getElementById('recent-activity-list');
  if (activityBox) {
    const items = data.recent_activity || [];
    if (items.length === 0) {
      renderEmpty(
        activityBox,
        'Your recent profile, CV, job analysis, and document events will appear here.',
        'Build Career Profile',
        '/profile.html'
      );
    } else {
      clearContainer(activityBox);
      items.forEach((act) => {
        activityBox.appendChild(
          el('div', { className: 'record-item' }, [
            el('div', {}, [
              el('strong', { textContent: act.message }),
              el('p', { className: 'card-text', textContent: formatDateTime(act.timestamp) }),
            ]),
          ])
        );
      });
    }
  }
});

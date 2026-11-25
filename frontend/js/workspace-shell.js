/**
 * CareerCraft AI — Reusable Workspace Sidebar, Topbar User Badge & Mobile Navigation
 */

import { signOutAndRedirect } from './supabase-client.js';

const NAV_ITEMS = [
  {
    href: '/dashboard.html',
    label: 'Dashboard',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
  },
  {
    href: '/profile.html',
    label: 'Career Profile',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  },
  {
    href: '/cv-upload.html',
    label: 'My CVs',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="m9 15 3-3 3 3"/></svg>',
  },
  {
    href: '/job-analyzer.html',
    label: 'Job Analyser',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  },
  {
    href: '/application-studio.html',
    label: 'Application Studio',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  },
  {
    href: '/documents.html',
    label: 'My Documents',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  },
  {
    href: '/applications.html',
    label: 'Application Tracker',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  },
  {
    href: '/interview-prep.html',
    label: 'Interview Preparation',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  },
  {
    href: '/settings.html',
    label: 'Settings',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1 1.51 1H21a2 2 0 0 1 0 4h-.09c-.74 0-1.25.4-1.51 1z"/></svg>',
  },
];

const BRAND_MARK_SVG = `
  <svg viewBox="0 0 40 40" width="28" height="28" fill="none" aria-hidden="true">
    <rect width="40" height="40" rx="10" fill="#1E293B" />
    <path d="M12 10.5C12 9.67157 12.6716 9 13.5 9H22.25L28 14.75V29.5C28 30.3284 27.3284 31 26.5 31H13.5C12.6716 31 12 30.3284 12 29.5V10.5Z" stroke="#F8FAFC" stroke-width="1.75" stroke-linejoin="round" />
    <path d="M22 9V15H28" stroke="#94A3B8" stroke-width="1.5" stroke-linejoin="round" />
    <path d="M15.5 23.5L18.5 26L24.5 19" stroke="#2563EB" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`;

const LOGOUT_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';

export function initWorkspaceShell({ user, profile } = {}) {
  const sidebar = document.querySelector('.workspace-sidebar');
  const currentPath = window.location.pathname;

  if (sidebar) {
    sidebar.id = sidebar.id || 'workspace-sidebar';
    sidebar.innerHTML = '';

    const topSection = document.createElement('div');

    const brand = document.createElement('a');
    brand.href = '/dashboard.html';
    brand.className = 'sidebar-brand';
    brand.innerHTML = `${BRAND_MARK_SVG}<span>CareerCraft AI</span>`;
    topSection.appendChild(brand);

    const nav = document.createElement('nav');
    nav.className = 'sidebar-nav';
    nav.setAttribute('aria-label', 'Workspace navigation');

    NAV_ITEMS.forEach((item) => {
      const link = document.createElement('a');
      link.href = item.href;
      link.className = 'sidebar-link';
      if (currentPath === item.href || (item.href === '/dashboard.html' && currentPath === '/')) {
        link.setAttribute('aria-current', 'page');
      }
      link.innerHTML = `${item.icon}<span></span>`;
      link.querySelector('span').textContent = item.label;
      nav.appendChild(link);
    });

    topSection.appendChild(nav);
    sidebar.appendChild(topSection);

    const footer = document.createElement('div');
    footer.className = 'sidebar-footer';
    const logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.className = 'sidebar-logout-btn';
    logoutBtn.setAttribute('data-logout-btn', 'true');
    logoutBtn.innerHTML = `${LOGOUT_ICON}<span>Logout</span>`;
    footer.appendChild(logoutBtn);
    sidebar.appendChild(footer);
  }

  // Ensure mobile sidebar drawer toggle exists inside topbar
  const topbar = document.querySelector('.workspace-topbar');
  if (topbar && sidebar) {
    let leftGroup = topbar.querySelector('.workspace-topbar-left');
    if (!leftGroup) {
      const titleEl = topbar.querySelector('.workspace-page-title');
      leftGroup = document.createElement('div');
      leftGroup.className = 'workspace-topbar-left';
      if (titleEl) {
        topbar.insertBefore(leftGroup, titleEl);
        leftGroup.appendChild(titleEl);
      } else {
        topbar.prepend(leftGroup);
      }
    }

    let toggleBtn = document.getElementById('workspace-mobile-nav-btn');
    if (!toggleBtn) {
      toggleBtn = document.createElement('button');
      toggleBtn.id = 'workspace-mobile-nav-btn';
      toggleBtn.type = 'button';
      toggleBtn.className = 'workspace-mobile-toggle';
      toggleBtn.setAttribute('aria-label', 'Open workspace navigation');
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.setAttribute('aria-controls', sidebar.id);
      toggleBtn.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
      leftGroup.prepend(toggleBtn);
    }

    let backdrop = document.getElementById('workspace-sidebar-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'workspace-sidebar-backdrop';
      backdrop.className = 'workspace-sidebar-backdrop';
      backdrop.hidden = true;
      document.body.appendChild(backdrop);
    }

    const closeDrawer = () => {
      sidebar.classList.remove('is-open');
      backdrop.hidden = true;
      toggleBtn.setAttribute('aria-expanded', 'false');
    };

    toggleBtn.addEventListener('click', () => {
      const open = !sidebar.classList.contains('is-open');
      sidebar.classList.toggle('is-open', open);
      backdrop.hidden = !open;
      toggleBtn.setAttribute('aria-expanded', String(open));
    });

    backdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar.classList.contains('is-open')) {
        closeDrawer();
        toggleBtn.focus();
      }
    });
  }

  // Update header user label
  const headerName = document.getElementById('header-user-name');
  if (headerName && user) {
    const fullName =
      (profile && profile.full_name) ||
      (user.user_metadata && user.user_metadata.full_name) ||
      '';
    headerName.textContent = fullName || user.email || 'Account';
  }

  // Wire all logout buttons cleanly
  document.querySelectorAll('[data-logout-btn]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await signOutAndRedirect('/login.html?logged_out=1');
    });
  });
}

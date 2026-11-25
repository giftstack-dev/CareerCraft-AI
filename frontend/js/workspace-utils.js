/**
 * CareerCraft AI — Shared Authenticated API Helpers, Binary Downloads & XSS-Safe DOM Builders
 */

import { apiRequest } from './api.js';
import { APP_CONFIG, loadRuntimeConfig } from './config.js';

export async function authApiRequest(session, path, options = {}) {
  const token = session && session.access_token;
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  return apiRequest(path, { ...options, headers });
}

export async function downloadAuthenticatedBlob(session, path, fallbackFilename = 'document.pdf') {
  await loadRuntimeConfig();
  const base = APP_CONFIG.apiBaseUrl.replace(/\/$/, '');
  const urls = base ? [`${base}${path}`, path] : [path];
  const headers = {
    Authorization: `Bearer ${session.access_token}`,
  };

  let lastErr = null;
  for (const url of urls) {
    try {
      const resp = await fetch(url, { method: 'GET', headers });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => null);
        throw new Error(
          (errBody && (errBody.message || (errBody.error && errBody.error.message))) ||
            `Export failed (${resp.status}).`
        );
      }
      const blob = await resp.blob();
      const disp = resp.headers.get('Content-Disposition') || '';
      const match = /filename="?([^";]+)"?/i.exec(disp);
      const filename = match ? match[1] : fallbackFilename;

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      return filename;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Unable to download document.');
}

/**
 * Create a DOM element safely without innerHTML string interpolation.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  if (attrs && typeof attrs === 'object') {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'className') {
        node.className = v;
      } else if (k === 'textContent') {
        node.textContent = String(v);
      } else if (k === 'hidden') {
        node.hidden = Boolean(v);
      } else if (k === 'dataset' && typeof v === 'object') {
        for (const [dk, dv] of Object.entries(v)) {
          node.dataset[dk] = String(dv);
        }
      } else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else {
        node.setAttribute(k, v === true ? '' : String(v));
      }
    }
  }

  const childList = Array.isArray(children) ? children : [children];
  for (const child of childList) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      node.appendChild(child);
    }
  }
  return node;
}

export function clearContainer(node) {
  if (!node) return;
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

export function formatShortDate(raw) {
  if (!raw) return '—';
  const str = String(raw);
  const d = new Date(str.length === 10 ? `${str}T00:00:00` : str);
  if (Number.isNaN(d.getTime())) return str;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(raw) {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'approved' || s === 'offer received' || s === 'confirmed' || s === 'parsed' || s === 'completed') {
    return 'status-badge status-badge-success';
  }
  if (s === 'interview' || s === 'assessment' || s === 'reviewed' || s === 'preparing' || s === 'applied') {
    return 'status-badge status-badge-info';
  }
  if (s === 'pending_review' || s === 'partially_confirmed' || s === 'extracting' || s === 'draft') {
    return 'status-badge status-badge-warning';
  }
  if (s === 'not selected' || s === 'failed' || s === 'unreadable' || s === 'discarded') {
    return 'status-badge status-badge-error';
  }
  return 'status-badge';
}

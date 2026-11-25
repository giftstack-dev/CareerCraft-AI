/**
 * CareerCraft AI — Private Application Tracker Controller
 */

import { enforceProtectedRoute } from './route-guard.js';
import { clearAlert, showAlert } from './utils.js';
import {
  authApiRequest,
  clearContainer,
  el,
  formatDateTime,
  formatShortDate,
  statusBadgeClass,
} from './workspace-utils.js';

document.addEventListener('DOMContentLoaded', async () => {
  const ctx = await enforceProtectedRoute();
  if (!ctx) return;

  const { session } = ctx;
  const alertBox = document.getElementById('tracker-alert');
  const form = document.getElementById('tracker-form');
  const formTitle = document.getElementById('tracker-form-title');
  const companyIn = document.getElementById('app-company-input');
  const titleIn = document.getElementById('app-title-input');
  const statusSel = document.getElementById('app-status-select');
  const dateIn = document.getElementById('app-date-input');
  const interviewIn = document.getElementById('app-interview-input');
  const followupIn = document.getElementById('app-followup-input');
  const jobSelect = document.getElementById('app-job-link');
  const docsCheckboxes = document.getElementById('app-docs-checkboxes');
  const notesIn = document.getElementById('app-notes-input');
  const submitBtn = document.getElementById('tracker-submit-btn');
  const cancelEditBtn = document.getElementById('tracker-cancel-edit-btn');
  const searchInput = document.getElementById('tracker-search-input');
  const statusFilter = document.getElementById('tracker-status-filter');
  const countLabel = document.getElementById('tracker-count-label');
  const listEl = document.getElementById('tracker-list');

  let editingId = null;
  let allDocs = [];

  async function loadReferenceData() {
    const [jobsRes, docsRes] = await Promise.all([
      authApiRequest(session, '/api/jobs', { method: 'GET' }),
      authApiRequest(session, '/api/documents', { method: 'GET' }),
    ]);

    clearContainer(jobSelect);
    jobSelect.appendChild(el('option', { value: '', textContent: 'None' }));
    if (jobsRes.success && jobsRes.data) {
      (jobsRes.data.items || []).forEach((job) => {
        jobSelect.appendChild(
          el('option', {
            value: job.id,
            textContent: `${job.job_title || 'Untitled'}${job.company_name ? ` — ${job.company_name}` : ''}`,
          })
        );
      });
    }

    allDocs = docsRes.success && docsRes.data ? docsRes.data.items || [] : [];
    renderDocCheckboxes([]);
  }

  function renderDocCheckboxes(selectedIds) {
    clearContainer(docsCheckboxes);
    if (allDocs.length === 0) {
      docsCheckboxes.appendChild(el('span', { className: 'card-text', textContent: 'No generated documents yet.' }));
      return;
    }
    const chosen = new Set(selectedIds || []);
    allDocs.forEach((doc) => {
      const chk = el('input', { type: 'checkbox', name: 'linked_doc_ids', value: doc.id });
      chk.checked = chosen.has(doc.id);
      docsCheckboxes.appendChild(el('label', { className: 'chip' }, [chk, doc.document_title]));
    });
  }

  function resetForm() {
    editingId = null;
    formTitle.textContent = 'Add Application Record';
    submitBtn.textContent = 'Save Application';
    cancelEditBtn.hidden = true;
    form.reset();
    renderDocCheckboxes([]);
  }

  function startEdit(app) {
    editingId = app.id;
    formTitle.textContent = 'Edit Application Record';
    submitBtn.textContent = 'Save Changes';
    cancelEditBtn.hidden = false;
    companyIn.value = app.company_name || '';
    titleIn.value = app.job_title || '';
    statusSel.value = app.status || 'Saved';
    dateIn.value = app.application_date || '';
    followupIn.value = app.follow_up_date || '';
    interviewIn.value = app.interview_date ? String(app.interview_date).slice(0, 16) : '';
    jobSelect.value = app.job_opportunity_id || '';
    notesIn.value = app.notes || '';
    renderDocCheckboxes((app.linked_documents || []).map((d) => d.id));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function loadApplications() {
    const qs = new URLSearchParams();
    if (searchInput.value.trim()) qs.set('search', searchInput.value.trim());
    if (statusFilter.value) qs.set('status', statusFilter.value);

    const res = await authApiRequest(session, `/api/applications?${qs.toString()}`, { method: 'GET' });
    if (!res.success || !res.data) {
      showAlert(alertBox, res.message || 'Could not load applications.', 'error');
      return;
    }

    const items = res.data.items || [];
    countLabel.textContent = `${items.length} application${items.length === 1 ? '' : 's'}`;
    clearContainer(listEl);

    if (items.length === 0) {
      listEl.appendChild(
        el('div', { className: 'empty-state' }, [
          el('p', { className: 'card-text', textContent: 'No recorded applications match your current view.' }),
        ])
      );
      return;
    }

    items.forEach((app) => {
      const linkedDocs = app.linked_documents || [];
      const metaBits = [];
      if (app.application_date) metaBits.push(`Applied: ${formatShortDate(app.application_date)}`);
      if (app.interview_date) metaBits.push(`Interview: ${formatDateTime(app.interview_date)}`);
      if (app.follow_up_date) metaBits.push(`Follow-up: ${formatShortDate(app.follow_up_date)}`);

      listEl.appendChild(
        el('div', { className: 'record-item' }, [
          el('div', {}, [
            el('div', { style: 'display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;' }, [
              el('strong', { textContent: `${app.job_title} — ${app.company_name}` }),
              el('span', { className: statusBadgeClass(app.status), textContent: app.status }),
            ]),
            metaBits.length ? el('p', { className: 'card-text', textContent: metaBits.join('  ·  ') }) : null,
            linkedDocs.length
              ? el('p', { className: 'card-text', textContent: `Linked documents: ${linkedDocs.map((d) => d.document_title).join(', ')}` })
              : null,
            app.notes ? el('p', { className: 'card-text', style: 'margin-top: 0.35rem;', textContent: app.notes }) : null,
          ]),
          el('div', { className: 'record-item-actions' }, [
            el('button', {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
              textContent: 'Edit',
              onClick: () => startEdit(app),
            }),
            el('button', {
              type: 'button',
              className: 'btn btn-danger btn-sm',
              textContent: 'Delete',
              onClick: async () => {
                const delRes = await authApiRequest(session, `/api/applications/${app.id}`, { method: 'DELETE' });
                if (!delRes.success) return showAlert(alertBox, delRes.message, 'error');
                if (editingId === app.id) resetForm();
                await loadApplications();
              },
            }),
          ]),
        ])
      );
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert(alertBox);

    const selectedDocIds = Array.from(docsCheckboxes.querySelectorAll('input[name="linked_doc_ids"]:checked')).map(
      (chk) => chk.value
    );

    const payload = {
      company_name: companyIn.value.trim(),
      job_title: titleIn.value.trim(),
      status: statusSel.value,
      application_date: dateIn.value || null,
      interview_date: interviewIn.value ? new Date(interviewIn.value).toISOString() : null,
      follow_up_date: followupIn.value || null,
      job_opportunity_id: jobSelect.value || null,
      document_ids: selectedDocIds,
      notes: notesIn.value.trim(),
    };

    const url = editingId ? `/api/applications/${editingId}` : '/api/applications';
    const method = editingId ? 'PUT' : 'POST';
    const res = await authApiRequest(session, url, { method, body: JSON.stringify(payload) });
    if (!res.success) return showAlert(alertBox, res.message, 'error');

    showAlert(alertBox, editingId ? 'Application record updated.' : 'Application record saved.', 'success');
    resetForm();
    await loadApplications();
  });

  cancelEditBtn.addEventListener('click', resetForm);

  let timer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(loadApplications, 250);
  });
  statusFilter.addEventListener('change', loadApplications);

  await loadReferenceData();
  await loadApplications();
});

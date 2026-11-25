/**
 * CareerCraft AI — Application Studio Controller
 */

import { enforceProtectedRoute } from './route-guard.js';
import { clearAlert, showAlert } from './utils.js';
import { authApiRequest, clearContainer, el, statusBadgeClass } from './workspace-utils.js';

document.addEventListener('DOMContentLoaded', async () => {
  const ctx = await enforceProtectedRoute();
  if (!ctx) return;

  const { session } = ctx;
  const alertBox = document.getElementById('studio-alert');
  const quickBtn = document.getElementById('mode-quick-btn');
  const guidedBtn = document.getElementById('mode-guided-btn');
  const guidedWrap = document.getElementById('guided-doc-types-wrap');
  const jobSelect = document.getElementById('studio-job-select');
  const toneSelect = document.getElementById('studio-tone-select');
  const extraInput = document.getElementById('studio-extra-context');
  const form = document.getElementById('studio-form');
  const submitBtn = document.getElementById('studio-generate-btn');
  const resultsList = document.getElementById('studio-results-list');

  let mode = 'quick';

  function setMode(nextMode) {
    mode = nextMode;
    quickBtn.classList.toggle('is-active', mode === 'quick');
    guidedBtn.classList.toggle('is-active', mode === 'guided');
    guidedWrap.hidden = mode === 'quick';
  }

  quickBtn.addEventListener('click', () => setMode('quick'));
  guidedBtn.addEventListener('click', () => setMode('guided'));

  async function loadOpportunities() {
    const res = await authApiRequest(session, '/api/jobs', { method: 'GET' });
    clearContainer(jobSelect);
    jobSelect.appendChild(el('option', { value: '', textContent: 'General (no specific job description selected)' }));
    const preselected = new URLSearchParams(window.location.search).get('job') || '';
    if (res.success && res.data && Array.isArray(res.data.items)) {
      res.data.items.forEach((job) => {
        const label = `${job.job_title || 'Untitled Role'}${job.company_name ? ` — ${job.company_name}` : ''}`;
        const opt = el('option', { value: job.id, textContent: label });
        if (job.id === preselected) opt.selected = true;
        jobSelect.appendChild(opt);
      });
    }
  }

  function renderGeneratedResults(items) {
    clearContainer(resultsList);
    if (!items || items.length === 0) {
      resultsList.appendChild(
        el('div', { className: 'empty-state' }, [
          el('p', { className: 'card-text', textContent: 'Generated drafts will appear here for editing, approval, and PDF/DOCX export.' }),
        ])
      );
      return;
    }

    items.forEach((doc) => {
      const grounding = (doc.validation_info && doc.validation_info.grounding_notes) || [];
      resultsList.appendChild(
        el('div', { className: 'record-item' }, [
          el('div', {}, [
            el('strong', { textContent: doc.document_title }),
            el('div', { style: 'display: flex; gap: 0.4rem; margin-top: 0.35rem; flex-wrap: wrap;' }, [
              el('span', { className: statusBadgeClass(doc.document_status), textContent: doc.document_status }),
              el('span', { className: 'status-badge', textContent: doc.document_type.replace(/_/g, ' ') }),
              el('span', { className: 'status-badge', textContent: doc.template.replace(/_/g, ' ') }),
            ]),
            grounding.length
              ? el('p', { className: 'card-text', style: 'margin-top: 0.45rem;', textContent: `Grounding: ${grounding.join(' ')}` })
              : null,
          ]),
          el('div', { className: 'record-item-actions' }, [
            el('a', {
              href: `/documents.html?doc=${encodeURIComponent(doc.id)}`,
              className: 'btn btn-primary btn-sm',
              textContent: 'Open in Document Editor',
            }),
          ]),
        ])
      );
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert(alertBox);

    const tplChecked = form.querySelector('input[name="template"]:checked');
    const template = tplChecked ? tplChecked.value : 'classic_professional';
    const selectedTypes = Array.from(form.querySelectorAll('input[name="doc_types"]:checked')).map((elChk) => elChk.value);

    if (mode === 'guided' && selectedTypes.length === 0) {
      showAlert(alertBox, 'Select at least one document type in Guided Generate mode.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Generating Tailored Draft(s)...';

    const payload = {
      mode,
      template,
      tone: toneSelect.value,
      job_opportunity_id: jobSelect.value || null,
      additional_context: extraInput.value.trim(),
      ...(mode === 'guided' ? { document_types: selectedTypes.slice(0, 4) } : {}),
    };

    const res = await authApiRequest(session, '/api/documents/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Generate Grounded Draft(s)';

    if (!res.success) {
      showAlert(alertBox, res.message || 'Generation failed.', 'error');
      return;
    }

    showAlert(alertBox, res.message, 'success');
    renderGeneratedResults((res.data && res.data.items) || []);
  });

  await loadOpportunities();
  renderGeneratedResults([]);
});

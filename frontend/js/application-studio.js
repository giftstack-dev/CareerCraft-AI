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
    if (!res.success) {
      showAlert(alertBox, res.message || 'Could not load saved job opportunities.', 'error');
      return;
    }
    if (res.data && Array.isArray(res.data.items)) {
      res.data.items.forEach((job) => {
        const label = `${job.job_title || 'Untitled Role'}${job.company_name ? ` — ${job.company_name}` : ''}`;
        const opt = el('option', { value: job.id, textContent: label });
        if (job.id === preselected) opt.selected = true;
        jobSelect.appendChild(opt);
      });
    }
  }

  function renderGeneratedResults(items, failedItems = [], autoRanSteps = [], warnings = []) {
    clearContainer(resultsList);
    if (autoRanSteps && autoRanSteps.length) {
      resultsList.appendChild(
        el('div', {
          className: 'alert alert-info',
          textContent: `Quick Generate automatically ran: ${autoRanSteps.map((s) => s.replace(/_/g, ' ')).join(' -> ')}.`,
        })
      );
    }
    if (warnings && warnings.length) {
      resultsList.appendChild(
        el('div', {
          className: 'alert alert-warning',
          textContent: warnings.join(' '),
        })
      );
    }

    if ((!items || items.length === 0) && (!failedItems || failedItems.length === 0)) {
      resultsList.appendChild(
        el('div', { className: 'empty-state' }, [
          el('p', { className: 'card-text', textContent: 'Generated drafts will appear here for editing, approval, and PDF/DOCX export.' }),
        ])
      );
      return;
    }

    (items || []).forEach((doc) => {
      const valInfo = doc.validation_info || {};
      const groundingNotes = valInfo.grounding_notes || [];
      const report = valInfo.grounding_report || {};
      const verStatus = report.verification_status || valInfo.verification_status || '';
      const flagged = report.flagged_claims || [];
      const missingInfo = report.missing_information || [];
      const clarifications = report.clarification_prompts || [];

      resultsList.appendChild(
        el('div', { className: 'record-item' }, [
          el('div', {}, [
            el('strong', { textContent: doc.document_title }),
            el('div', { style: 'display: flex; gap: 0.4rem; margin-top: 0.35rem; flex-wrap: wrap;' }, [
              el('span', { className: statusBadgeClass(doc.document_status), textContent: doc.document_status }),
              el('span', { className: 'status-badge', textContent: doc.document_type.replace(/_/g, ' ') }),
              el('span', { className: 'status-badge', textContent: doc.template.replace(/_/g, ' ') }),
              verStatus
                ? el('span', {
                    className:
                      verStatus === 'verified' ? 'status-badge status-badge-success' : 'status-badge status-badge-warning',
                    textContent: verStatus === 'verified' ? 'Grounding Verified' : 'Needs Fact Review',
                  })
                : null,
            ]),
            groundingNotes.length
              ? el('p', { className: 'card-text', style: 'margin-top: 0.45rem;', textContent: `Grounding: ${groundingNotes.join(' ')}` })
              : null,
            flagged.length
              ? el(
                  'div',
                  { className: 'alert alert-warning', style: 'margin-top: 0.5rem; font-size: 0.8125rem;' },
                  [
                    el('strong', { textContent: `${flagged.length} item(s) need verification: ` }),
                    flagged.map((f) => `${f.location}: "${f.claim}" (${f.reason})`).join(' · '),
                  ]
                )
              : null,
            missingInfo.length
              ? el('p', {
                  className: 'card-text',
                  style: 'margin-top: 0.35rem; color: var(--color-text-muted);',
                  textContent: `Missing profile info: ${missingInfo.join(' · ')}`,
                })
              : null,
            clarifications.length
              ? el('p', {
                  className: 'card-text',
                  style: 'margin-top: 0.3rem; font-style: italic;',
                  textContent: `Prompt: ${clarifications[0]}`,
                })
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

    (failedItems || []).forEach((failed) => {
      resultsList.appendChild(
        el('div', { className: 'record-item', style: 'border-color: var(--color-danger, #dc2626);' }, [
          el('div', {}, [
            el('strong', { textContent: `${String(failed.document_type || 'Document').replace(/_/g, ' ')} — Not completed` }),
            el('p', { className: 'card-text', textContent: failed.reason || 'Generation failed for this item.' }),
          ]),
          el('span', { className: 'status-badge status-badge-error', textContent: 'failed' }),
        ])
      );
    });
  }

  let generating = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (generating) return;
    clearAlert(alertBox);

    const tplChecked = form.querySelector('input[name="template"]:checked');
    const template = tplChecked ? tplChecked.value : 'classic_professional';
    const selectedTypes = Array.from(form.querySelectorAll('input[name="doc_types"]:checked')).map((elChk) => elChk.value);

    if (mode === 'guided' && selectedTypes.length === 0) {
      showAlert(alertBox, 'Select at least one document type in Guided Generate mode.', 'error');
      return;
    }

    generating = true;
    submitBtn.disabled = true;
    submitBtn.textContent = mode === 'quick' ? 'Analysing & Drafting...' : 'Generating Tailored Draft(s)...';

    const payload = {
      mode,
      template,
      tone: toneSelect.value,
      job_opportunity_id: jobSelect.value || null,
      additional_context: extraInput.value.trim(),
      ...(mode === 'guided' ? { document_types: selectedTypes } : {}),
    };

    try {
      const res = await authApiRequest(session, '/api/documents/generate', {
        method: 'POST',
        body: JSON.stringify(payload),
        onSlowRequest: () => {
          showAlert(
            alertBox,
            'Analysing role, checking compatibility, and drafting tailored documents... This may take up to a minute if the backend is waking up or drafting multiple files.',
            'info'
          );
        },
      });

      if (!res.success) {
        showAlert(alertBox, res.message || 'Generation failed.', 'error');
        return;
      }

      const data = res.data || {};
      const isPartial = Boolean(data.partial);
      showAlert(alertBox, res.message, isPartial ? 'warning' : 'success');
      renderGeneratedResults(
        data.items || [],
        data.failed_items || [],
        data.auto_ran_steps || [],
        data.warnings || []
      );
    } finally {
      generating = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Generate Grounded Draft(s)';
    }
  });

  await loadOpportunities();
  renderGeneratedResults([]);
});

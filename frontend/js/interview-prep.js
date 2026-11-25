/**
 * CareerCraft AI — Interview Preparation & Practice Answers Controller
 */

import { enforceProtectedRoute } from './route-guard.js';
import { clearAlert, showAlert } from './utils.js';
import { authApiRequest, clearContainer, el, formatDateTime } from './workspace-utils.js';

const CATEGORY_LABELS = {
  general: 'General Questions',
  role_specific: 'Role-Specific Questions',
  technical: 'Technical Questions',
  behavioral: 'Behavioural Questions (STAR)',
};

document.addEventListener('DOMContentLoaded', async () => {
  const ctx = await enforceProtectedRoute();
  if (!ctx) return;

  const { session } = ctx;
  const alertBox = document.getElementById('interview-alert');
  const jobSelect = document.getElementById('interview-job-select');
  const genForm = document.getElementById('interview-gen-form');
  const genBtn = document.getElementById('interview-gen-btn');
  const sessionsList = document.getElementById('interview-sessions-list');
  const detailPanel = document.getElementById('interview-session-detail');

  let sessions = [];
  let selectedSession = null;

  async function loadJobs() {
    const res = await authApiRequest(session, '/api/jobs', { method: 'GET' });
    clearContainer(jobSelect);
    const items = res.success && res.data ? res.data.items || [] : [];
    const preselected = new URLSearchParams(window.location.search).get('job') || '';

    if (items.length === 0) {
      jobSelect.appendChild(el('option', { value: '', textContent: 'No saved opportunities found — add one in Job Analyser first' }));
      genBtn.disabled = true;
      return;
    }

    genBtn.disabled = false;
    items.forEach((job) => {
      const opt = el('option', {
        value: job.id,
        textContent: `${job.job_title || 'Untitled Role'}${job.company_name ? ` — ${job.company_name}` : ''}`,
      });
      if (job.id === preselected) opt.selected = true;
      jobSelect.appendChild(opt);
    });
  }

  async function loadSessions(selectId = null) {
    const res = await authApiRequest(session, '/api/interviews', { method: 'GET' });
    if (!res.success || !res.data) {
      showAlert(alertBox, res.message || 'Could not load interview sessions.', 'error');
      return;
    }
    sessions = res.data.items || [];
    if (selectId) {
      selectedSession = sessions.find((s) => s.id === selectId) || null;
    } else if (selectedSession) {
      selectedSession = sessions.find((s) => s.id === selectedSession.id) || null;
    } else if (sessions.length > 0) {
      selectedSession = sessions[0];
    }
    renderSessionsList();
    renderSessionDetail();
  }

  function renderSessionsList() {
    clearContainer(sessionsList);
    if (sessions.length === 0) {
      sessionsList.appendChild(
        el('div', { className: 'empty-state' }, [
          el('p', { className: 'card-text', textContent: 'No interview practice sessions created yet.' }),
        ])
      );
      return;
    }

    sessions.forEach((sess) => {
      const active = selectedSession && selectedSession.id === sess.id;
      const qCount = (sess.questions || []).length;
      sessionsList.appendChild(
        el('div', {
          className: 'record-item',
          style: active ? 'border-color: var(--color-blue); background-color: var(--color-blue-subtle);' : '',
        }, [
          el('div', {}, [
            el('strong', { textContent: sess.job_title || 'Target Role' }),
            el('p', { className: 'card-text', textContent: `${sess.company_name || 'Target Employer'} · ${qCount} questions` }),
            el('p', { className: 'card-text', textContent: formatDateTime(sess.updated_at) }),
          ]),
          el('div', { className: 'record-item-actions' }, [
            el('button', {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
              textContent: 'Open',
              onClick: () => {
                selectedSession = sess;
                renderSessionsList();
                renderSessionDetail();
              },
            }),
            el('button', {
              type: 'button',
              className: 'btn btn-danger btn-sm',
              textContent: 'Delete',
              onClick: async () => {
                const res = await authApiRequest(session, `/api/interviews/${sess.id}`, { method: 'DELETE' });
                if (!res.success) return showAlert(alertBox, res.message, 'error');
                if (selectedSession && selectedSession.id === sess.id) selectedSession = null;
                await loadSessions();
              },
            }),
          ]),
        ])
      );
    });
  }

  function renderSessionDetail() {
    clearContainer(detailPanel);
    if (!selectedSession) {
      detailPanel.appendChild(
        el('div', { className: 'empty-state' }, [
          el('p', { className: 'card-text', textContent: 'Generate or select an interview preparation session to review STAR guidance and write your practice answers.' }),
        ])
      );
      return;
    }

    const questions = selectedSession.questions || [];
    const answers = selectedSession.practice_answers || {};
    const answerInputs = {};

    const header = el('div', { style: 'display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem;' }, [
      el('div', {}, [
        el('h3', { className: 'card-title', style: 'margin-bottom: 0.25rem;', textContent: `${selectedSession.job_title || 'Role'}${selectedSession.company_name ? ` — ${selectedSession.company_name}` : ''}` }),
        el('p', { className: 'card-text', textContent: 'Write your own authentic practice responses below and save anytime.' }),
      ]),
    ]);
    detailPanel.appendChild(header);

    const form = el('form', {
      className: 'form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        clearAlert(alertBox);
        const payloadAnswers = {};
        Object.entries(answerInputs).forEach(([qid, area]) => {
          payloadAnswers[qid] = area.value.trim();
        });
        const res = await authApiRequest(session, `/api/interviews/${selectedSession.id}`, {
          method: 'PUT',
          body: JSON.stringify({ practice_answers: payloadAnswers }),
        });
        if (!res.success) return showAlert(alertBox, res.message, 'error');
        showAlert(alertBox, 'Practice answers saved.', 'success');
        await loadSessions(selectedSession.id);
      },
    });

    ['general', 'role_specific', 'technical', 'behavioral'].forEach((cat) => {
      const catQuestions = questions.filter((q) => q.category === cat);
      if (catQuestions.length === 0) return;

      form.appendChild(el('h4', { className: 'card-title', style: 'margin-top: 1rem;', textContent: CATEGORY_LABELS[cat] || cat }));
      catQuestions.forEach((q) => {
        const area = el('textarea', {
          className: 'form-input',
          placeholder: 'Draft your practice response using the suggested structure and STAR points...',
        });
        area.value = answers[q.id] || '';
        answerInputs[q.id] = area;

        form.appendChild(
          el('div', { className: 'card', style: 'background-color: var(--color-bg);' }, [
            el('strong', { style: 'display: block; margin-bottom: 0.5rem; color: var(--color-navy);', textContent: q.question }),
            q.suggested_structure
              ? el('p', { className: 'card-text', style: 'margin-bottom: 0.35rem;', textContent: `Structure: ${q.suggested_structure}` })
              : null,
            q.star_guidance
              ? el('p', { className: 'card-text', style: 'margin-bottom: 0.35rem;', textContent: `STAR Guidance: ${q.star_guidance}` })
              : null,
            q.grounded_profile_reference
              ? el('p', { className: 'card-text', style: 'margin-bottom: 0.65rem; font-style: italic;', textContent: `Profile Evidence: ${q.grounded_profile_reference}` })
              : null,
            el('div', { className: 'form-group' }, [
              el('label', { className: 'form-label', textContent: 'Your practice answer' }),
              area,
            ]),
          ])
        );
      });
    });

    form.appendChild(
      el('div', { style: 'margin-top: 0.75rem;' }, [
        el('button', { type: 'submit', className: 'btn btn-primary', textContent: 'Save Practice Answers' }),
      ])
    );

    detailPanel.appendChild(form);
  }

  genForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert(alertBox);
    if (!jobSelect.value) return;

    genBtn.disabled = true;
    genBtn.textContent = 'Generating Questions...';

    const res = await authApiRequest(session, '/api/interviews/generate', {
      method: 'POST',
      body: JSON.stringify({ job_opportunity_id: jobSelect.value }),
    });

    genBtn.disabled = false;
    genBtn.textContent = 'Generate Practice Questions';

    if (!res.success) return showAlert(alertBox, res.message, 'error');
    showAlert(alertBox, 'Interview preparation questions ready.', 'success');
    await loadSessions(res.data && res.data.item && res.data.item.id);
  });

  await loadJobs();
  await loadSessions();
});

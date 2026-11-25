/**
 * CareerCraft AI — Job Description Analyser & Profile Compatibility Controller
 */

import { enforceProtectedRoute } from './route-guard.js';
import { clearAlert, showAlert } from './utils.js';
import { authApiRequest, clearContainer, el, formatShortDate } from './workspace-utils.js';

document.addEventListener('DOMContentLoaded', async () => {
  const ctx = await enforceProtectedRoute();
  if (!ctx) return;

  const { session } = ctx;
  const alertBox = document.getElementById('jobs-alert');
  const form = document.getElementById('job-analyze-form');
  const titleIn = document.getElementById('job-title-input');
  const companyIn = document.getElementById('job-company-input');
  const jdIn = document.getElementById('job-description-input');
  const notesIn = document.getElementById('job-instructions-input');
  const screenIn = document.getElementById('job-screening-input');
  const analyzeBtn = document.getElementById('analyze-job-btn');
  const saveOnlyBtn = document.getElementById('save-only-job-btn');
  const savedList = document.getElementById('saved-jobs-list');
  const detailPanel = document.getElementById('job-detail-panel');

  let jobs = [];
  let selectedJob = null;

  async function loadJobs(selectId = null) {
    const res = await authApiRequest(session, '/api/jobs', { method: 'GET' });
    if (!res.success || !res.data) {
      showAlert(alertBox, res.message || 'Could not load saved opportunities.', 'error');
      return;
    }
    jobs = res.data.items || [];
    if (selectId) {
      selectedJob = jobs.find((j) => j.id === selectId) || null;
    } else if (selectedJob) {
      selectedJob = jobs.find((j) => j.id === selectedJob.id) || null;
    } else if (jobs.length > 0) {
      selectedJob = jobs[0];
    }
    renderJobsList();
    renderJobDetail();
  }

  function renderJobsList() {
    clearContainer(savedList);
    if (jobs.length === 0) {
      savedList.appendChild(
        el('div', { className: 'empty-state' }, [
          el('p', { className: 'card-text', textContent: 'No saved job opportunities yet. Paste a job description above to begin.' }),
        ])
      );
      return;
    }

    jobs.forEach((job) => {
      const isActive = selectedJob && selectedJob.id === job.id;
      const hasAnalysis = Boolean(job.latest_analysis);
      savedList.appendChild(
        el('div', {
          className: 'record-item',
          style: isActive ? 'border-color: var(--color-blue); background-color: var(--color-blue-subtle);' : '',
        }, [
          el('div', {}, [
            el('strong', { textContent: job.job_title || 'Untitled Role' }),
            el('p', { className: 'card-text', textContent: `${job.company_name || 'Employer not specified'} · ${formatShortDate(job.created_at)}` }),
            el('span', {
              className: hasAnalysis ? 'status-badge status-badge-success' : 'status-badge',
              textContent: hasAnalysis ? 'Analysed' : 'Saved',
              style: 'margin-top: 0.35rem;',
            }),
          ]),
          el('div', { className: 'record-item-actions' }, [
            el('button', {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
              textContent: 'Open',
              onClick: () => {
                selectedJob = job;
                renderJobsList();
                renderJobDetail();
              },
            }),
            el('button', {
              type: 'button',
              className: 'btn btn-danger btn-sm',
              textContent: 'Delete',
              onClick: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                try {
                  const res = await authApiRequest(session, `/api/jobs/${job.id}`, { method: 'DELETE' });
                  if (!res.success) return showAlert(alertBox, res.message, 'error');
                  if (selectedJob && selectedJob.id === job.id) selectedJob = null;
                  await loadJobs();
                } finally {
                  btn.disabled = false;
                }
              },
            }),
          ]),
        ])
      );
    });
  }

  function renderListSection(title, items) {
    if (!items || !items.length) return null;
    return el('div', { style: 'margin-bottom: 0.75rem;' }, [
      el('strong', { style: 'font-size: 0.875rem; color: var(--color-navy);', textContent: title }),
      el('ul', { className: 'doc-preview-bullets' }, items.map((i) => el('li', { textContent: i }))),
    ]);
  }

  function renderJobDetail() {
    clearContainer(detailPanel);
    if (!selectedJob) {
      detailPanel.appendChild(
        el('div', { className: 'empty-state' }, [
          el('p', { className: 'card-text', textContent: 'Select a saved job opportunity on the left to inspect extracted requirements or run compatibility matching.' }),
        ])
      );
      return;
    }

    const ana = selectedJob.latest_analysis || null;
    const sa = (ana && ana.structured_analysis) || {};
    const compat = (ana && ana.compatibility_results) || null;

    detailPanel.appendChild(
      el('div', { style: 'display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.75rem; align-items: center; margin-bottom: 1.25rem;' }, [
        el('div', {}, [
          el('h4', { className: 'card-title', style: 'margin-bottom: 0.25rem;', textContent: selectedJob.job_title || 'Untitled Role' }),
          el('p', { className: 'card-text', textContent: selectedJob.company_name || 'Employer not specified' }),
        ]),
        el('div', { style: 'display: flex; flex-wrap: wrap; gap: 0.5rem;' }, [
          el('button', {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            textContent: ana ? 'Re-analyse JD' : 'Analyse with AI',
            onClick: async (e) => {
              const btn = e.currentTarget;
              if (btn.disabled) return;
              btn.disabled = true;
              btn.textContent = 'Analysing...';
              clearAlert(alertBox);
              try {
                const res = await authApiRequest(session, '/api/jobs/analyze', {
                  method: 'POST',
                  body: JSON.stringify({ job_id: selectedJob.id }),
                  onSlowRequest: () => {
                    showAlert(alertBox, 'Analysing job description with AI (waking backend / extracting requirements)...', 'info');
                  },
                });
                if (!res.success) {
                  showAlert(alertBox, res.message, 'error');
                  return;
                }
                showAlert(alertBox, 'Job description analysis updated.', 'success');
                await loadJobs(selectedJob.id);
              } finally {
                btn.disabled = false;
                btn.textContent = ana ? 'Re-analyse JD' : 'Analyse with AI';
              }
            },
          }),
          el('button', {
            type: 'button',
            className: 'btn btn-primary btn-sm',
            textContent: 'Run Profile Compatibility',
            onClick: async (e) => {
              const btn = e.currentTarget;
              if (btn.disabled) return;
              btn.disabled = true;
              btn.textContent = 'Comparing...';
              clearAlert(alertBox);
              try {
                const res = await authApiRequest(session, `/api/jobs/${selectedJob.id}/compatibility`, {
                  method: 'POST',
                  onSlowRequest: () => {
                    showAlert(alertBox, 'Comparing your confirmed profile with job requirements...', 'info');
                  },
                });
                if (!res.success) {
                  showAlert(alertBox, res.message, 'error');
                  return;
                }
                showAlert(alertBox, 'Compatibility analysis completed.', 'success');
                await loadJobs(selectedJob.id);
              } finally {
                btn.disabled = false;
                btn.textContent = 'Run Profile Compatibility';
              }
            },
          }),
          el('a', {
            href: `/application-studio.html?job=${encodeURIComponent(selectedJob.id)}`,
            className: 'btn btn-secondary btn-sm',
            textContent: 'Generate Application',
          }),
          el('a', {
            href: `/interview-prep.html?job=${encodeURIComponent(selectedJob.id)}`,
            className: 'btn btn-secondary btn-sm',
            textContent: 'Interview Prep',
          }),
        ]),
      ])
    );

    if (compat) {
      const score = Number(compat.alignment_score ?? 0);
      detailPanel.appendChild(
        el('div', { className: 'card', style: 'background-color: var(--color-bg); margin-bottom: 1.25rem;' }, [
          el('div', { style: 'display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;' }, [
            el('h4', { className: 'card-title', style: 'margin-bottom: 0;', textContent: 'Profile Compatibility Report' }),
            el('span', { className: 'status-badge status-badge-info tabular-nums', textContent: `Alignment: ${score}/100` }),
          ]),
          el('div', { className: 'progress-track', style: 'margin-bottom: 0.75rem;' }, [
            el('div', { className: 'progress-fill', style: `width: ${score}%;` }),
          ]),
          el('p', { className: 'card-text', style: 'margin-bottom: 0.75rem;', textContent: compat.score_explanation || '' }),
          compat.disclaimer
            ? el('p', { className: 'alert alert-info', style: 'margin-bottom: 0.75rem; font-size: 0.8125rem;', textContent: compat.disclaimer })
            : null,
          el('div', { className: 'dashboard-grid-2', style: 'margin-bottom: 0;' }, [
            el('div', {}, [
              renderListSection('Matching Qualifications', compat.matching_qualifications),
              renderListSection('Matching Skills', compat.matching_skills),
              renderListSection('Relevant Experience', compat.relevant_experience),
              renderListSection('Relevant Projects', compat.relevant_projects),
            ]),
            el('div', {}, [
              renderListSection('Transferable Skills', compat.transferable_skills),
              renderListSection('Missing Requirements', compat.missing_requirements),
              renderListSection('Unverified Requirements', compat.unverified_requirements),
              renderListSection('Recommended Emphasis', compat.recommended_emphasis),
            ]),
          ]),
        ])
      );
    }

    // Editable structured job details form so user can correct any extracted requirement
    const editTitle = el('input', { type: 'text', className: 'form-input', value: sa.job_title || selectedJob.job_title || '' });
    const editCompany = el('input', { type: 'text', className: 'form-input', value: sa.company_name || selectedJob.company_name || '' });
    const editResp = el('textarea', { className: 'form-input' });
    editResp.value = (sa.responsibilities || []).join('\n');
    const editMand = el('textarea', { className: 'form-input' });
    editMand.value = (sa.mandatory_requirements || []).join('\n');
    const editPref = el('textarea', { className: 'form-input' });
    editPref.value = (sa.preferred_requirements || []).join('\n');
    const editSkills = el('input', { type: 'text', className: 'form-input', value: (sa.required_skills || []).join(', ') });
    const editTools = el('input', { type: 'text', className: 'form-input', value: (sa.tools || []).join(', ') });

    const saveCorrectionsBtn = el('button', { type: 'submit', className: 'btn btn-secondary', textContent: 'Save Corrections' });
    const editForm = el('form', {
      className: 'form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        if (saveCorrectionsBtn.disabled) return;
        clearAlert(alertBox);
        saveCorrectionsBtn.disabled = true;
        saveCorrectionsBtn.textContent = 'Saving...';
        try {
          const splitLines = (v) => v.split('\n').map((s) => s.trim()).filter(Boolean);
          const splitComma = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);
          const updatedStructured = {
            ...sa,
            job_title: editTitle.value.trim(),
            company_name: editCompany.value.trim(),
            responsibilities: splitLines(editResp.value),
            mandatory_requirements: splitLines(editMand.value),
            preferred_requirements: splitLines(editPref.value),
            required_skills: splitComma(editSkills.value),
            tools: splitComma(editTools.value),
          };
          const res = await authApiRequest(session, `/api/jobs/${selectedJob.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              job_title: editTitle.value.trim(),
              company_name: editCompany.value.trim(),
              structured_analysis: updatedStructured,
            }),
          });
          if (!res.success) return showAlert(alertBox, res.message, 'error');
          showAlert(alertBox, 'Job opportunity & extracted requirements updated.', 'success');
          await loadJobs(selectedJob.id);
        } finally {
          saveCorrectionsBtn.disabled = false;
          saveCorrectionsBtn.textContent = 'Save Corrections';
        }
      },
    }, [
      el('h4', { className: 'card-title', textContent: 'Review & Edit Extracted Requirements' }),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Job Title' }), editTitle]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Company' }), editCompany]),
      ]),
      el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Key Responsibilities (one per line)' }), editResp]),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Mandatory Requirements (one per line)' }), editMand]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Preferred Requirements (one per line)' }), editPref]),
      ]),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Required Skills (comma-separated)' }), editSkills]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Tools & Technologies (comma-separated)' }), editTools]),
      ]),
      el('div', {}, [saveCorrectionsBtn]),
    ]);

    detailPanel.appendChild(editForm);
  }

  let jobSubmitting = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (jobSubmitting) return;
    clearAlert(alertBox);
    jobSubmitting = true;
    analyzeBtn.disabled = true;
    saveOnlyBtn.disabled = true;
    analyzeBtn.textContent = 'Analysing with AI...';

    try {
      const screening = screenIn.value.split('\n').map((s) => s.trim()).filter(Boolean);
      const res = await authApiRequest(session, '/api/jobs/analyze', {
        method: 'POST',
        body: JSON.stringify({
          job_title: titleIn.value.trim(),
          company_name: companyIn.value.trim(),
          original_job_description: jdIn.value.trim(),
          additional_instructions: notesIn.value.trim(),
          screening_questions: screening,
        }),
        onSlowRequest: () => {
          showAlert(alertBox, 'Saving and analysing job description with AI (waking backend / extracting requirements)...', 'info');
        },
      });

      if (!res.success) return showAlert(alertBox, res.message, 'error');
      form.reset();
      showAlert(alertBox, 'Job description saved and analysed.', 'success');
      await loadJobs(res.data && res.data.job && res.data.job.id);
    } finally {
      jobSubmitting = false;
      analyzeBtn.disabled = false;
      saveOnlyBtn.disabled = false;
      analyzeBtn.textContent = 'Save & Analyse Job Description';
    }
  });

  saveOnlyBtn.addEventListener('click', async () => {
    if (jobSubmitting) return;
    clearAlert(alertBox);
    jobSubmitting = true;
    analyzeBtn.disabled = true;
    saveOnlyBtn.disabled = true;
    saveOnlyBtn.textContent = 'Saving...';

    try {
      const screening = screenIn.value.split('\n').map((s) => s.trim()).filter(Boolean);
      const res = await authApiRequest(session, '/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          job_title: titleIn.value.trim(),
          company_name: companyIn.value.trim(),
          original_job_description: jdIn.value.trim(),
          additional_instructions: notesIn.value.trim(),
          screening_questions: screening,
        }),
      });
      if (!res.success) return showAlert(alertBox, res.message, 'error');
      form.reset();
      showAlert(alertBox, 'Job opportunity saved.', 'success');
      await loadJobs(res.data && res.data.item && res.data.item.id);
    } finally {
      jobSubmitting = false;
      analyzeBtn.disabled = false;
      saveOnlyBtn.disabled = false;
      saveOnlyBtn.textContent = 'Save Only';
    }
  });

  await loadJobs(new URLSearchParams(window.location.search).get('job'));
});

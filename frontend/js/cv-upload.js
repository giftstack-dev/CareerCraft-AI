/**
 * CareerCraft AI — CV Upload, Parsing & Non-Overwriting Profile Merge Controller
 */

import { enforceProtectedRoute } from './route-guard.js';
import { clearAlert, showAlert } from './utils.js';
import {
  authApiRequest,
  clearContainer,
  el,
  formatDateTime,
  statusBadgeClass,
} from './workspace-utils.js';

document.addEventListener('DOMContentLoaded', async () => {
  const ctx = await enforceProtectedRoute();
  if (!ctx) return;

  const { session } = ctx;
  const alertBox = document.getElementById('cv-alert');
  const dropzone = document.getElementById('cv-dropzone');
  const fileInput = document.getElementById('cv-file-input');
  const uploadStatus = document.getElementById('cv-upload-status');
  const historyList = document.getElementById('cv-history-list');
  const reviewPanel = document.getElementById('cv-review-panel');

  let cvItems = [];
  let selectedCv = null;

  async function loadHistory(selectId = null) {
    const res = await authApiRequest(session, '/api/cv', { method: 'GET' });
    if (!res.success || !res.data) {
      showAlert(alertBox, res.message || 'Could not load uploaded CVs.', 'error');
      return;
    }
    cvItems = res.data.items || [];
    if (selectId) {
      selectedCv = cvItems.find((c) => c.id === selectId) || null;
    } else if (selectedCv) {
      selectedCv = cvItems.find((c) => c.id === selectedCv.id) || null;
    } else if (cvItems.length > 0) {
      selectedCv = cvItems[0];
    }
    renderHistory();
    renderReviewPanel();
  }

  let uploading = false;

  async function handleFileUpload(file) {
    if (!file || uploading) return;
    uploading = true;
    clearAlert(alertBox);
    uploadStatus.textContent = `Uploading "${file.name}"...`;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await authApiRequest(session, '/api/cv/upload', {
        method: 'POST',
        body: formData,
        onSlowRequest: () => {
          uploadStatus.textContent = `Uploading "${file.name}" (waking backend / extracting text)...`;
        },
      });

      uploadStatus.textContent = '';
      if (!res.success) {
        showAlert(alertBox, res.message || 'Upload failed.', 'error');
        return;
      }

      const item = res.data && res.data.item;
      if (res.data && res.data.readable === false) {
        showAlert(alertBox, res.data.reason || 'Uploaded file could not be read for text.', 'error');
      } else {
        showAlert(alertBox, 'CV uploaded securely. Click "Parse with AI" to extract career details for review.', 'success');
      }
      await loadHistory(item ? item.id : null);
    } finally {
      uploading = false;
      uploadStatus.textContent = '';
    }
  }

  function renderHistory() {
    clearContainer(historyList);
    if (cvItems.length === 0) {
      historyList.appendChild(
        el('div', { className: 'empty-state' }, [
          el('p', { className: 'card-text', textContent: 'No CVs uploaded yet.' }),
        ])
      );
      return;
    }

    cvItems.forEach((cv) => {
      const isSelected = selectedCv && selectedCv.id === cv.id;
      const card = el('div', {
        className: 'record-item',
        style: isSelected ? 'border-color: var(--color-blue); background-color: var(--color-blue-subtle);' : '',
      }, [
        el('div', {}, [
          el('strong', { textContent: cv.original_filename }),
          el('p', { className: 'card-text', textContent: formatDateTime(cv.created_at) }),
          el('div', { style: 'display: flex; gap: 0.4rem; margin-top: 0.4rem; flex-wrap: wrap;' }, [
            el('span', { className: statusBadgeClass(cv.parsing_status), textContent: cv.parsing_status }),
            el('span', { className: statusBadgeClass(cv.confirmation_status), textContent: cv.confirmation_status }),
          ]),
        ]),
        el('div', { className: 'record-item-actions' }, [
          el('button', {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            textContent: 'Inspect',
            onClick: () => {
              selectedCv = cv;
              renderHistory();
              renderReviewPanel();
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
                const res = await authApiRequest(session, `/api/cv/${cv.id}`, { method: 'DELETE' });
                if (!res.success) return showAlert(alertBox, res.message, 'error');
                if (selectedCv && selectedCv.id === cv.id) selectedCv = null;
                await loadHistory();
              } finally {
                btn.disabled = false;
              }
            },
          }),
        ]),
      ]);
      historyList.appendChild(card);
    });
  }

  function renderReviewPanel() {
    clearContainer(reviewPanel);
    if (!selectedCv) {
      reviewPanel.appendChild(
        el('div', { className: 'empty-state' }, [
          el('p', { className: 'card-text', textContent: 'Upload or select a CV to parse and review its extracted details.' }),
        ])
      );
      return;
    }

    const extracted = selectedCv.extracted_data || {};
    const parsed = extracted.parsed || null;

    if (extracted.readable === false) {
      reviewPanel.appendChild(
        el('div', { className: 'alert alert-error' }, [
          el('strong', { textContent: 'Unreadable CV file: ' }),
          extracted.reason || 'Text could not be extracted from this file. Upload a text-based PDF/DOCX or enter your profile manually.',
        ])
      );
      return;
    }

    const isFailed = selectedCv.parsing_status === 'failed';
    const actionLabel = isFailed
      ? 'Retry AI Extraction'
      : parsed
        ? 'Re-parse with AI'
        : 'Parse with AI';

    const topBar = el('div', { style: 'display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem;' }, [
      el('div', {}, [
        el('strong', { textContent: selectedCv.original_filename }),
        el('p', { className: 'card-text', textContent: `Status: ${selectedCv.parsing_status} · ${selectedCv.confirmation_status}` }),
      ]),
      el('button', {
        type: 'button',
        className: 'btn btn-primary btn-sm',
        textContent: actionLabel,
        onClick: async (e) => {
          const btn = e.currentTarget;
          if (btn.disabled) return;
          btn.disabled = true;
          btn.textContent = 'Parsing CV...';
          clearAlert(alertBox);
          try {
            const res = await authApiRequest(session, '/api/cv/parse', {
              method: 'POST',
              body: JSON.stringify({ cv_id: selectedCv.id }),
              onSlowRequest: () => {
                showAlert(
                  alertBox,
                  'Parsing CV with AI... (this may take up to a minute if the backend is waking up).',
                  'info'
                );
              },
            });
            if (!res.success) {
              await loadHistory(selectedCv.id);
              showAlert(alertBox, res.message || 'AI parsing failed.', 'error');
              return;
            }
            showAlert(alertBox, res.message, 'success');
            await loadHistory(selectedCv.id);
          } finally {
            btn.disabled = false;
            btn.textContent = actionLabel;
          }
        },
      }),
    ]);
    reviewPanel.appendChild(topBar);

    if (isFailed) {
      reviewPanel.appendChild(
        el('div', { className: 'alert alert-error', style: 'margin-bottom: 1rem;' }, [
          el('strong', { textContent: 'Previous AI extraction failed: ' }),
          'Your uploaded CV is safely saved in private storage. Click "Retry AI Extraction" above to run extraction again without re-uploading.',
        ])
      );
    }

    if (!parsed) {
      if (!isFailed) {
        reviewPanel.appendChild(
          el('div', { className: 'empty-state' }, [
            el('p', {
              className: 'card-text',
              textContent: 'Click "Parse with AI" above to extract structured sections (experience, education, skills, projects, certifications) for your confirmation.',
            }),
          ])
        );
      }
      return;
    }

    // Build interactive selectable merge form
    const overwriteChk = el('input', { type: 'checkbox' });
    const includePersonalChk = el('input', { type: 'checkbox', checked: true });
    const includeSummaryChk = el('input', { type: 'checkbox', checked: true });

    const expChecks = (parsed.experience || []).map((item) => ({ item, chk: el('input', { type: 'checkbox', checked: true }) }));
    const eduChecks = (parsed.education || []).map((item) => ({ item, chk: el('input', { type: 'checkbox', checked: true }) }));
    const skillChecks = (parsed.skills || []).map((item) => ({ item, chk: el('input', { type: 'checkbox', checked: true }) }));
    const projChecks = (parsed.projects || []).map((item) => ({ item, chk: el('input', { type: 'checkbox', checked: true }) }));
    const certChecks = (parsed.certifications || []).map((item) => ({ item, chk: el('input', { type: 'checkbox', checked: true }) }));

    const mergeBtn = el('button', { type: 'submit', className: 'btn btn-primary', textContent: 'Confirm & Merge into Career Profile' });
    const form = el('form', {
      className: 'form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        if (mergeBtn.disabled) return;
        clearAlert(alertBox);
        mergeBtn.disabled = true;
        mergeBtn.textContent = 'Merging...';
        try {
          const payload = {
            cv_id: selectedCv.id,
            overwrite_existing_fields: overwriteChk.checked,
            personal_details: includePersonalChk.checked ? parsed.personal_details || {} : {},
            professional_summary: includeSummaryChk.checked ? parsed.professional_summary || '' : '',
            career_objective: includeSummaryChk.checked ? parsed.career_objective || '' : '',
            languages: includePersonalChk.checked ? parsed.languages || [] : [],
            experience: expChecks.filter((x) => x.chk.checked).map((x) => x.item),
            education: eduChecks.filter((x) => x.chk.checked).map((x) => x.item),
            skills: skillChecks.filter((x) => x.chk.checked).map((x) => x.item),
            projects: projChecks.filter((x) => x.chk.checked).map((x) => x.item),
            certifications: certChecks.filter((x) => x.chk.checked).map((x) => x.item),
            mark_fully_confirmed: true,
          };

          const res = await authApiRequest(session, '/api/cv/confirm', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          if (!res.success) {
            showAlert(alertBox, res.message || 'Merge failed.', 'error');
            return;
          }
          const counts = (res.data && res.data.merged_counts) || {};
          showAlert(
            alertBox,
            `Merged confirmed records into Career Profile (${counts.experience || 0} experience, ${counts.education || 0} education, ${counts.skills || 0} skills, ${counts.projects || 0} projects, ${counts.certifications || 0} certifications).`,
            'success'
          );
          await loadHistory(selectedCv.id);
        } finally {
          mergeBtn.disabled = false;
          mergeBtn.textContent = 'Confirm & Merge into Career Profile';
        }
      },
    });

    const pInfo = parsed.personal_details || {};
    form.appendChild(
      el('div', { className: 'record-item' }, [
        el('label', { style: 'display: flex; gap: 0.65rem; align-items: flex-start; width: 100%;' }, [
          includePersonalChk,
          el('div', {}, [
            el('strong', { textContent: 'Personal Details & Languages' }),
            el('p', {
              className: 'card-text',
              textContent: [pInfo.full_name, pInfo.professional_title, pInfo.city, pInfo.country, pInfo.phone].filter(Boolean).join(' · ') || 'No personal fields extracted',
            }),
          ]),
        ]),
      ])
    );

    if (parsed.professional_summary || parsed.career_objective) {
      form.appendChild(
        el('div', { className: 'record-item' }, [
          el('label', { style: 'display: flex; gap: 0.65rem; align-items: flex-start; width: 100%;' }, [
            includeSummaryChk,
            el('div', {}, [
              el('strong', { textContent: 'Professional Summary / Objective' }),
              el('p', { className: 'card-text', textContent: parsed.professional_summary || parsed.career_objective }),
            ]),
          ]),
        ])
      );
    }

    const addGroup = (title, entries, formatter) => {
      if (!entries.length) return;
      const box = el('div', { style: 'margin-top: 0.75rem;' }, [
        el('h4', { className: 'form-label', style: 'margin-bottom: 0.5rem;', textContent: `${title} (${entries.length})` }),
      ]);
      const list = el('div', { className: 'record-list' });
      entries.forEach(({ item, chk }) => {
        list.appendChild(
          el('div', { className: 'record-item' }, [
            el('label', { style: 'display: flex; gap: 0.65rem; align-items: flex-start; width: 100%;' }, [
              chk,
              el('div', {}, formatter(item)),
            ]),
          ])
        );
      });
      box.appendChild(list);
      form.appendChild(box);
    };

    addGroup('Experience', expChecks, (ex) => [
      el('strong', { textContent: `${ex.job_title || 'Role'} — ${ex.employer || 'Employer'}` }),
      el('p', { className: 'card-text', textContent: `${ex.start_date || '?'} to ${ex.is_current ? 'Present' : ex.end_date || '?'}` }),
    ]);
    addGroup('Education', eduChecks, (ed) => [
      el('strong', { textContent: `${ed.qualification || 'Qualification'} — ${ed.institution || 'Institution'}` }),
      el('p', { className: 'card-text', textContent: ed.field_of_study || '' }),
    ]);
    addGroup('Skills', skillChecks, (sk) => [
      el('strong', { textContent: `${sk.skill_name} (${sk.skill_category || 'technical'})` }),
    ]);
    addGroup('Projects', projChecks, (pr) => [
      el('strong', { textContent: pr.project_title || 'Project' }),
      el('p', { className: 'card-text', textContent: pr.description || '' }),
    ]);
    addGroup('Certifications', certChecks, (ct) => [
      el('strong', { textContent: `${ct.certification_name} — ${ct.issuing_organisation}` }),
    ]);

    form.appendChild(
      el('label', { style: 'display: flex; gap: 0.5rem; align-items: center; margin-top: 0.5rem; font-size: 0.875rem;' }, [
        overwriteChk,
        'Overwrite existing confirmed personal/summary fields if already populated (default: fill empty fields only)',
      ])
    );

    form.appendChild(
      el('div', { style: 'display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.5rem;' }, [
        mergeBtn,
        el('a', { href: '/profile.html', className: 'btn btn-secondary', textContent: 'Open Career Profile' }),
      ])
    );

    reviewPanel.appendChild(form);
  }

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('is-dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      handleFileUpload(fileInput.files[0]);
      fileInput.value = '';
    }
  });

  await loadHistory();
});

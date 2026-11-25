/**
 * CareerCraft AI — 7-Step Career Profile Onboarding Controller
 * Persists every confirmed step via /api/profile & /api/auth/onboarding-status so users resume seamlessly.
 */

import { enforceProtectedRoute } from './route-guard.js';
import { clearAlert, showAlert } from './utils.js';
import { authApiRequest, clearContainer, el, formatShortDate } from './workspace-utils.js';

const STEPS = [
  { num: 1, label: '1. Personal' },
  { num: 2, label: '2. Summary' },
  { num: 3, label: '3. Education' },
  { num: 4, label: '4. Experience' },
  { num: 5, label: '5. Skills' },
  { num: 6, label: '6. Projects & Certs' },
  { num: 7, label: '7. Languages & Finish' },
];

document.addEventListener('DOMContentLoaded', async () => {
  const ctx = await enforceProtectedRoute();
  if (!ctx) return;

  const { supabase, session } = ctx;
  const alertBox = document.getElementById('onboarding-alert');
  const stepper = document.getElementById('onboarding-stepper');
  const stepContainer = document.getElementById('onboarding-step-container');
  const kicker = document.getElementById('onboarding-step-kicker');
  const heading = document.getElementById('onboarding-step-heading');
  const skipBtn = document.getElementById('skip-onboarding-btn');

  let state = {
    step: 1,
    bundle: null,
  };

  async function refreshProfile() {
    const res = await authApiRequest(session, '/api/profile', { method: 'GET' });
    if (!res.success || !res.data) {
      showAlert(alertBox, res.message || 'Could not load career profile.', 'error');
      return false;
    }
    state.bundle = res.data;
    return true;
  }

  async function persistOnboardingState(status, stepNum, fullName) {
    const res = await authApiRequest(session, '/api/auth/onboarding-status', {
      method: 'POST',
      body: JSON.stringify({
        onboarding_status: status,
        onboarding_step: stepNum,
        ...(fullName ? { full_name: fullName } : {}),
      }),
    });
    if (!res.success) {
      showAlert(alertBox, res.message || 'Could not save onboarding progress.', 'error');
      return false;
    }
    return true;
  }

  function setStepFromQueryOrProfile() {
    const params = new URLSearchParams(window.location.search);
    const qStep = parseInt(params.get('step') || '', 10);
    const pStep = parseInt((state.bundle.profile && state.bundle.profile.onboarding_step) || '1', 10);
    const chosen = !Number.isNaN(qStep) ? qStep : pStep;
    state.step = Math.min(Math.max(chosen || 1, 1), 7);
  }

  function renderStepper() {
    clearContainer(stepper);
    STEPS.forEach((s) => {
      const btn = el('button', {
        type: 'button',
        className: `stepper-item${s.num === state.step ? ' is-active' : s.num < state.step ? ' is-done' : ''}`,
        textContent: s.label,
        onClick: () => {
          clearAlert(alertBox);
          state.step = s.num;
          renderCurrentStep();
        },
      });
      stepper.appendChild(btn);
    });
  }

  function stepNavRow(onBack, nextLabel, onNext, isSubmit = false) {
    const nextBtn = el('button', {
      type: isSubmit ? 'submit' : 'button',
      className: 'btn btn-primary',
      textContent: nextLabel,
      onClick: isSubmit
        ? null
        : async () => {
            if (!onNext) return;
            nextBtn.disabled = true;
            try {
              await onNext();
            } finally {
              nextBtn.disabled = false;
            }
          },
    });
    return el('div', { style: 'display: flex; justify-content: space-between; gap: 0.75rem; margin-top: 1.5rem; flex-wrap: wrap;' }, [
      onBack
        ? el('button', { type: 'button', className: 'btn btn-secondary', textContent: 'Previous', onClick: onBack })
        : el('span'),
      nextBtn,
    ]);
  }

  function renderStep1(p) {
    kicker.textContent = 'Step 1 of 7 · Identity & Contact';
    heading.textContent = 'Confirm your personal & contact details';

    const nameIn = el('input', { type: 'text', className: 'form-input', value: p.full_name || '', required: true });
    const titleIn = el('input', { type: 'text', className: 'form-input', value: p.professional_title || '', placeholder: 'e.g., Software Engineer / Business Analyst' });
    const phoneIn = el('input', { type: 'text', className: 'form-input', value: p.phone || '', placeholder: '+1 555 000 0000' });
    const countryIn = el('input', { type: 'text', className: 'form-input', value: p.country || '', placeholder: 'Country' });
    const cityIn = el('input', { type: 'text', className: 'form-input', value: p.city || '', placeholder: 'City' });
    const portIn = el('input', { type: 'url', className: 'form-input', value: p.portfolio_url || '', placeholder: 'https://your-portfolio.example' });

    const form = el('form', {
      className: 'form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        clearAlert(alertBox);
        if (nameIn.value.trim().length < 2) {
          showAlert(alertBox, 'Please enter your full name (at least 2 characters).', 'error');
          return;
        }
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
          if (submitBtn.disabled) return;
          submitBtn.disabled = true;
          submitBtn.textContent = 'Saving...';
        }
        try {
          const res = await authApiRequest(session, '/api/profile', {
            method: 'PUT',
            body: JSON.stringify({
              full_name: nameIn.value.trim(),
              professional_title: titleIn.value.trim(),
              phone: phoneIn.value.trim(),
              country: countryIn.value.trim(),
              city: cityIn.value.trim(),
              portfolio_url: portIn.value.trim(),
              onboarding_status: 'in_progress',
              onboarding_step: 2,
            }),
          });
          if (!res.success) {
            showAlert(alertBox, res.message, 'error');
            return;
          }
          state.bundle = res.data;
          await supabase.auth.updateUser({ data: { full_name: nameIn.value.trim() } }).catch(() => {});
          state.step = 2;
          renderCurrentStep();
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save & Continue';
          }
        }
      },
    }, [
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Full name *' }), nameIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Professional title' }), titleIn]),
      ]),
      el('div', { className: 'form-row-3' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Phone' }), phoneIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Country' }), countryIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'City' }), cityIn]),
      ]),
      el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Portfolio / Website URL' }), portIn]),
      stepNavRow(null, 'Save & Continue', null, true),
    ]);
    stepContainer.appendChild(form);
  }

  function renderStep2(p) {
    kicker.textContent = 'Step 2 of 7 · Narrative';
    heading.textContent = 'Professional summary & career objective';

    const sumIn = el('textarea', {
      className: 'form-input',
      placeholder: 'Summarise your core qualifications, domains, and strengths factually...',
    });
    sumIn.value = p.professional_summary || '';
    const objIn = el('textarea', {
      className: 'form-input',
      placeholder: 'Describe the types of roles or teams you are targeting...',
    });
    objIn.value = p.career_objective || '';

    const form = el('form', {
      className: 'form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        clearAlert(alertBox);
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
          if (submitBtn.disabled) return;
          submitBtn.disabled = true;
          submitBtn.textContent = 'Saving...';
        }
        try {
          const res = await authApiRequest(session, '/api/profile', {
            method: 'PUT',
            body: JSON.stringify({
              professional_summary: sumIn.value.trim(),
              career_objective: objIn.value.trim(),
              onboarding_status: 'in_progress',
              onboarding_step: 3,
            }),
          });
          if (!res.success) {
            showAlert(alertBox, res.message, 'error');
            return;
          }
          state.bundle = res.data;
          state.step = 3;
          renderCurrentStep();
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save & Continue';
          }
        }
      },
    }, [
      el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Professional summary' }), sumIn]),
      el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Career objective' }), objIn]),
      stepNavRow(() => { state.step = 1; renderCurrentStep(); }, 'Save & Continue', null, true),
    ]);
    stepContainer.appendChild(form);
  }

  function renderStep3() {
    kicker.textContent = 'Step 3 of 7 · Academic Background';
    heading.textContent = 'Education history';

    const list = el('div', { className: 'record-list', style: 'margin-bottom: 1.5rem;' });
    const edus = state.bundle.education || [];
    if (edus.length === 0) {
      list.appendChild(el('p', { className: 'card-text', textContent: 'No education entries added yet.' }));
    } else {
      edus.forEach((ed) => {
        list.appendChild(
          el('div', { className: 'record-item' }, [
            el('div', {}, [
              el('strong', { textContent: `${ed.qualification} — ${ed.institution}` }),
              el('p', { className: 'card-text', textContent: `${ed.field_of_study || ''} (${formatShortDate(ed.start_date)} – ${formatShortDate(ed.end_date)})` }),
            ]),
            el('button', {
              type: 'button',
              className: 'btn btn-danger btn-sm',
              textContent: 'Remove',
              onClick: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                try {
                  const res = await authApiRequest(session, `/api/profile/education/${ed.id}`, { method: 'DELETE' });
                  if (!res.success) return showAlert(alertBox, res.message || 'Could not remove education entry.', 'error');
                  if (await refreshProfile()) renderCurrentStep();
                } finally {
                  btn.disabled = false;
                }
              },
            }),
          ])
        );
      });
    }

    const instIn = el('input', { type: 'text', className: 'form-input', placeholder: 'University or institution', required: true });
    const qualIn = el('input', { type: 'text', className: 'form-input', placeholder: 'e.g., BSc Computer Science', required: true });
    const fieldIn = el('input', { type: 'text', className: 'form-input', placeholder: 'Field of study' });
    const startIn = el('input', { type: 'date', className: 'form-input' });
    const endIn = el('input', { type: 'date', className: 'form-input' });

    const addBtn = el('button', { type: 'submit', className: 'btn btn-secondary', textContent: 'Add Education Entry' });
    const addForm = el('form', {
      className: 'form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        if (addBtn.disabled) return;
        clearAlert(alertBox);
        addBtn.disabled = true;
        addBtn.textContent = 'Adding...';
        try {
          const res = await authApiRequest(session, '/api/profile/education', {
            method: 'POST',
            body: JSON.stringify({
              institution: instIn.value.trim(),
              qualification: qualIn.value.trim(),
              field_of_study: fieldIn.value.trim(),
              start_date: startIn.value,
              end_date: endIn.value,
            }),
          });
          if (!res.success) {
            showAlert(alertBox, res.message, 'error');
            return;
          }
          if (await refreshProfile()) renderCurrentStep();
        } finally {
          addBtn.disabled = false;
          addBtn.textContent = 'Add Education Entry';
        }
      },
    }, [
      el('h3', { className: 'card-title', textContent: 'Add Education Record' }),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Institution *' }), instIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Qualification / Degree *' }), qualIn]),
      ]),
      el('div', { className: 'form-row-3' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Field of study' }), fieldIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Start date' }), startIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'End date' }), endIn]),
      ]),
      el('div', {}, [addBtn]),
    ]);

    stepContainer.appendChild(list);
    stepContainer.appendChild(addForm);
    stepContainer.appendChild(
      stepNavRow(
        () => { state.step = 2; renderCurrentStep(); },
        'Continue to Work Experience',
        async () => {
          if (await persistOnboardingState('in_progress', 4)) {
            state.step = 4;
            renderCurrentStep();
          }
        }
      )
    );
  }

  function renderStep4() {
    kicker.textContent = 'Step 4 of 7 · Career History';
    heading.textContent = 'Work experience, internships, or volunteering';

    const list = el('div', { className: 'record-list', style: 'margin-bottom: 1.5rem;' });
    const exps = state.bundle.experience || [];
    if (exps.length === 0) {
      list.appendChild(el('p', { className: 'card-text', textContent: 'No work experience entries added yet.' }));
    } else {
      exps.forEach((ex) => {
        list.appendChild(
          el('div', { className: 'record-item' }, [
            el('div', {}, [
              el('strong', { textContent: `${ex.job_title} — ${ex.employer}` }),
              el('p', { className: 'card-text', textContent: `${formatShortDate(ex.start_date)} – ${ex.is_current ? 'Present' : formatShortDate(ex.end_date)}` }),
            ]),
            el('button', {
              type: 'button',
              className: 'btn btn-danger btn-sm',
              textContent: 'Remove',
              onClick: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                try {
                  const res = await authApiRequest(session, `/api/profile/experience/${ex.id}`, { method: 'DELETE' });
                  if (!res.success) return showAlert(alertBox, res.message || 'Could not remove work experience.', 'error');
                  if (await refreshProfile()) renderCurrentStep();
                } finally {
                  btn.disabled = false;
                }
              },
            }),
          ])
        );
      });
    }

    const empIn = el('input', { type: 'text', className: 'form-input', placeholder: 'Organisation or company', required: true });
    const roleIn = el('input', { type: 'text', className: 'form-input', placeholder: 'Job title', required: true });
    const startIn = el('input', { type: 'date', className: 'form-input', required: true });
    const endIn = el('input', { type: 'date', className: 'form-input' });
    const currChk = el('input', { type: 'checkbox' });
    const respIn = el('textarea', { className: 'form-input', placeholder: 'One responsibility or achievement per line...' });

    currChk.addEventListener('change', () => {
      endIn.disabled = currChk.checked;
      if (currChk.checked) endIn.value = '';
    });

    const addBtn = el('button', { type: 'submit', className: 'btn btn-secondary', textContent: 'Add Experience Entry' });
    const addForm = el('form', {
      className: 'form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        if (addBtn.disabled) return;
        clearAlert(alertBox);
        addBtn.disabled = true;
        addBtn.textContent = 'Adding...';
        try {
          const res = await authApiRequest(session, '/api/profile/experience', {
            method: 'POST',
            body: JSON.stringify({
              employer: empIn.value.trim(),
              job_title: roleIn.value.trim(),
              start_date: startIn.value,
              end_date: endIn.value,
              is_current: currChk.checked,
              responsibilities: respIn.value,
            }),
          });
          if (!res.success) {
            showAlert(alertBox, res.message, 'error');
            return;
          }
          if (await refreshProfile()) renderCurrentStep();
        } finally {
          addBtn.disabled = false;
          addBtn.textContent = 'Add Experience Entry';
        }
      },
    }, [
      el('h3', { className: 'card-title', textContent: 'Add Experience Entry' }),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Employer *' }), empIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Job Title *' }), roleIn]),
      ]),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Start Date *' }), startIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'End Date' }), endIn]),
      ]),
      el('label', { style: 'display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.875rem;' }, [
        currChk,
        'I currently work in this role',
      ]),
      el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Key responsibilities & achievements (one per line)' }), respIn]),
      el('div', {}, [addBtn]),
    ]);

    stepContainer.appendChild(list);
    stepContainer.appendChild(addForm);
    stepContainer.appendChild(
      stepNavRow(
        () => { state.step = 3; renderCurrentStep(); },
        'Continue to Skills',
        async () => {
          if (await persistOnboardingState('in_progress', 5)) {
            state.step = 5;
            renderCurrentStep();
          }
        }
      )
    );
  }

  function renderStep5() {
    kicker.textContent = 'Step 5 of 7 · Capabilities';
    heading.textContent = 'Confirmed skills';

    const chips = el('div', { className: 'chip-list', style: 'margin-bottom: 1.5rem;' });
    const skills = state.bundle.skills || [];
    if (skills.length === 0) {
      chips.appendChild(el('p', { className: 'card-text', textContent: 'No skills added yet.' }));
    } else {
      skills.forEach((sk) => {
        chips.appendChild(
          el('span', { className: 'chip' }, [
            `${sk.skill_name} (${sk.skill_category})`,
            el('button', {
              type: 'button',
              className: 'chip-remove',
              'aria-label': `Remove ${sk.skill_name}`,
              textContent: '×',
              onClick: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                try {
                  const res = await authApiRequest(session, `/api/profile/skills/${sk.id}`, { method: 'DELETE' });
                  if (!res.success) return showAlert(alertBox, res.message || 'Could not remove skill.', 'error');
                  if (await refreshProfile()) renderCurrentStep();
                } finally {
                  btn.disabled = false;
                }
              },
            }),
          ])
        );
      });
    }

    const nameIn = el('input', { type: 'text', className: 'form-input', placeholder: 'e.g., Python, Financial Modelling, Project Management', required: true });
    const catSel = el('select', { className: 'form-input' }, [
      el('option', { value: 'technical', textContent: 'Technical' }),
      el('option', { value: 'tool', textContent: 'Tool / Platform' }),
      el('option', { value: 'soft', textContent: 'Soft / Communication' }),
      el('option', { value: 'industry', textContent: 'Industry / Domain' }),
      el('option', { value: 'language', textContent: 'Language' }),
    ]);

    const addBtn = el('button', { type: 'submit', className: 'btn btn-secondary', textContent: 'Add Skill' });
    const addForm = el('form', {
      className: 'form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        if (addBtn.disabled) return;
        clearAlert(alertBox);
        addBtn.disabled = true;
        addBtn.textContent = 'Adding...';
        try {
          const res = await authApiRequest(session, '/api/profile/skills', {
            method: 'POST',
            body: JSON.stringify({ skill_name: nameIn.value.trim(), skill_category: catSel.value }),
          });
          if (!res.success) {
            showAlert(alertBox, res.message, 'error');
            return;
          }
          if (await refreshProfile()) renderCurrentStep();
        } finally {
          addBtn.disabled = false;
          addBtn.textContent = 'Add Skill';
        }
      },
    }, [
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Skill name *' }), nameIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Category' }), catSel]),
      ]),
      el('div', {}, [addBtn]),
    ]);

    stepContainer.appendChild(chips);
    stepContainer.appendChild(addForm);
    stepContainer.appendChild(
      stepNavRow(
        () => { state.step = 4; renderCurrentStep(); },
        'Continue to Projects & Certifications',
        async () => {
          if (await persistOnboardingState('in_progress', 6)) {
            state.step = 6;
            renderCurrentStep();
          }
        }
      )
    );
  }

  function renderStep6() {
    kicker.textContent = 'Step 6 of 7 · Portfolio Evidence';
    heading.textContent = 'Projects & certifications';

    const projList = el('div', { className: 'record-list', style: 'margin-bottom: 1.5rem;' });
    (state.bundle.projects || []).forEach((pr) => {
      projList.appendChild(
        el('div', { className: 'record-item' }, [
          el('div', {}, [
            el('strong', { textContent: pr.project_title }),
            el('p', { className: 'card-text', textContent: pr.description }),
          ]),
          el('button', {
            type: 'button',
            className: 'btn btn-danger btn-sm',
            textContent: 'Remove',
            onClick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              try {
                const res = await authApiRequest(session, `/api/profile/projects/${pr.id}`, { method: 'DELETE' });
                if (!res.success) return showAlert(alertBox, res.message || 'Could not remove project.', 'error');
                if (await refreshProfile()) renderCurrentStep();
              } finally {
                btn.disabled = false;
              }
            },
          }),
        ])
      );
    });

    const certList = el('div', { className: 'record-list', style: 'margin-bottom: 1.5rem;' });
    (state.bundle.certifications || []).forEach((ct) => {
      certList.appendChild(
        el('div', { className: 'record-item' }, [
          el('div', {}, [
            el('strong', { textContent: `${ct.certification_name} — ${ct.issuing_organisation}` }),
          ]),
          el('button', {
            type: 'button',
            className: 'btn btn-danger btn-sm',
            textContent: 'Remove',
            onClick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              try {
                const res = await authApiRequest(session, `/api/profile/certifications/${ct.id}`, { method: 'DELETE' });
                if (!res.success) return showAlert(alertBox, res.message || 'Could not remove certification.', 'error');
                if (await refreshProfile()) renderCurrentStep();
              } finally {
                btn.disabled = false;
              }
            },
          }),
        ])
      );
    });

    const pTitle = el('input', { type: 'text', className: 'form-input', placeholder: 'Project title', required: true });
    const pDesc = el('textarea', { className: 'form-input', placeholder: 'Describe what you built or researched...', required: true });
    const pBtn = el('button', { type: 'submit', className: 'btn btn-secondary', textContent: 'Add Project' });
    const pForm = el('form', {
      className: 'form-stack',
      style: 'margin-bottom: 1.5rem;',
      onSubmit: async (e) => {
        e.preventDefault();
        if (pBtn.disabled) return;
        clearAlert(alertBox);
        pBtn.disabled = true;
        pBtn.textContent = 'Adding...';
        try {
          const res = await authApiRequest(session, '/api/profile/projects', {
            method: 'POST',
            body: JSON.stringify({ project_title: pTitle.value.trim(), description: pDesc.value.trim() }),
          });
          if (!res.success) {
            showAlert(alertBox, res.message, 'error');
            return;
          }
          if (await refreshProfile()) renderCurrentStep();
        } finally {
          pBtn.disabled = false;
          pBtn.textContent = 'Add Project';
        }
      },
    }, [
      el('h3', { className: 'card-title', textContent: 'Add Project' }),
      el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Project title *' }), pTitle]),
      el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Description *' }), pDesc]),
      el('div', {}, [pBtn]),
    ]);

    const cName = el('input', { type: 'text', className: 'form-input', placeholder: 'Certification name', required: true });
    const cOrg = el('input', { type: 'text', className: 'form-input', placeholder: 'Issuing organisation', required: true });
    const cBtn = el('button', { type: 'submit', className: 'btn btn-secondary', textContent: 'Add Certification' });
    const cForm = el('form', {
      className: 'form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        if (cBtn.disabled) return;
        clearAlert(alertBox);
        cBtn.disabled = true;
        cBtn.textContent = 'Adding...';
        try {
          const res = await authApiRequest(session, '/api/profile/certifications', {
            method: 'POST',
            body: JSON.stringify({ certification_name: cName.value.trim(), issuing_organisation: cOrg.value.trim() }),
          });
          if (!res.success) {
            showAlert(alertBox, res.message, 'error');
            return;
          }
          if (await refreshProfile()) renderCurrentStep();
        } finally {
          cBtn.disabled = false;
          cBtn.textContent = 'Add Certification';
        }
      },
    }, [
      el('h3', { className: 'card-title', textContent: 'Add Certification' }),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Certification *' }), cName]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Issuing organisation *' }), cOrg]),
      ]),
      el('div', {}, [cBtn]),
    ]);

    stepContainer.appendChild(projList);
    stepContainer.appendChild(pForm);
    stepContainer.appendChild(certList);
    stepContainer.appendChild(cForm);
    stepContainer.appendChild(
      stepNavRow(
        () => { state.step = 5; renderCurrentStep(); },
        'Continue to Final Step',
        async () => {
          if (await persistOnboardingState('in_progress', 7)) {
            state.step = 7;
            renderCurrentStep();
          }
        }
      )
    );
  }

  function renderStep7(p) {
    kicker.textContent = 'Step 7 of 7 · Languages & Final Review';
    heading.textContent = 'Languages, links & finish onboarding';

    const langStr = (p.languages || [])
      .map((item) => (typeof item === 'string' ? item : `${item.language || ''}${item.proficiency ? ` (${item.proficiency})` : ''}`))
      .filter(Boolean)
      .join('\n');
    const linksStr = (p.professional_links || [])
      .map((item) => (item && item.url ? `${item.label || 'Link'} | ${item.url}` : ''))
      .filter(Boolean)
      .join('\n');

    const langArea = el('textarea', { className: 'form-input', placeholder: 'e.g., English (Native)\nFrench (Professional)' });
    langArea.value = langStr;
    const linksArea = el('textarea', { className: 'form-input', placeholder: 'One per line: Label | https://url.example\nGitHub | https://github.com/username' });
    linksArea.value = linksStr;

    const comp = state.bundle.completion || { percentage: 0 };

    const form = el('form', {
      className: 'form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        clearAlert(alertBox);
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
          if (submitBtn.disabled) return;
          submitBtn.disabled = true;
          submitBtn.textContent = 'Finishing...';
        }
        try {
          const langs = langArea.value
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              const m = /^(.+?)\((.+?)\)$/.exec(line);
              return m ? { language: m[1].trim(), proficiency: m[2].trim() } : { language: line, proficiency: 'Working proficiency' };
            });

          const links = linksArea.value
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              const parts = line.split('|');
              if (parts.length >= 2) {
                return { label: parts[0].trim(), url: parts.slice(1).join('|').trim() };
              }
              return { label: 'Link', url: line };
            });

          const res = await authApiRequest(session, '/api/profile', {
            method: 'PUT',
            body: JSON.stringify({
              languages: langs,
              professional_links: links,
              onboarding_status: 'completed',
              onboarding_step: 7,
            }),
          });
          if (!res.success) {
            showAlert(alertBox, res.message, 'error');
            return;
          }
          if (!(await persistOnboardingState('completed', 7))) {
            return;
          }
          showAlert(alertBox, 'Onboarding complete! Redirecting to your workspace dashboard...', 'success');
          setTimeout(() => window.location.replace('/dashboard.html'), 600);
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Complete Onboarding & Open Dashboard';
          }
        }
      },
    }, [
      el('p', { className: 'card-text', textContent: `Current profile completeness: ${comp.percentage}%. You can always refine all sections later in Career Profile.` }),
      el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Languages (one per line)' }), langArea]),
      el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Professional links (Label | https://...)' }), linksArea]),
      stepNavRow(() => { state.step = 6; renderCurrentStep(); }, 'Complete Onboarding & Open Dashboard', null, true),
    ]);

    stepContainer.appendChild(form);
  }

  function renderCurrentStep() {
    renderStepper();
    clearContainer(stepContainer);
    const p = (state.bundle && state.bundle.profile) || {};
    if (state.step === 1) renderStep1(p);
    else if (state.step === 2) renderStep2(p);
    else if (state.step === 3) renderStep3();
    else if (state.step === 4) renderStep4();
    else if (state.step === 5) renderStep5();
    else if (state.step === 6) renderStep6();
    else renderStep7(p);
  }

  if (skipBtn) {
    skipBtn.addEventListener('click', async () => {
      if (skipBtn.disabled) return;
      skipBtn.disabled = true;
      const ok = await persistOnboardingState('skipped', state.step);
      if (!ok) {
        skipBtn.disabled = false;
        return;
      }
      window.location.replace('/dashboard.html');
    });
  }

  const loaded = await refreshProfile();
  if (loaded) {
    setStepFromQueryOrProfile();
    renderCurrentStep();
  }
});

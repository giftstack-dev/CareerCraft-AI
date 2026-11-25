/**
 * CareerCraft AI — Full Career Profile CRUD Controller
 */

import { enforceProtectedRoute } from './route-guard.js';
import { clearAlert, showAlert } from './utils.js';
import { authApiRequest, clearContainer, el, formatShortDate } from './workspace-utils.js';

document.addEventListener('DOMContentLoaded', async () => {
  const ctx = await enforceProtectedRoute();
  if (!ctx) return;

  const { supabase, session } = ctx;
  const alertBox = document.getElementById('profile-alert');
  const panel = document.getElementById('profile-panel');
  const tabsBar = document.getElementById('profile-tabs');
  const pctBadge = document.getElementById('profile-completion-badge');
  const pctFill = document.getElementById('profile-completion-fill');

  let activeTab = window.location.hash.replace('#', '') || 'personal';
  const validTabs = ['personal', 'summary', 'experience', 'education', 'skills', 'projects', 'certifications'];
  if (!validTabs.includes(activeTab)) activeTab = 'personal';

  let bundle = null;
  let editingId = null;

  async function loadProfile() {
    const res = await authApiRequest(session, '/api/profile', { method: 'GET' });
    if (!res.success || !res.data) {
      showAlert(alertBox, res.message || 'Could not load career profile.', 'error');
      return false;
    }
    bundle = res.data;
    const comp = bundle.completion || { percentage: 0 };
    if (pctBadge) pctBadge.textContent = `${comp.percentage}% Complete`;
    if (pctFill) pctFill.style.width = `${comp.percentage}%`;
    return true;
  }

  function updateTabsUI() {
    tabsBar.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.tab === activeTab);
    });
  }

  function renderPersonalTab() {
    const p = bundle.profile || {};
    const nameIn = el('input', { type: 'text', className: 'form-input', value: p.full_name || '', required: true });
    const titleIn = el('input', { type: 'text', className: 'form-input', value: p.professional_title || '' });
    const phoneIn = el('input', { type: 'text', className: 'form-input', value: p.phone || '' });
    const countryIn = el('input', { type: 'text', className: 'form-input', value: p.country || '' });
    const cityIn = el('input', { type: 'text', className: 'form-input', value: p.city || '' });
    const portIn = el('input', { type: 'url', className: 'form-input', value: p.portfolio_url || '', placeholder: 'https://...' });

    const linksIn = el('textarea', {
      className: 'form-input',
      placeholder: 'Label | https://url.example (one per line)',
    });
    linksIn.value = (p.professional_links || [])
      .map((l) => (l && l.url ? `${l.label || 'Link'} | ${l.url}` : ''))
      .filter(Boolean)
      .join('\n');

    const langsIn = el('textarea', {
      className: 'form-input',
      placeholder: 'English (Native)\nSpanish (Intermediate)',
    });
    langsIn.value = (p.languages || [])
      .map((l) => (typeof l === 'string' ? l : `${l.language || ''}${l.proficiency ? ` (${l.proficiency})` : ''}`))
      .filter(Boolean)
      .join('\n');

    const form = el('form', {
      className: 'form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        clearAlert(alertBox);
        const links = linksIn.value
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            const parts = s.split('|');
            return parts.length >= 2
              ? { label: parts[0].trim(), url: parts.slice(1).join('|').trim() }
              : { label: 'Link', url: s };
          });
        const langs = langsIn.value
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            const m = /^(.+?)\((.+?)\)$/.exec(s);
            return m ? { language: m[1].trim(), proficiency: m[2].trim() } : { language: s, proficiency: 'Working proficiency' };
          });

        const res = await authApiRequest(session, '/api/profile', {
          method: 'PUT',
          body: JSON.stringify({
            full_name: nameIn.value.trim(),
            professional_title: titleIn.value.trim(),
            phone: phoneIn.value.trim(),
            country: countryIn.value.trim(),
            city: cityIn.value.trim(),
            portfolio_url: portIn.value.trim(),
            professional_links: links,
            languages: langs,
          }),
        });
        if (!res.success) {
          showAlert(alertBox, res.message, 'error');
          return;
        }
        bundle = res.data;
        await supabase.auth.updateUser({ data: { full_name: nameIn.value.trim() } }).catch(() => {});
        const headerEl = document.getElementById('header-user-name');
        if (headerEl) headerEl.textContent = nameIn.value.trim();
        showAlert(alertBox, 'Personal details and links saved.', 'success');
        pctBadge.textContent = `${bundle.completion.percentage}% Complete`;
        pctFill.style.width = `${bundle.completion.percentage}%`;
      },
    }, [
      el('h3', { className: 'card-title', textContent: 'Personal Details, Languages & Links' }),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Full name *' }), nameIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Professional headline / title' }), titleIn]),
      ]),
      el('div', { className: 'form-row-3' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Phone' }), phoneIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Country' }), countryIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'City' }), cityIn]),
      ]),
      el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Portfolio URL' }), portIn]),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Professional links (Label | https://...)' }), linksIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Languages (one per line)' }), langsIn]),
      ]),
      el('div', {}, [el('button', { type: 'submit', className: 'btn btn-primary', textContent: 'Save Personal Details' })]),
    ]);
    panel.appendChild(form);
  }

  function renderSummaryTab() {
    const p = bundle.profile || {};
    const sumIn = el('textarea', { className: 'form-input', style: 'min-height: 150px;' });
    sumIn.value = p.professional_summary || '';
    const objIn = el('textarea', { className: 'form-input', style: 'min-height: 120px;' });
    objIn.value = p.career_objective || '';

    const form = el('form', {
      className: 'form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        clearAlert(alertBox);
        const res = await authApiRequest(session, '/api/profile', {
          method: 'PUT',
          body: JSON.stringify({
            professional_summary: sumIn.value.trim(),
            career_objective: objIn.value.trim(),
          }),
        });
        if (!res.success) {
          showAlert(alertBox, res.message, 'error');
          return;
        }
        bundle = res.data;
        pctBadge.textContent = `${bundle.completion.percentage}% Complete`;
        pctFill.style.width = `${bundle.completion.percentage}%`;
        showAlert(alertBox, 'Summary and career objective saved.', 'success');
      },
    }, [
      el('h3', { className: 'card-title', textContent: 'Professional Summary & Career Objective' }),
      el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Professional summary' }), sumIn]),
      el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Career objective' }), objIn]),
      el('div', {}, [el('button', { type: 'submit', className: 'btn btn-primary', textContent: 'Save Summary' })]),
    ]);
    panel.appendChild(form);
  }

  function renderExperienceTab() {
    const list = el('div', { className: 'record-list', style: 'margin-bottom: 1.5rem;' });
    const items = bundle.experience || [];
    const editingItem = items.find((i) => i.id === editingId) || null;

    if (items.length === 0) {
      list.appendChild(el('div', { className: 'empty-state' }, [el('p', { className: 'card-text', textContent: 'No work experience entries recorded yet.' })]));
    } else {
      items.forEach((item) => {
        const bullets = [...(item.responsibilities || []), ...(item.achievements || [])];
        list.appendChild(
          el('div', { className: 'record-item' }, [
            el('div', {}, [
              el('strong', { textContent: `${item.job_title} — ${item.employer}` }),
              el('p', { className: 'card-text', textContent: `${formatShortDate(item.start_date)} – ${item.is_current ? 'Present' : formatShortDate(item.end_date)}` }),
              bullets.length
                ? el('ul', { className: 'doc-preview-bullets' }, bullets.map((b) => el('li', { textContent: b })))
                : null,
            ]),
            el('div', { className: 'record-item-actions' }, [
              el('button', {
                type: 'button',
                className: 'btn btn-secondary btn-sm',
                textContent: 'Edit',
                onClick: () => {
                  editingId = item.id;
                  renderPanel();
                },
              }),
              el('button', {
                type: 'button',
                className: 'btn btn-danger btn-sm',
                textContent: 'Delete',
                onClick: async () => {
                  const res = await authApiRequest(session, `/api/profile/experience/${item.id}`, { method: 'DELETE' });
                  if (!res.success) return showAlert(alertBox, res.message, 'error');
                  if (editingId === item.id) editingId = null;
                  await loadProfile();
                  renderPanel();
                },
              }),
            ]),
          ])
        );
      });
    }

    const empIn = el('input', { type: 'text', className: 'form-input', value: editingItem ? editingItem.employer : '', required: true });
    const titleIn = el('input', { type: 'text', className: 'form-input', value: editingItem ? editingItem.job_title : '', required: true });
    const startIn = el('input', { type: 'date', className: 'form-input', value: editingItem ? editingItem.start_date : '', required: true });
    const endIn = el('input', { type: 'date', className: 'form-input', value: (editingItem && !editingItem.is_current && editingItem.end_date) || '' });
    const currChk = el('input', { type: 'checkbox' });
    currChk.checked = Boolean(editingItem && editingItem.is_current);
    endIn.disabled = currChk.checked;
    currChk.addEventListener('change', () => {
      endIn.disabled = currChk.checked;
      if (currChk.checked) endIn.value = '';
    });

    const respIn = el('textarea', { className: 'form-input', placeholder: 'One responsibility per line...' });
    respIn.value = editingItem ? (editingItem.responsibilities || []).join('\n') : '';
    const achIn = el('textarea', { className: 'form-input', placeholder: 'One measurable achievement per line...' });
    achIn.value = editingItem ? (editingItem.achievements || []).join('\n') : '';

    const form = el('form', {
      className: 'form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        clearAlert(alertBox);
        const method = editingItem ? 'PUT' : 'POST';
        const url = editingItem ? `/api/profile/experience/${editingItem.id}` : '/api/profile/experience';
        const res = await authApiRequest(session, url, {
          method,
          body: JSON.stringify({
            employer: empIn.value.trim(),
            job_title: titleIn.value.trim(),
            start_date: startIn.value,
            end_date: endIn.value,
            is_current: currChk.checked,
            responsibilities: respIn.value,
            achievements: achIn.value,
          }),
        });
        if (!res.success) return showAlert(alertBox, res.message, 'error');
        editingId = null;
        showAlert(alertBox, editingItem ? 'Experience updated.' : 'Experience added.', 'success');
        await loadProfile();
        renderPanel();
      },
    }, [
      el('h3', { className: 'card-title', textContent: editingItem ? 'Edit Work Experience' : 'Add Work Experience' }),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Employer *' }), empIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Job Title *' }), titleIn]),
      ]),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Start Date *' }), startIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'End Date' }), endIn]),
      ]),
      el('label', { style: 'display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.875rem;' }, [currChk, 'Current role']),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Responsibilities (one per line)' }), respIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Confirmed achievements (one per line)' }), achIn]),
      ]),
      el('div', { style: 'display: flex; gap: 0.75rem;' }, [
        el('button', { type: 'submit', className: 'btn btn-primary', textContent: editingItem ? 'Save Changes' : 'Add Experience' }),
        editingItem
          ? el('button', { type: 'button', className: 'btn btn-secondary', textContent: 'Cancel Edit', onClick: () => { editingId = null; renderPanel(); } })
          : null,
      ]),
    ]);

    panel.appendChild(list);
    panel.appendChild(form);
  }

  function renderEducationTab() {
    const list = el('div', { className: 'record-list', style: 'margin-bottom: 1.5rem;' });
    const items = bundle.education || [];
    const editingItem = items.find((i) => i.id === editingId) || null;

    if (items.length === 0) {
      list.appendChild(el('div', { className: 'empty-state' }, [el('p', { className: 'card-text', textContent: 'No education records added yet.' })]));
    } else {
      items.forEach((ed) => {
        list.appendChild(
          el('div', { className: 'record-item' }, [
            el('div', {}, [
              el('strong', { textContent: `${ed.qualification} — ${ed.institution}` }),
              el('p', { className: 'card-text', textContent: `${ed.field_of_study || ''} (${formatShortDate(ed.start_date)} – ${formatShortDate(ed.end_date)})` }),
              ed.achievements ? el('p', { className: 'card-text', textContent: ed.achievements }) : null,
            ]),
            el('div', { className: 'record-item-actions' }, [
              el('button', { type: 'button', className: 'btn btn-secondary btn-sm', textContent: 'Edit', onClick: () => { editingId = ed.id; renderPanel(); } }),
              el('button', {
                type: 'button',
                className: 'btn btn-danger btn-sm',
                textContent: 'Delete',
                onClick: async () => {
                  await authApiRequest(session, `/api/profile/education/${ed.id}`, { method: 'DELETE' });
                  if (editingId === ed.id) editingId = null;
                  await loadProfile();
                  renderPanel();
                },
              }),
            ]),
          ])
        );
      });
    }

    const instIn = el('input', { type: 'text', className: 'form-input', value: editingItem ? editingItem.institution : '', required: true });
    const qualIn = el('input', { type: 'text', className: 'form-input', value: editingItem ? editingItem.qualification : '', required: true });
    const fieldIn = el('input', { type: 'text', className: 'form-input', value: (editingItem && editingItem.field_of_study) || '' });
    const startIn = el('input', { type: 'date', className: 'form-input', value: (editingItem && editingItem.start_date) || '' });
    const endIn = el('input', { type: 'date', className: 'form-input', value: (editingItem && editingItem.end_date) || '' });
    const achIn = el('textarea', { className: 'form-input' });
    achIn.value = (editingItem && editingItem.achievements) || '';

    const form = el('form', {
      className: 'form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        clearAlert(alertBox);
        const method = editingItem ? 'PUT' : 'POST';
        const url = editingItem ? `/api/profile/education/${editingItem.id}` : '/api/profile/education';
        const res = await authApiRequest(session, url, {
          method,
          body: JSON.stringify({
            institution: instIn.value.trim(),
            qualification: qualIn.value.trim(),
            field_of_study: fieldIn.value.trim(),
            start_date: startIn.value,
            end_date: endIn.value,
            achievements: achIn.value.trim(),
          }),
        });
        if (!res.success) return showAlert(alertBox, res.message, 'error');
        editingId = null;
        showAlert(alertBox, editingItem ? 'Education updated.' : 'Education added.', 'success');
        await loadProfile();
        renderPanel();
      },
    }, [
      el('h3', { className: 'card-title', textContent: editingItem ? 'Edit Education' : 'Add Education' }),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Institution *' }), instIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Qualification *' }), qualIn]),
      ]),
      el('div', { className: 'form-row-3' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Field of study' }), fieldIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Start date' }), startIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'End date' }), endIn]),
      ]),
      el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Academic honours, thesis, or coursework' }), achIn]),
      el('div', { style: 'display: flex; gap: 0.75rem;' }, [
        el('button', { type: 'submit', className: 'btn btn-primary', textContent: editingItem ? 'Save Changes' : 'Add Education' }),
        editingItem
          ? el('button', { type: 'button', className: 'btn btn-secondary', textContent: 'Cancel Edit', onClick: () => { editingId = null; renderPanel(); } })
          : null,
      ]),
    ]);

    panel.appendChild(list);
    panel.appendChild(form);
  }

  function renderSkillsTab() {
    const chips = el('div', { className: 'chip-list', style: 'margin-bottom: 1.5rem;' });
    const items = bundle.skills || [];
    if (items.length === 0) {
      chips.appendChild(el('p', { className: 'card-text', textContent: 'No confirmed skills added yet.' }));
    } else {
      items.forEach((sk) => {
        chips.appendChild(
          el('span', { className: 'chip' }, [
            `${sk.skill_name} · ${sk.skill_category}${sk.proficiency ? ` (${sk.proficiency})` : ''}`,
            el('button', {
              type: 'button',
              className: 'chip-remove',
              'aria-label': `Delete ${sk.skill_name}`,
              textContent: '×',
              onClick: async () => {
                await authApiRequest(session, `/api/profile/skills/${sk.id}`, { method: 'DELETE' });
                await loadProfile();
                renderPanel();
              },
            }),
          ])
        );
      });
    }

    const nameIn = el('input', { type: 'text', className: 'form-input', placeholder: 'e.g., PostgreSQL', required: true });
    const catSel = el('select', { className: 'form-input' }, [
      el('option', { value: 'technical', textContent: 'Technical' }),
      el('option', { value: 'tool', textContent: 'Tool / Platform' }),
      el('option', { value: 'soft', textContent: 'Soft Skill' }),
      el('option', { value: 'industry', textContent: 'Industry Knowledge' }),
      el('option', { value: 'language', textContent: 'Language' }),
    ]);
    const profIn = el('input', { type: 'text', className: 'form-input', placeholder: 'Optional: Advanced / Proficient' });

    const form = el('form', {
      className: 'form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        clearAlert(alertBox);
        const res = await authApiRequest(session, '/api/profile/skills', {
          method: 'POST',
          body: JSON.stringify({ skill_name: nameIn.value.trim(), skill_category: catSel.value, proficiency: profIn.value.trim() }),
        });
        if (!res.success) return showAlert(alertBox, res.message, 'error');
        showAlert(alertBox, 'Skill saved.', 'success');
        await loadProfile();
        renderPanel();
      },
    }, [
      el('h3', { className: 'card-title', textContent: 'Add Confirmed Skill' }),
      el('div', { className: 'form-row-3' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Skill name *' }), nameIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Category' }), catSel]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Proficiency' }), profIn]),
      ]),
      el('div', {}, [el('button', { type: 'submit', className: 'btn btn-primary', textContent: 'Save Skill' })]),
    ]);

    panel.appendChild(chips);
    panel.appendChild(form);
  }

  function renderProjectsTab() {
    const list = el('div', { className: 'record-list', style: 'margin-bottom: 1.5rem;' });
    const items = bundle.projects || [];
    const editingItem = items.find((i) => i.id === editingId) || null;

    if (items.length === 0) {
      list.appendChild(el('div', { className: 'empty-state' }, [el('p', { className: 'card-text', textContent: 'No projects added yet.' })]));
    } else {
      items.forEach((pr) => {
        list.appendChild(
          el('div', { className: 'record-item' }, [
            el('div', {}, [
              el('strong', { textContent: pr.project_title }),
              el('p', { className: 'card-text', textContent: pr.description }),
              pr.personal_contribution ? el('p', { className: 'card-text', textContent: `Contribution: ${pr.personal_contribution}` }) : null,
            ]),
            el('div', { className: 'record-item-actions' }, [
              el('button', { type: 'button', className: 'btn btn-secondary btn-sm', textContent: 'Edit', onClick: () => { editingId = pr.id; renderPanel(); } }),
              el('button', {
                type: 'button',
                className: 'btn btn-danger btn-sm',
                textContent: 'Delete',
                onClick: async () => {
                  await authApiRequest(session, `/api/profile/projects/${pr.id}`, { method: 'DELETE' });
                  if (editingId === pr.id) editingId = null;
                  await loadProfile();
                  renderPanel();
                },
              }),
            ]),
          ])
        );
      });
    }

    const titleIn = el('input', { type: 'text', className: 'form-input', value: editingItem ? editingItem.project_title : '', required: true });
    const urlIn = el('input', { type: 'url', className: 'form-input', value: (editingItem && editingItem.project_url) || '', placeholder: 'https://...' });
    const descIn = el('textarea', { className: 'form-input', required: true });
    descIn.value = editingItem ? editingItem.description : '';
    const contribIn = el('textarea', { className: 'form-input' });
    contribIn.value = (editingItem && editingItem.personal_contribution) || '';
    const toolsIn = el('input', { type: 'text', className: 'form-input', value: editingItem ? (editingItem.tools || []).join(', ') : '', placeholder: 'Python, Flask, PostgreSQL' });

    const form = el('form', {
      className: 'form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        clearAlert(alertBox);
        const tools = toolsIn.value.split(',').map((t) => t.trim()).filter(Boolean);
        const method = editingItem ? 'PUT' : 'POST';
        const url = editingItem ? `/api/profile/projects/${editingItem.id}` : '/api/profile/projects';
        const res = await authApiRequest(session, url, {
          method,
          body: JSON.stringify({
            project_title: titleIn.value.trim(),
            description: descIn.value.trim(),
            personal_contribution: contribIn.value.trim(),
            tools,
            project_url: urlIn.value.trim(),
          }),
        });
        if (!res.success) return showAlert(alertBox, res.message, 'error');
        editingId = null;
        showAlert(alertBox, editingItem ? 'Project updated.' : 'Project added.', 'success');
        await loadProfile();
        renderPanel();
      },
    }, [
      el('h3', { className: 'card-title', textContent: editingItem ? 'Edit Project' : 'Add Project' }),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Project Title *' }), titleIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Project URL' }), urlIn]),
      ]),
      el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Description *' }), descIn]),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Your personal contribution' }), contribIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Tools & technologies (comma-separated)' }), toolsIn]),
      ]),
      el('div', { style: 'display: flex; gap: 0.75rem;' }, [
        el('button', { type: 'submit', className: 'btn btn-primary', textContent: editingItem ? 'Save Changes' : 'Add Project' }),
        editingItem
          ? el('button', { type: 'button', className: 'btn btn-secondary', textContent: 'Cancel Edit', onClick: () => { editingId = null; renderPanel(); } })
          : null,
      ]),
    ]);

    panel.appendChild(list);
    panel.appendChild(form);
  }

  function renderCertificationsTab() {
    const list = el('div', { className: 'record-list', style: 'margin-bottom: 1.5rem;' });
    const items = bundle.certifications || [];
    const editingItem = items.find((i) => i.id === editingId) || null;

    if (items.length === 0) {
      list.appendChild(el('div', { className: 'empty-state' }, [el('p', { className: 'card-text', textContent: 'No certifications added yet.' })]));
    } else {
      items.forEach((ct) => {
        list.appendChild(
          el('div', { className: 'record-item' }, [
            el('div', {}, [
              el('strong', { textContent: `${ct.certification_name} — ${ct.issuing_organisation}` }),
              ct.issue_date ? el('p', { className: 'card-text', textContent: `Issued ${formatShortDate(ct.issue_date)}` }) : null,
            ]),
            el('div', { className: 'record-item-actions' }, [
              el('button', { type: 'button', className: 'btn btn-secondary btn-sm', textContent: 'Edit', onClick: () => { editingId = ct.id; renderPanel(); } }),
              el('button', {
                type: 'button',
                className: 'btn btn-danger btn-sm',
                textContent: 'Delete',
                onClick: async () => {
                  await authApiRequest(session, `/api/profile/certifications/${ct.id}`, { method: 'DELETE' });
                  if (editingId === ct.id) editingId = null;
                  await loadProfile();
                  renderPanel();
                },
              }),
            ]),
          ])
        );
      });
    }

    const nameIn = el('input', { type: 'text', className: 'form-input', value: editingItem ? editingItem.certification_name : '', required: true });
    const orgIn = el('input', { type: 'text', className: 'form-input', value: editingItem ? editingItem.issuing_organisation : '', required: true });
    const dateIn = el('input', { type: 'date', className: 'form-input', value: (editingItem && editingItem.issue_date) || '' });
    const urlIn = el('input', { type: 'url', className: 'form-input', value: (editingItem && editingItem.credential_url) || '', placeholder: 'https://...' });

    const form = el('form', {
      className: 'form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        clearAlert(alertBox);
        const method = editingItem ? 'PUT' : 'POST';
        const url = editingItem ? `/api/profile/certifications/${editingItem.id}` : '/api/profile/certifications';
        const res = await authApiRequest(session, url, {
          method,
          body: JSON.stringify({
            certification_name: nameIn.value.trim(),
            issuing_organisation: orgIn.value.trim(),
            issue_date: dateIn.value,
            credential_url: urlIn.value.trim(),
          }),
        });
        if (!res.success) return showAlert(alertBox, res.message, 'error');
        editingId = null;
        showAlert(alertBox, editingItem ? 'Certification updated.' : 'Certification added.', 'success');
        await loadProfile();
        renderPanel();
      },
    }, [
      el('h3', { className: 'card-title', textContent: editingItem ? 'Edit Certification' : 'Add Certification' }),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Certification Name *' }), nameIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Issuing Organisation *' }), orgIn]),
      ]),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Issue Date' }), dateIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Credential URL' }), urlIn]),
      ]),
      el('div', { style: 'display: flex; gap: 0.75rem;' }, [
        el('button', { type: 'submit', className: 'btn btn-primary', textContent: editingItem ? 'Save Changes' : 'Add Certification' }),
        editingItem
          ? el('button', { type: 'button', className: 'btn btn-secondary', textContent: 'Cancel Edit', onClick: () => { editingId = null; renderPanel(); } })
          : null,
      ]),
    ]);

    panel.appendChild(list);
    panel.appendChild(form);
  }

  function renderPanel() {
    updateTabsUI();
    clearContainer(panel);
    if (!bundle) return;
    if (activeTab === 'personal') renderPersonalTab();
    else if (activeTab === 'summary') renderSummaryTab();
    else if (activeTab === 'experience') renderExperienceTab();
    else if (activeTab === 'education') renderEducationTab();
    else if (activeTab === 'skills') renderSkillsTab();
    else if (activeTab === 'projects') renderProjectsTab();
    else if (activeTab === 'certifications') renderCertificationsTab();
  }

  tabsBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    clearAlert(alertBox);
    editingId = null;
    activeTab = btn.dataset.tab;
    window.history.replaceState(null, '', `#${activeTab}`);
    renderPanel();
  });

  if (await loadProfile()) {
    renderPanel();
  }
});

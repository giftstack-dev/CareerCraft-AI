/**
 * CareerCraft AI — Document Library, Live Editor, Version Restore & Binary PDF/DOCX Export Controller
 */

import { enforceProtectedRoute } from './route-guard.js';
import { clearAlert, showAlert } from './utils.js';
import {
  authApiRequest,
  clearContainer,
  downloadAuthenticatedBlob,
  el,
  formatDateTime,
  statusBadgeClass,
} from './workspace-utils.js';

document.addEventListener('DOMContentLoaded', async () => {
  const ctx = await enforceProtectedRoute();
  if (!ctx) return;

  const { session } = ctx;
  const alertBox = document.getElementById('docs-alert');
  const searchInput = document.getElementById('docs-search-input');
  const typeFilter = document.getElementById('docs-type-filter');
  const statusFilter = document.getElementById('docs-status-filter');
  const libraryList = document.getElementById('docs-library-list');
  const editorPanel = document.getElementById('docs-editor-panel');

  let docs = [];
  let selectedDoc = null;
  let versions = [];

  async function loadDocuments(selectId = null) {
    const qs = new URLSearchParams();
    if (searchInput.value.trim()) qs.set('search', searchInput.value.trim());
    if (typeFilter.value) qs.set('document_type', typeFilter.value);
    if (statusFilter.value) qs.set('document_status', statusFilter.value);

    const res = await authApiRequest(session, `/api/documents?${qs.toString()}`, { method: 'GET' });
    if (!res.success || !res.data) {
      showAlert(alertBox, res.message || 'Could not load documents.', 'error');
      return;
    }
    docs = res.data.items || [];
    if (selectId) {
      selectedDoc = docs.find((d) => d.id === selectId) || null;
    } else if (selectedDoc) {
      selectedDoc = docs.find((d) => d.id === selectedDoc.id) || null;
    } else if (docs.length > 0) {
      selectedDoc = docs[0];
    }

    if (selectedDoc) {
      await loadVersions(selectedDoc.id);
    } else {
      versions = [];
    }
    renderLibrary();
    renderEditor();
  }

  async function loadVersions(docId) {
    const res = await authApiRequest(session, `/api/documents/${docId}/versions`, { method: 'GET' });
    versions = res.success && res.data ? res.data.items || [] : [];
  }

  function renderLibrary() {
    clearContainer(libraryList);
    if (docs.length === 0) {
      libraryList.appendChild(
        el('div', { className: 'empty-state' }, [
          el('p', { className: 'card-text', textContent: 'No documents match your filters yet.' }),
          el('div', { style: 'margin-top: 0.75rem;' }, [
            el('a', { href: '/application-studio.html', className: 'btn btn-secondary btn-sm', textContent: 'Create in Application Studio' }),
          ]),
        ])
      );
      return;
    }

    docs.forEach((doc) => {
      const active = selectedDoc && selectedDoc.id === doc.id;
      libraryList.appendChild(
        el('div', {
          className: 'record-item',
          style: active ? 'border-color: var(--color-blue); background-color: var(--color-blue-subtle);' : '',
        }, [
          el('div', {}, [
            el('strong', { textContent: doc.document_title }),
            el('p', { className: 'card-text', textContent: `v${doc.current_version || 1} · ${formatDateTime(doc.updated_at)}` }),
            el('div', { style: 'display: flex; gap: 0.4rem; margin-top: 0.35rem; flex-wrap: wrap;' }, [
              el('span', { className: statusBadgeClass(doc.document_status), textContent: doc.document_status }),
              el('span', { className: 'status-badge', textContent: doc.document_type.replace(/_/g, ' ') }),
            ]),
          ]),
          el('div', { className: 'record-item-actions' }, [
            el('button', {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
              textContent: 'Open',
              onClick: async () => {
                selectedDoc = doc;
                await loadVersions(doc.id);
                renderLibrary();
                renderEditor();
              },
            }),
            el('button', {
              type: 'button',
              className: 'btn btn-danger btn-sm',
              textContent: 'Delete',
              onClick: async () => {
                const res = await authApiRequest(session, `/api/documents/${doc.id}`, { method: 'DELETE' });
                if (!res.success) return showAlert(alertBox, res.message, 'error');
                if (selectedDoc && selectedDoc.id === doc.id) selectedDoc = null;
                await loadDocuments();
              },
            }),
          ]),
        ])
      );
    });
  }

  function buildPreviewSheet(doc, content, tpl) {
    const sheet = el('div', { className: `doc-preview-sheet tpl-${tpl}` });
    const header = content.header || {};
    sheet.appendChild(el('h2', { textContent: header.full_name || doc.document_title }));

    const contacts = [header.headline, header.email, header.phone, header.location, header.portfolio_url].filter(Boolean);
    if (contacts.length) {
      sheet.appendChild(el('p', { className: 'card-text', style: 'margin-bottom: 0.75rem;', textContent: contacts.join('  |  ') }));
    }

    if (content.summary) {
      sheet.appendChild(
        el('div', { className: 'doc-preview-section' }, [
          el('h3', { textContent: 'Professional Summary' }),
          el('p', { textContent: content.summary }),
        ])
      );
    }

    (content.sections || []).forEach((sec) => {
      const secNode = el('div', { className: 'doc-preview-section' }, [
        sec.heading ? el('h3', { textContent: sec.heading }) : null,
      ]);
      if (sec.body) secNode.appendChild(el('p', { textContent: sec.body }));
      (sec.entries || []).forEach((entry) => {
        const titleLine = [entry.title, entry.meta].filter(Boolean).join(' — ');
        if (titleLine) secNode.appendChild(el('p', { style: 'font-weight: 600; margin-top: 0.5rem;', textContent: titleLine }));
        if (entry.description) secNode.appendChild(el('p', { textContent: entry.description }));
        if (entry.bullets && entry.bullets.length) {
          secNode.appendChild(
            el('ul', { className: 'doc-preview-bullets' }, entry.bullets.map((b) => el('li', { textContent: b })))
          );
        }
      });
      if (sec.bullets && sec.bullets.length) {
        secNode.appendChild(
          el('ul', { className: 'doc-preview-bullets' }, sec.bullets.map((b) => el('li', { textContent: b })))
        );
      }
      sheet.appendChild(secNode);
    });

    (content.paragraphs || []).forEach((p) => {
      if (String(p || '').trim()) {
        sheet.appendChild(el('p', { style: 'margin-top: 0.65rem;', textContent: p }));
      }
    });

    if (content.closing) {
      sheet.appendChild(el('p', { style: 'margin-top: 1rem; white-space: pre-line;', textContent: content.closing }));
    }

    return sheet;
  }

  function renderEditor() {
    clearContainer(editorPanel);
    if (!selectedDoc) {
      editorPanel.appendChild(
        el('div', { className: 'empty-state' }, [
          el('p', { className: 'card-text', textContent: 'Select a document from the library to edit, switch templates, approve, restore versions, or download PDF/DOCX.' }),
        ])
      );
      return;
    }

    const content = structuredClone(selectedDoc.structured_content || {});
    const header = content.header || {};

    const titleIn = el('input', { type: 'text', className: 'form-input', value: selectedDoc.document_title || '' });
    const tplSel = el('select', { className: 'form-input' }, [
      el('option', { value: 'classic_professional', textContent: 'Classic Professional' }),
      el('option', { value: 'modern_minimalist', textContent: 'Modern Minimalist' }),
      el('option', { value: 'technical_engineering', textContent: 'Technical & Engineering' }),
      el('option', { value: 'graduate_entry_level', textContent: 'Graduate / Entry-Level' }),
    ]);
    tplSel.value = selectedDoc.template || 'classic_professional';

    const hdrName = el('input', { type: 'text', className: 'form-input', value: header.full_name || '' });
    const hdrHeadline = el('input', { type: 'text', className: 'form-input', value: header.headline || '' });
    const hdrEmail = el('input', { type: 'text', className: 'form-input', value: header.email || '' });
    const hdrPhone = el('input', { type: 'text', className: 'form-input', value: header.phone || '' });
    const hdrLoc = el('input', { type: 'text', className: 'form-input', value: header.location || '' });
    const summaryArea = el('textarea', { className: 'form-input' });
    summaryArea.value = content.summary || '';

    const sections = Array.isArray(content.sections) ? content.sections : [];
    const sectionControls = sections.map((sec) => {
      const hIn = el('input', { type: 'text', className: 'form-input', value: sec.heading || '' });
      const bodyIn = el('textarea', { className: 'form-input' });
      bodyIn.value = sec.body || '';
      const bulletsIn = el('textarea', { className: 'form-input', placeholder: 'One bullet per line' });
      bulletsIn.value = (sec.bullets || []).join('\n');

      const entryControls = (sec.entries || []).map((entry) => {
        const eTitle = el('input', { type: 'text', className: 'form-input', value: entry.title || '' });
        const eMeta = el('input', { type: 'text', className: 'form-input', value: entry.meta || '' });
        const eDesc = el('textarea', { className: 'form-input' });
        eDesc.value = entry.description || '';
        const eBullets = el('textarea', { className: 'form-input', placeholder: 'One bullet per line' });
        eBullets.value = (entry.bullets || []).join('\n');
        return { eTitle, eMeta, eDesc, eBullets };
      });

      return { hIn, bodyIn, bulletsIn, entryControls };
    });

    const parasArea = el('textarea', { className: 'form-input', placeholder: 'Letter or statement paragraphs separated by a blank line' });
    parasArea.value = (content.paragraphs || []).join('\n\n');
    const closingArea = el('textarea', { className: 'form-input' });
    closingArea.value = content.closing || '';

    const previewBox = el('div', {});

    function collectEditedContent() {
      return {
        header: {
          ...header,
          full_name: hdrName.value.trim(),
          headline: hdrHeadline.value.trim(),
          email: hdrEmail.value.trim(),
          phone: hdrPhone.value.trim(),
          location: hdrLoc.value.trim(),
        },
        summary: summaryArea.value.trim(),
        sections: sectionControls.map((sc) => ({
          heading: sc.hIn.value.trim(),
          body: sc.bodyIn.value.trim(),
          bullets: sc.bulletsIn.value.split('\n').map((b) => b.trim()).filter(Boolean),
          entries: sc.entryControls.map((ec) => ({
            title: ec.eTitle.value.trim(),
            meta: ec.eMeta.value.trim(),
            description: ec.eDesc.value.trim(),
            bullets: ec.eBullets.value.split('\n').map((b) => b.trim()).filter(Boolean),
          })),
        })),
        paragraphs: parasArea.value.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
        closing: closingArea.value.trim(),
      };
    }

    function refreshLivePreview() {
      clearContainer(previewBox);
      previewBox.appendChild(buildPreviewSheet(selectedDoc, collectEditedContent(), tplSel.value));
    }

    // Header actions toolbar (Approve, Export PDF, Export DOCX)
    const actionsBar = el('div', { style: 'display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem;' }, [
      el('div', { style: 'display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;' }, [
        el('span', { className: statusBadgeClass(selectedDoc.document_status), textContent: selectedDoc.document_status }),
        el('span', { className: 'status-badge', textContent: `Version ${selectedDoc.current_version || 1}` }),
      ]),
      el('div', { style: 'display: flex; flex-wrap: wrap; gap: 0.5rem;' }, [
        el('button', {
          type: 'button',
          className: 'btn btn-secondary btn-sm',
          textContent: 'Approve for Use',
          onClick: async () => {
            const res = await authApiRequest(session, `/api/documents/${selectedDoc.id}/approve`, { method: 'POST' });
            if (!res.success) return showAlert(alertBox, res.message, 'error');
            showAlert(alertBox, 'Document marked as Approved.', 'success');
            await loadDocuments(selectedDoc.id);
          },
        }),
        el('button', {
          type: 'button',
          className: 'btn btn-secondary btn-sm',
          textContent: 'Download PDF',
          onClick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              await downloadAuthenticatedBlob(session, `/api/documents/${selectedDoc.id}/export?format=pdf`, 'document.pdf');
            } catch (err) {
              showAlert(alertBox, err.message, 'error');
            } finally {
              btn.disabled = false;
            }
          },
        }),
        el('button', {
          type: 'button',
          className: 'btn btn-secondary btn-sm',
          textContent: 'Download DOCX',
          onClick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              await downloadAuthenticatedBlob(session, `/api/documents/${selectedDoc.id}/export?format=docx`, 'document.docx');
            } catch (err) {
              showAlert(alertBox, err.message, 'error');
            } finally {
              btn.disabled = false;
            }
          },
        }),
      ]),
    ]);

    editorPanel.appendChild(actionsBar);

    const form = el('form', {
      className: 'form-stack',
      onInput: refreshLivePreview,
      onSubmit: async (e) => {
        e.preventDefault();
        clearAlert(alertBox);
        const res = await authApiRequest(session, `/api/documents/${selectedDoc.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            document_title: titleIn.value.trim(),
            template: tplSel.value,
            structured_content: collectEditedContent(),
          }),
        });
        if (!res.success) return showAlert(alertBox, res.message, 'error');
        showAlert(alertBox, 'Changes saved as a new version.', 'success');
        await loadDocuments(selectedDoc.id);
      },
    }, [
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Document Title' }), titleIn]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Layout Template' }), tplSel]),
      ]),
      el('div', { className: 'form-row-3' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Header Name' }), hdrName]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Headline' }), hdrHeadline]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Location' }), hdrLoc]),
      ]),
      el('div', { className: 'form-row-2' }, [
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Email' }), hdrEmail]),
        el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Phone' }), hdrPhone]),
      ]),
      el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Summary' }), summaryArea]),
    ]);

    tplSel.addEventListener('change', refreshLivePreview);

    sectionControls.forEach((sc, idx) => {
      const secBox = el('div', { className: 'card', style: 'background-color: var(--color-bg); padding: 1rem;' }, [
        el('div', { className: 'form-group', style: 'margin-bottom: 0.75rem;' }, [
          el('label', { className: 'form-label', textContent: `Section ${idx + 1} Heading` }),
          sc.hIn,
        ]),
      ]);
      if (sc.bodyIn.value || sc.entryControls.length === 0) {
        secBox.appendChild(
          el('div', { className: 'form-group', style: 'margin-bottom: 0.75rem;' }, [
            el('label', { className: 'form-label', textContent: 'Section Text' }),
            sc.bodyIn,
          ])
        );
      }
      sc.entryControls.forEach((ec) => {
        secBox.appendChild(
          el('div', { style: 'border-top: 1px solid var(--color-border); padding-top: 0.75rem; margin-top: 0.75rem;' }, [
            el('div', { className: 'form-row-2' }, [
              el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Entry Title' }), ec.eTitle]),
              el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Dates / Meta' }), ec.eMeta]),
            ]),
            ec.eDesc.value
              ? el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Description' }), ec.eDesc])
              : null,
            el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Bullets (one per line)' }), ec.eBullets]),
          ])
        );
      });
      if (sc.bulletsIn.value || sc.entryControls.length === 0) {
        secBox.appendChild(
          el('div', { className: 'form-group', style: 'margin-top: 0.5rem;' }, [
            el('label', { className: 'form-label', textContent: 'Section Bullets (one per line)' }),
            sc.bulletsIn,
          ])
        );
      }
      form.appendChild(secBox);
    });

    if (parasArea.value || sections.length === 0) {
      form.appendChild(el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Paragraphs' }), parasArea]));
    }
    if (closingArea.value || selectedDoc.document_type === 'cover_letter') {
      form.appendChild(el('div', { className: 'form-group' }, [el('label', { className: 'form-label', textContent: 'Closing' }), closingArea]));
    }

    form.appendChild(
      el('div', { style: 'display: flex; gap: 0.75rem;' }, [
        el('button', { type: 'submit', className: 'btn btn-primary', textContent: 'Save Edits as New Version' }),
      ])
    );

    editorPanel.appendChild(form);
    editorPanel.appendChild(el('h3', { className: 'card-title', style: 'margin-top: 2rem;', textContent: 'Live Formatted Preview' }));
    refreshLivePreview();
    editorPanel.appendChild(previewBox);

    // Version history panel
    editorPanel.appendChild(el('h3', { className: 'card-title', style: 'margin-top: 2rem;', textContent: 'Version History' }));
    const verList = el('div', { className: 'record-list' });
    versions.forEach((v) => {
      verList.appendChild(
        el('div', { className: 'record-item' }, [
          el('div', {}, [
            el('strong', { textContent: `Version ${v.version_number}` }),
            el('p', { className: 'card-text', textContent: `${v.template_snapshot.replace(/_/g, ' ')} · ${formatDateTime(v.created_at)}` }),
          ]),
          v.version_number === selectedDoc.current_version
            ? el('span', { className: 'status-badge status-badge-success', textContent: 'Current' })
            : el('button', {
                type: 'button',
                className: 'btn btn-secondary btn-sm',
                textContent: 'Restore Version',
                onClick: async () => {
                  const res = await authApiRequest(session, `/api/documents/${selectedDoc.id}/restore`, {
                    method: 'POST',
                    body: JSON.stringify({ version_number: v.version_number }),
                  });
                  if (!res.success) return showAlert(alertBox, res.message, 'error');
                  showAlert(alertBox, res.message, 'success');
                  await loadDocuments(selectedDoc.id);
                },
              }),
        ])
      );
    });
    editorPanel.appendChild(verList);
  }

  let debounceTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => loadDocuments(), 250);
  });
  typeFilter.addEventListener('change', () => loadDocuments());
  statusFilter.addEventListener('change', () => loadDocuments());

  await loadDocuments(new URLSearchParams(window.location.search).get('doc'));
});

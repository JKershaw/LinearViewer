/**
 * Custom Prompts Page Client-Side Logic
 *
 * Handles CRUD operations for custom prompt templates via AJAX.
 */
(function () {
  'use strict';

  const listEl = document.querySelector('.custom-prompts-list');
  if (!listEl) return;

  const urlKey = listEl.dataset.urlKey;
  const apiBase = `/workspace/${encodeURIComponent(urlKey)}/api/prompts/custom`;

  const editorEl = document.querySelector('.custom-prompt-editor');
  const nameInput = document.querySelector('.custom-prompt-name-input');
  const templateInput = document.querySelector('.custom-prompt-template-input');
  const saveBtn = document.querySelector('.custom-prompt-save-btn');
  const cancelBtn = document.querySelector('.custom-prompt-cancel-btn');
  const newBtn = document.querySelector('.custom-prompt-new-btn');
  const charCount = document.querySelector('.editor-char-count');
  const countDisplay = document.querySelector('.custom-prompts-count');

  let editingId = null; // null = creating new, string = editing existing

  // =========================================================================
  // Editor state
  // =========================================================================

  function updateSaveState() {
    const hasName = nameInput.value.trim().length > 0;
    const hasTemplate = templateInput.value.trim().length > 0;
    saveBtn.disabled = !hasName || !hasTemplate;
  }

  function updateCharCount() {
    charCount.textContent = `${templateInput.value.length} chars`;
  }

  function showEditor(promptData) {
    editingId = promptData ? promptData.id : null;
    nameInput.value = promptData ? promptData.name : '';
    templateInput.value = promptData ? promptData.template : '';
    updateCharCount();
    updateSaveState();
    editorEl.hidden = false;
    nameInput.focus();
  }

  function hideEditor() {
    editorEl.hidden = true;
    editingId = null;
    nameInput.value = '';
    templateInput.value = '';
  }

  // =========================================================================
  // API calls
  // =========================================================================

  async function createPrompt(name, template) {
    const res = await fetch(apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, template })
    });
    if (!res.ok) throw new Error('Failed to create prompt');
    return (await res.json()).prompt;
  }

  async function updatePrompt(id, name, template) {
    const res = await fetch(`${apiBase}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, template })
    });
    if (!res.ok) throw new Error('Failed to update prompt');
    return (await res.json()).prompt;
  }

  async function deletePrompt(id) {
    const res = await fetch(`${apiBase}/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to delete prompt');
  }

  // =========================================================================
  // DOM rendering
  // =========================================================================

  function renderCard(prompt) {
    const charCount = prompt.template.length;
    const card = document.createElement('div');
    // Mirror the server renderer (lib/render-custom-prompts.js → renderCard):
    // canonical `.card`/`.card-header` chrome with the `.custom-prompt-*` names
    // kept as no-style E2E/JS hooks, so live-inserted cards match reloaded ones.
    card.className = 'card custom-prompt-card';
    card.dataset.promptId = prompt.id;
    card.innerHTML = `
      <div class="card-header custom-prompt-header">
        <span class="custom-prompt-name">${window.escapeHtml(prompt.name)}</span>
        <span class="prompt-chars">${charCount.toLocaleString()} chars</span>
      </div>
      <pre class="custom-prompt-preview">${window.escapeHtml(prompt.template)}</pre>
      <div class="custom-prompt-actions">
        <button class="action-btn save custom-prompt-edit-btn" data-prompt-id="${window.escapeHtml(prompt.id)}">edit</button>
        <button class="action-btn disconnect custom-prompt-delete-btn" data-prompt-id="${window.escapeHtml(prompt.id)}">delete</button>
      </div>`;
    return card;
  }

  function updateCount() {
    const cards = listEl.querySelectorAll('.custom-prompt-card');
    if (countDisplay) countDisplay.textContent = `${cards.length} / 20`;
  }

  function showEmptyState() {
    if (listEl.querySelectorAll('.custom-prompt-card').length === 0) {
      const empty = listEl.querySelector('.custom-prompts-empty');
      if (!empty) {
        const el = document.createElement('div');
        el.className = 'custom-prompts-empty';
        el.textContent = 'No custom prompts yet. Create one to get started.';
        listEl.appendChild(el);
      }
    }
  }

  function removeEmptyState() {
    const empty = listEl.querySelector('.custom-prompts-empty');
    if (empty) empty.remove();
  }

  // =========================================================================
  // Event handlers
  // =========================================================================

  nameInput.addEventListener('input', updateSaveState);
  templateInput.addEventListener('input', () => {
    updateSaveState();
    updateCharCount();
  });

  newBtn.addEventListener('click', () => {
    showEditor(null);
  });

  cancelBtn.addEventListener('click', () => {
    hideEditor();
  });

  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const template = templateInput.value.trim();
    if (!name || !template) return;

    try {
      saveBtn.disabled = true;
      saveBtn.textContent = 'saving...';

      let prompt;
      if (editingId) {
        prompt = await updatePrompt(editingId, name, template);
        // Replace existing card
        const existing = listEl.querySelector(`[data-prompt-id="${editingId}"]`);
        if (existing) existing.replaceWith(renderCard(prompt));
      } else {
        prompt = await createPrompt(name, template);
        removeEmptyState();
        listEl.appendChild(renderCard(prompt));
      }

      hideEditor();
      updateCount();
    } catch (err) {
      saveBtn.textContent = 'error';
      setTimeout(() => { saveBtn.textContent = 'save'; saveBtn.disabled = false; }, 2000);
    }
  });

  // Delegate click events on the list
  listEl.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.custom-prompt-edit-btn');
    const deleteBtn = e.target.closest('.custom-prompt-delete-btn');

    if (editBtn) {
      const card = editBtn.closest('.custom-prompt-card');
      const id = card.dataset.promptId;
      const name = card.querySelector('.custom-prompt-name').textContent;
      const template = card.querySelector('.custom-prompt-preview').textContent;
      showEditor({ id, name, template });
    }

    if (deleteBtn) {
      if (!confirm('Delete this custom prompt?')) return;
      const card = deleteBtn.closest('.custom-prompt-card');
      const id = card.dataset.promptId;
      try {
        await deletePrompt(id);
        card.remove();
        showEmptyState();
        updateCount();
      } catch (err) {
        // Non-fatal
      }
    }
  });
})();

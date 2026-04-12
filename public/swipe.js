/**
 * Swipe Page - Client-Side Logic
 *
 * Mobile-first task card swiping with prompt generation and dispatch.
 */

// ==========================================================================
// State
// ==========================================================================

const data = window.__SWIPE_DATA__ || {};
const allIssues = data.issues || [];
const filters = data.filters || [];
const promptMeta = data.promptMeta || {};
const defaultPromptKeys = data.defaultPromptKeys || [];
const morePromptKeys = data.morePromptKeys || [];
const customPrompts = data.customPrompts || [];
const urlKey = data.urlKey || '';
const hasAI = data.hasAI || false;
const dispatchEnabled = data.dispatchEnabled || false;
const proxyEnabled = data.proxyEnabled || false;
const initialIdentifier = data.initialIdentifier || null;

// Build reverse lookup: issueId → array of issues that block it (incomplete only)
const blockedByMap = new Map();
for (const issue of allIssues) {
  const isFinished = issue.stateType === 'completed' || issue.stateType === 'canceled';
  if (isFinished) continue;
  for (const blockedId of issue.blocksIds || []) {
    if (!blockedByMap.has(blockedId)) blockedByMap.set(blockedId, []);
    blockedByMap.get(blockedId).push(issue);
  }
}
const issueById = new Map(allIssues.map(i => [i.id, i]));

let currentFilter = filters.length > 0 ? filters[0].key : '';
let filteredIssues = [];
let currentIndex = 0;
let promptCache = {}; // 'issueId:label' -> {label, name, raw, html}
let lastPromptLabel = {}; // issueId -> last active label
let activePromptLabel = null;
let activePromptFetch = null;
let moreVisible = false;

// Animation state
let animationTimers = [];

// Swipe state
let touchStartX = 0;
let touchStartY = 0;
let touchCurrentX = 0;
let isSwiping = false;
let swipeDirection = null; // 'horizontal' or 'vertical' or null
let isMouseDragging = false; // tracks mouse-initiated swipes

// DOM elements
const card = document.getElementById('swipe-card');
const counter = document.getElementById('swipe-counter');
const promptButtons = document.getElementById('swipe-prompt-buttons');
const promptResult = document.getElementById('swipe-prompt-result');
const promptName = document.getElementById('swipe-prompt-name');
const promptText = document.getElementById('swipe-prompt-text');
const promptActions = document.getElementById('swipe-prompt-actions');
const filterSelect = document.querySelector('.swipe-filter-select');
const arrowLeft = document.querySelector('.swipe-arrow-left');
const arrowRight = document.querySelector('.swipe-arrow-right');

// ==========================================================================
// Markdown Rendering
// ==========================================================================

/**
 * Strip wrapping code-block fences that some AI models add around prompts.
 * Handles ```markdown ... ``` , ``` ... ``` , and similar.
 * Only strips when the entire text is wrapped in a single fence.
 */
function stripCodeBlockWrapper(text) {
  if (!text) return text;
  const m = text.match(/^\s*```[a-z]*\s*\n([\s\S]*?)\n\s*```\s*$/);
  return m ? m[1] : text;
}

/**
 * Render markdown to HTML using marked.js + DOMPurify
 * @param {string} text - Raw markdown
 * @returns {string} Safe HTML
 */
function renderMarkdown(text) {
  if (!text) return '';
  const cleaned = stripCodeBlockWrapper(text);
  const html = typeof marked !== 'undefined' ? marked.parse(cleaned) : window.escapeHtml(cleaned);
  return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(html) : html;
}

/**
 * Escape HTML - delegates to window.escapeHtml from common.js.
 * Named _esc to avoid overwriting the global function.
 */
function _esc(str) {
  return window.escapeHtml(str);
}

// ==========================================================================
// Relative Time
// ==========================================================================

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

// ==========================================================================
// URL Deep-Linking
// ==========================================================================

// Base path for swipe URLs — workspace-prefixed when authenticated, root when landing
const swipeBase = urlKey ? `/workspace/${encodeURIComponent(urlKey)}/swipe` : '/swipe';

function updateUrl() {
  const issue = filteredIssues[currentIndex];
  const path = issue && issue.identifier ? `${swipeBase}/${encodeURIComponent(issue.identifier)}` : swipeBase;
  history.replaceState(null, '', path + window.location.search);
  document.title = issue && issue.identifier ? `Swipe - ${issue.identifier} ${issue.title}` : 'Swipe - Tasks';
}

/**
 * Navigate to a specific issue by identifier within the current filtered set.
 * Returns true if the issue was found and navigated to, false otherwise.
 */
function navigateToIdentifier(identifier) {
  const idx = filteredIssues.findIndex(i => i.identifier === identifier);
  if (idx === -1) return false;
  currentIndex = idx;
  updateArrows();
  updateCounter();
  renderPromptButtons();
  renderCard();
  updateUrl();
  return true;
}

// ==========================================================================
// Filtering
// ==========================================================================

function applyFilter(filterKey) {
  currentFilter = filterKey;

  if (filterKey === 'all') {
    filteredIssues = allIssues;
  } else if (filterKey === 'in-progress') {
    filteredIssues = allIssues.filter(i => i.stateType === 'started');
  } else if (filterKey === 'recent-activity') {
    filteredIssues = allIssues.filter(i => i.section === 'recent-activity');
  } else if (filterKey.startsWith('project:')) {
    const projectName = filterKey.slice(8);
    const projectIssues = allIssues.filter(i => i.projectName === projectName);
    // Put in-progress issues first so the user can swipe back to see them
    const started = projectIssues.filter(i => i.stateType === 'started');
    const rest = projectIssues.filter(i => i.stateType !== 'started');
    filteredIssues = [...started, ...rest];
  } else {
    filteredIssues = allIssues;
  }

  // For project filters, start on the first non-in-progress issue
  // so the user lands on actionable work (they can swipe back for in-progress)
  if (filterKey.startsWith('project:')) {
    const firstNonStarted = filteredIssues.findIndex(i => i.stateType !== 'started');
    currentIndex = firstNonStarted !== -1 ? firstNonStarted : 0;
  } else {
    currentIndex = 0;
  }
  activePromptLabel = null;
  renderCard();
  renderPromptButtons();
  updateArrows();
  updateCounter();
  updateUrl();
}

// ==========================================================================
// Card Rendering
// ==========================================================================

function getStateInfo(stateType) {
  switch (stateType) {
    case 'completed':
    case 'canceled':
      return { char: '\u2713', cls: 'done' };
    case 'started':
      return { char: '\u25D0', cls: 'in-progress' };
    case 'backlog':
      return { char: '\u25CC', cls: 'backlog' };
    default:
      return { char: '\u25CB', cls: 'todo' };
  }
}

function renderPriorityDots(priority) {
  if (!priority || priority === 0) return '';
  // Priority: 1=Urgent, 2=High, 3=Medium, 4=Low
  const filled = Math.max(0, 5 - priority);
  const empty = 4 - filled;
  return '<span class="priority-dots">' +
    '<span class="filled">' + '\u25CF'.repeat(filled) + '</span>' +
    '<span class="empty">' + '\u25CB'.repeat(empty) + '</span>' +
    '</span>';
}

function renderCard(direction) {
  const issue = filteredIssues[currentIndex];

  if (!issue) {
    card.innerHTML = '<div class="swipe-card-empty">No tasks in this view</div>';
    promptResult.classList.add('hidden');
    return;
  }

  const state = getStateInfo(issue.stateType);
  const titleClass = state.cls === 'done' ? 'swipe-card-title done' : 'swipe-card-title';
  const total = filteredIssues.length;

  // Build meta rows
  let metaHtml = '';

  if (issue.projectName) {
    metaHtml += `<div class="swipe-card-meta-row">
      <span class="swipe-card-meta-label">Project</span>
      <span class="swipe-card-meta-value">${_esc(issue.projectName)}</span>
    </div>`;
  }

  if (issue.priority && issue.priority > 0) {
    const priorityNames = { 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' };
    metaHtml += `<div class="swipe-card-meta-row">
      <span class="swipe-card-meta-label">Priority</span>
      <span class="swipe-card-meta-value">${renderPriorityDots(issue.priority)} ${priorityNames[issue.priority] || ''}</span>
    </div>`;
  }

  if (issue.labels && issue.labels.length > 0) {
    const labelsHtml = issue.labels.map(l => `<span class="swipe-label-tag">${_esc(l)}</span>`).join('');
    metaHtml += `<div class="swipe-card-meta-row">
      <span class="swipe-card-meta-label">Labels</span>
      <span class="swipe-card-labels">${labelsHtml}</span>
    </div>`;
  }

  if (issue.dueDate) {
    metaHtml += `<div class="swipe-card-meta-row">
      <span class="swipe-card-meta-label">Due</span>
      <span class="swipe-card-meta-value">${formatRelativeTime(issue.dueDate)}</span>
    </div>`;
  }

  if (issue.completedAt) {
    metaHtml += `<div class="swipe-card-meta-row">
      <span class="swipe-card-meta-label">Done</span>
      <span class="swipe-card-meta-value">${formatRelativeTime(issue.completedAt)}</span>
    </div>`;
  }

  // Blocking relationship rows
  const blocksTargets = (issue.blocksIds || [])
    .map(id => issueById.get(id))
    .filter(i => i && i.stateType !== 'completed' && i.stateType !== 'canceled');
  const blockedBySources = blockedByMap.get(issue.id) || [];

  if (blocksTargets.length > 0) {
    const names = blocksTargets.map(i => {
      const display = _esc(i.identifier || i.title);
      if (i.identifier) {
        return `<a href="${swipeBase}/${encodeURIComponent(i.identifier)}" class="swipe-blocking-issue" data-navigate-identifier="${_esc(i.identifier)}" title="${_esc(i.title)}">${display}</a>`;
      }
      return `<span class="swipe-blocking-issue">${display}</span>`;
    }).join(', ');
    metaHtml += `<div class="swipe-card-meta-row swipe-meta-blocks">
      <span class="swipe-card-meta-label">Blocks</span>
      <span class="swipe-card-meta-value">${names}</span>
    </div>`;
  }

  if (blockedBySources.length > 0) {
    const names = blockedBySources.map(i => {
      const display = _esc(i.identifier || i.title);
      if (i.identifier) {
        return `<a href="${swipeBase}/${encodeURIComponent(i.identifier)}" class="swipe-blocking-issue" data-navigate-identifier="${_esc(i.identifier)}" title="${_esc(i.title)}">${display}</a>`;
      }
      return `<span class="swipe-blocking-issue">${display}</span>`;
    }).join(', ');
    metaHtml += `<div class="swipe-card-meta-row swipe-meta-blocked">
      <span class="swipe-card-meta-label">Blocked by</span>
      <span class="swipe-card-meta-value">${names}</span>
    </div>`;
  }

  // Parent/subtask relationship rows
  if (issue.parentInfo) {
    const p = issue.parentInfo;
    const stateCls = getStateInfo(p.stateType).cls;
    const display = _esc(p.identifier || p.title);
    let nameHtml;
    if (p.identifier) {
      nameHtml = `<a href="${swipeBase}/${encodeURIComponent(p.identifier)}" class="swipe-relation-issue swipe-relation-${stateCls}" data-navigate-identifier="${_esc(p.identifier)}" title="${_esc(p.title)}">${display}</a>`;
    } else {
      nameHtml = `<span class="swipe-relation-issue swipe-relation-${stateCls}">${display}</span>`;
    }
    metaHtml += `<div class="swipe-card-meta-row swipe-meta-parent">
      <span class="swipe-card-meta-label">Parent</span>
      <span class="swipe-card-meta-value">${nameHtml}</span>
    </div>`;
  }

  if (issue.subtasks && issue.subtasks.length > 0) {
    const subtasksHtml = issue.subtasks.map(s => {
      const stateCls = getStateInfo(s.stateType).cls;
      const display = _esc(s.identifier || s.title);
      if (s.identifier) {
        return `<a href="${swipeBase}/${encodeURIComponent(s.identifier)}" class="swipe-relation-issue swipe-relation-${stateCls}" data-navigate-identifier="${_esc(s.identifier)}" title="${_esc(s.title)}">${display}</a>`;
      }
      return `<span class="swipe-relation-issue swipe-relation-${stateCls}">${display}</span>`;
    }).join(' ');
    metaHtml += `<div class="swipe-card-meta-row swipe-meta-subtasks">
      <span class="swipe-card-meta-label">Subtasks</span>
      <span class="swipe-card-meta-value">${subtasksHtml}</span>
    </div>`;
  }

  // Accordion sections
  let accordionHtml = '';

  if (issue.description) {
    accordionHtml += `
    <div class="swipe-card-accordion">
      <div class="swipe-accordion-header" data-accordion="description">
        <span class="swipe-accordion-toggle">\u25B6</span> Description
      </div>
      <div class="swipe-accordion-body" data-accordion-body="description">
        ${renderMarkdown(issue.description)}
      </div>
    </div>`;
  }

  // Comments accordion (lazy loaded) — only available when authenticated
  if (urlKey) {
    accordionHtml += `
  <div class="swipe-card-accordion">
    <div class="swipe-accordion-header" data-accordion="comments">
      <span class="swipe-accordion-toggle">\u25B6</span> Comments
    </div>
    <div class="swipe-accordion-body" data-accordion-body="comments">
      <div class="swipe-comments-loading">Loading comments...</div>
    </div>
  </div>`;
  }

  // Linear link
  const linkHtml = issue.url
    ? `<div class="swipe-card-link"><a href="${_esc(issue.url)}" target="_blank">View in Linear \u2192</a></div>`
    : '';

  const html = `
    <div class="swipe-card-accent ${state.cls}"></div>
    <div class="swipe-card-inner">
      <div class="swipe-card-header">
        <div class="swipe-card-status">
          <span class="state ${state.cls}">${state.char}</span>
          <span class="swipe-card-identifier">${_esc(issue.identifier)}</span>
        </div>
        <span class="swipe-card-position">${currentIndex + 1} / ${total}</span>
      </div>
      <div class="${titleClass}">${_esc(issue.title)}</div>
      <div class="swipe-card-meta">${metaHtml}</div>
      ${accordionHtml}
      ${linkHtml}
    </div>
  `;

  // Animate transition
  if (direction) {
    animateCardTransition(html, direction);
  } else {
    card.innerHTML = html;
  }

  // Restore cached prompt if this card had one before
  const lastLabel = lastPromptLabel[issue.id];
  const cached = lastLabel ? promptCache[`${issue.id}:${lastLabel}`] : null;
  if (cached) {
    promptName.textContent = cached.name;
    promptText.innerHTML = cached.html;
    promptText.dataset.rawPrompt = cached.raw;
    promptResult.classList.remove('hidden');
    activePromptLabel = cached.label;
    setPromptActionsEnabled(true);
  } else {
    promptResult.classList.add('hidden');
    activePromptLabel = null;
  }
}

// ==========================================================================
// Card Animation
// ==========================================================================

/**
 * Cancel any in-flight animation timers and reset inline styles.
 */
function clearAnimations() {
  for (const id of animationTimers) clearTimeout(id);
  animationTimers = [];
  card.classList.remove('exiting', 'entering', 'swiping');
  card.style.transition = '';
  card.style.transform = '';
  card.style.opacity = '';
}

function animateCardTransition(newHtml, direction) {
  clearAnimations();

  const enterX = direction === 'left' ? '110%' : '-110%';

  // Set new content immediately and position off-screen for entry
  card.innerHTML = newHtml;
  card.classList.add('entering');
  card.style.transition = 'none';
  card.style.transform = `translate3d(${enterX}, 0, 0)`;
  card.style.opacity = '0';

  // Force reflow
  card.offsetHeight;

  // Animate in
  card.style.transition = '';
  card.classList.remove('entering');
  card.style.transform = 'translate3d(0, 0, 0)';
  card.style.opacity = '1';

  // Clean up inline styles after transition completes
  const cleanup = setTimeout(() => {
    card.style.transform = '';
    card.style.opacity = '';
  }, 250);
  animationTimers.push(cleanup);
}

// ==========================================================================
// Navigation
// ==========================================================================

function goNext() {
  if (currentIndex >= filteredIssues.length - 1) {
    // Bounce effect at end
    clearAnimations();
    card.style.transform = 'translate3d(-20px, 0, 0)';
    const id = setTimeout(() => { card.style.transform = ''; }, 150);
    animationTimers.push(id);
    return;
  }
  currentIndex++;
  updateArrows();
  updateCounter();
  renderPromptButtons();
  renderCard('left');
  updateUrl();
}

function goPrev() {
  if (currentIndex <= 0) {
    // Bounce effect at start
    clearAnimations();
    card.style.transform = 'translate3d(20px, 0, 0)';
    const id = setTimeout(() => { card.style.transform = ''; }, 150);
    animationTimers.push(id);
    return;
  }
  currentIndex--;
  updateArrows();
  updateCounter();
  renderPromptButtons();
  renderCard('right');
  updateUrl();
}

function updateArrows() {
  arrowLeft.disabled = currentIndex <= 0;
  arrowRight.disabled = currentIndex >= filteredIssues.length - 1;
}

function updateCounter() {
  const total = filteredIssues.length;
  if (total === 0) {
    counter.innerHTML = '<span>No tasks</span>';
    return;
  }

  // Show dots for small sets, text for large
  const MAX_DOTS = 12;
  if (total <= MAX_DOTS) {
    const dots = Array.from({ length: total }, (_, i) =>
      `<span class="swipe-counter-dot${i === currentIndex ? ' active' : ''}"></span>`
    ).join('');
    counter.innerHTML = `<span class="swipe-counter-dots">${dots}</span>`;
  } else {
    counter.innerHTML = `<span>${currentIndex + 1} / ${total}</span>`;
  }
}

// ==========================================================================
// Touch / Swipe Handling
// ==========================================================================

const SWIPE_THRESHOLD = 0.3; // 30% of card width
const DIRECTION_LOCK_THRESHOLD = 10; // px before locking direction

function getPointerCoords(e) {
  if (e.touches) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function handleSwipeStart(e) {
  if (filteredIssues.length <= 1) return;
  // Don't interfere with accordion taps, links, or interactive elements
  if (e.target.closest('.swipe-accordion-header, a, button, select')) return;

  clearAnimations();
  const coords = getPointerCoords(e);
  touchStartX = coords.x;
  touchStartY = coords.y;
  touchCurrentX = touchStartX;
  isSwiping = true;
  swipeDirection = null;
  card.classList.add('swiping');
}

function handleSwipeMove(e) {
  if (!isSwiping) return;

  const coords = getPointerCoords(e);
  touchCurrentX = coords.x;
  const deltaX = touchCurrentX - touchStartX;
  const deltaY = coords.y - touchStartY;

  // Lock direction after threshold
  if (!swipeDirection) {
    if (Math.abs(deltaX) > DIRECTION_LOCK_THRESHOLD || Math.abs(deltaY) > DIRECTION_LOCK_THRESHOLD) {
      swipeDirection = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
    }
  }

  if (swipeDirection === 'vertical') {
    isSwiping = false;
    card.classList.remove('swiping');
    card.style.transform = '';
    card.style.opacity = '';
    return;
  }

  // Direction not yet determined — wait for more movement
  if (!swipeDirection) return;

  e.preventDefault();

  // Apply resistance at edges
  let translationX = deltaX;
  if ((currentIndex === 0 && deltaX > 0) || (currentIndex >= filteredIssues.length - 1 && deltaX < 0)) {
    translationX = deltaX * 0.3; // Rubber band effect
  }

  const progress = Math.abs(deltaX) / card.offsetWidth;
  const opacity = Math.max(0.4, 1 - progress * 0.6);

  card.style.transform = `translate3d(${translationX}px, 0, 0)`;
  card.style.opacity = opacity;
}

function handleSwipeEnd() {
  if (!isSwiping || swipeDirection !== 'horizontal') {
    isSwiping = false;
    isMouseDragging = false;
    return;
  }

  card.classList.remove('swiping');
  isSwiping = false;
  isMouseDragging = false;

  const deltaX = touchCurrentX - touchStartX;
  const cardWidth = card.offsetWidth;
  const progress = Math.abs(deltaX) / cardWidth;

  if (progress > SWIPE_THRESHOLD) {
    if (deltaX < 0 && currentIndex < filteredIssues.length - 1) {
      // Swipe left → next
      goNext();
      return;
    } else if (deltaX > 0 && currentIndex > 0) {
      // Swipe right → prev
      goPrev();
      return;
    }
  }

  // Snap back
  card.style.transform = 'translate3d(0, 0, 0)';
  card.style.opacity = '1';
  const snapBack = setTimeout(() => {
    card.style.transform = '';
    card.style.opacity = '';
  }, 300);
  animationTimers.push(snapBack);
}

// Mouse event wrappers for desktop swipe support
function handleMouseDown(e) {
  if (e.button !== 0) return; // left click only
  // On touch-enabled desktops (Surface, Chromebook) browsers fire both
  // touchstart and mousedown for the same gesture. Guard against re-entry
  // so we don't reset swipe state mid-gesture.
  if (isSwiping) return;
  isMouseDragging = true;
  handleSwipeStart(e);
}

function handleMouseMove(e) {
  if (!isMouseDragging) return;
  handleSwipeMove(e);
}

function handleMouseUp() {
  if (!isMouseDragging) return;
  handleSwipeEnd();
}

// ==========================================================================
// Accordion
// ==========================================================================

function handleAccordionClick(e) {
  const header = e.target.closest('.swipe-accordion-header');
  if (!header) return;

  e.preventDefault();
  e.stopPropagation();

  const type = header.dataset.accordion;
  const body = header.nextElementSibling;

  if (!body) return;

  const isOpen = header.classList.contains('open');
  header.classList.toggle('open');
  body.classList.toggle('open');

  // Lazy load comments on first open
  if (type === 'comments' && !isOpen && body.querySelector('.swipe-comments-loading')) {
    loadComments(body);
  }
}

async function loadComments(container) {
  const issue = filteredIssues[currentIndex];
  if (!issue) return;

  const apiPrefix = urlKey ? `/workspace/${encodeURIComponent(urlKey)}` : '';

  try {
    const response = await fetch(`${apiPrefix}/api/comments/${encodeURIComponent(issue.id)}`);
    if (!response.ok) throw new Error('Failed to load comments');

    const result = await response.json();
    const comments = result.comments || [];

    if (comments.length === 0) {
      container.innerHTML = '<div class="swipe-comments-loading">No comments</div>';
      return;
    }

    container.innerHTML = comments.map(c => `
      <div class="swipe-comment">
        <div class="swipe-comment-header">
          <span>${_esc(c.user || 'Unknown')}</span>
          <span>${formatRelativeTime(c.createdAt)}</span>
        </div>
        <div class="swipe-comment-body">${renderMarkdown(c.body)}</div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<div class="swipe-comments-loading">Could not load comments</div>';
  }
}

// ==========================================================================
// Prompt Buttons
// ==========================================================================

function renderPromptButtons() {
  // Prompt buttons require API access — not available for unauthenticated users
  if (!urlKey) {
    promptButtons.innerHTML = '';
    return;
  }

  const issue = filteredIssues[currentIndex];
  if (!issue) {
    promptButtons.innerHTML = '';
    return;
  }

  const isCompleted = ['completed', 'canceled'].includes(issue.stateType);
  let html = '';

  // AI suggest button
  if (hasAI) {
    html += `<button class="swipe-prompt-btn ai-btn${activePromptLabel === '__ai__' ? ' active' : ''}" data-prompt="__ai__">\u2726 AI Recommend</button>`;
  }

  if (!isCompleted) {
    // Default prompt buttons
    for (const key of defaultPromptKeys) {
      const name = promptMeta[key] || key;
      html += `<button class="swipe-prompt-btn${activePromptLabel === key ? ' active' : ''}" data-prompt="${_esc(key)}">${_esc(name)}</button>`;
    }

    // More button (show if built-in extras or custom prompts exist)
    if (morePromptKeys.length > 0 || customPrompts.length > 0) {
      html += `<button class="swipe-prompt-btn swipe-prompt-btn-more" data-prompt="__more__">${moreVisible ? 'less \u25B4' : 'more \u25BE'}</button>`;

      // More prompts (hidden row)
      html += `<div class="swipe-more-prompts${moreVisible ? ' visible' : ''}" style="display: ${moreVisible ? 'flex' : 'none'};">`;
      for (const key of morePromptKeys) {
        const name = promptMeta[key] || key;
        html += `<button class="swipe-prompt-btn${activePromptLabel === key ? ' active' : ''}" data-prompt="${_esc(key)}">${_esc(name)}</button>`;
      }
      // Custom prompts after built-in ones
      for (const cp of customPrompts) {
        const label = `custom:${cp.id}`;
        html += `<button class="swipe-prompt-btn custom-prompt-btn${activePromptLabel === label ? ' active' : ''}" data-prompt="${_esc(label)}">${_esc(cp.name)}</button>`;
      }
      html += '</div>';
    }
  }

  promptButtons.innerHTML = html;
}

async function handlePromptClick(e) {
  const btn = e.target.closest('.swipe-prompt-btn');
  if (!btn) return;

  const label = btn.dataset.prompt;
  if (!label) return;

  // Handle "more" toggle
  if (label === '__more__') {
    moreVisible = !moreVisible;
    renderPromptButtons();
    return;
  }

  const issue = filteredIssues[currentIndex];
  if (!issue) return;

  // Toggle off if same prompt
  if (activePromptLabel === label && !promptResult.classList.contains('hidden')) {
    promptResult.classList.add('hidden');
    activePromptLabel = null;
    renderPromptButtons();
    return;
  }

  // Check cache
  const cacheKey = `${issue.id}:${label}`;
  if (promptCache[cacheKey]) {
    const cached = promptCache[cacheKey];
    promptName.textContent = cached.name;
    promptText.innerHTML = cached.html;
    promptText.dataset.rawPrompt = cached.raw;
    promptResult.classList.remove('hidden');
    activePromptLabel = label;
    lastPromptLabel[issue.id] = label;
    setPromptActionsEnabled(true);
    showReasoningToggle(cached.reasoning || '');
    renderPromptButtons();
    return;
  }

  // Cancel in-flight
  if (activePromptFetch) activePromptFetch.abort();
  const abortController = new AbortController();
  activePromptFetch = abortController;

  // Show loading
  activePromptLabel = label;
  promptName.textContent = '';
  promptText.textContent = 'Loading...';
  promptText.dataset.rawPrompt = '';
  promptResult.classList.remove('hidden');
  setPromptActionsEnabled(false);
  btn.classList.add('loading');
  renderPromptButtons();

  const apiPrefix = urlKey ? `/workspace/${encodeURIComponent(urlKey)}` : '';

  try {
    let response;
    if (label === '__ai__') {
      // AI recommendation - use streaming endpoint
      response = await fetch(`${apiPrefix}/api/recommend/${issue.id}/stream`, { signal: abortController.signal });
    } else {
      response = await fetch(`${apiPrefix}/api/prompt/${issue.id}/${encodeURIComponent(label)}`, { signal: abortController.signal });
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to load prompt');
    }

    if (label === '__ai__') {
      // Handle streaming response for AI recommendations
      await handleStreamingResponse(response, issue.id, label, abortController);
    } else {
      const result = await response.json();

      if (activePromptFetch === abortController) {
        const html = renderMarkdown(result.prompt);
        promptName.textContent = result.promptName || '';
        promptText.innerHTML = html;
        promptText.dataset.rawPrompt = result.prompt;
        promptResult.classList.remove('hidden');
        setPromptActionsEnabled(true);

        // Cache and track last active label for this issue
        promptCache[`${issue.id}:${label}`] = {
          label, name: result.promptName || '', raw: result.prompt, html
        };
        lastPromptLabel[issue.id] = label;
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    promptText.textContent = `Error: ${err.message}`;
    setPromptActionsEnabled(false);
  } finally {
    btn.classList.remove('loading');
  }
}

/**
 * Handle streaming AI recommendation response
 */
async function handleStreamingResponse(response, issueId, label, abortController) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let promptRaw = '';
  let reasoningRaw = '';
  let currentField = null;
  let renderPending = false;
  let sseBuffer = ''; // Buffer for partial SSE lines across chunks
  let prevChildCount = 0; // Track rendered children for fade-in

  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      if (currentField === 'reasoning') {
        promptName.textContent = 'AI thinking...';
        promptText.innerHTML = renderMarkdown(reasoningRaw);
      } else {
        promptName.textContent = 'AI Recommendation';
        promptText.innerHTML = renderMarkdown(promptRaw || reasoningRaw);
      }

      // Apply fade-in to newly added child elements
      const children = promptText.children;
      for (let i = prevChildCount; i < children.length; i++) {
        children[i].classList.add('stream-in');
      }
      // Mark the last child as the active streaming target
      for (let i = 0; i < children.length; i++) {
        children[i].classList.toggle('stream-cursor', i === children.length - 1);
      }
      prevChildCount = children.length;

      // Auto-scroll only if user hasn't scrolled up to read
      const nearBottom = promptText.scrollHeight - promptText.scrollTop - promptText.clientHeight < 60;
      if (nearBottom) {
        promptText.scrollTop = promptText.scrollHeight;
      }
      renderPending = false;
    });
  }

  // Add streaming class for fade-in and gradient mask
  promptResult.classList.add('streaming');
  hideReasoningToggle();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (activePromptFetch !== abortController) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      // Keep the last (possibly incomplete) line in the buffer
      sseBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);

        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);

          if (parsed.phase) {
            // Transition from reasoning to prompt phase
            if (parsed.phase === 'prompt' && currentField === 'reasoning' && reasoningRaw) {
              showReasoningToggle(reasoningRaw);
              prevChildCount = 0;
            }
            currentField = parsed.phase;
            continue;
          }

          if (parsed.section === 'reasoning' && parsed.content) {
            reasoningRaw += parsed.content;
            currentField = 'reasoning';
            scheduleRender();
          } else if (parsed.section === 'prompt' && parsed.content) {
            promptRaw += parsed.content;
            currentField = 'prompt';
            scheduleRender();
          }

          if (parsed.error) {
            promptText.textContent = `Error: ${parsed.error}`;
            return;
          }
        } catch (parseErr) {
          // Skip unparseable lines
        }
      }
    }

    // Final render — remove streaming effects
    promptResult.classList.remove('streaming');
    if (activePromptFetch === abortController) {
      const displayText = stripCodeBlockWrapper(promptRaw || reasoningRaw);
      const html = renderMarkdown(displayText);
      promptName.textContent = 'AI Recommendation';
      promptText.innerHTML = html;
      promptText.dataset.rawPrompt = displayText;
      promptResult.classList.remove('hidden');
      setPromptActionsEnabled(true);

      promptCache[`${issueId}:${label}`] = {
        label, name: 'AI Recommendation', raw: displayText, html,
        reasoning: reasoningRaw
      };
      lastPromptLabel[issueId] = label;
      // Show reasoning toggle if not already shown during streaming
      if (reasoningRaw) showReasoningToggle(reasoningRaw);
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    promptResult.classList.remove('streaming');
    promptText.textContent = `Error: ${err.message}`;
  }
}

/**
 * Show/hide the reasoning toggle above the prompt text.
 */
function showReasoningToggle(reasoning) {
  const toggle = document.getElementById('swipe-reasoning-toggle');
  const content = document.getElementById('swipe-reasoning-content');
  if (!toggle || !content) return;

  if (!reasoning) {
    toggle.classList.add('hidden');
    content.classList.add('hidden');
    return;
  }

  toggle.textContent = '\u25b8 reasoning';
  toggle.classList.remove('hidden');
  content.classList.add('hidden');
  content.innerHTML = renderMarkdown(reasoning);

  // Replace handler each time to avoid stale closures
  const newToggle = toggle.cloneNode(true);
  toggle.parentNode.replaceChild(newToggle, toggle);
  newToggle.addEventListener('click', () => {
    const isHidden = content.classList.toggle('hidden');
    newToggle.textContent = isHidden ? '\u25b8 reasoning' : '\u25be reasoning';
  });
}

function hideReasoningToggle() {
  const toggle = document.getElementById('swipe-reasoning-toggle');
  const content = document.getElementById('swipe-reasoning-content');
  if (toggle) toggle.classList.add('hidden');
  if (content) content.classList.add('hidden');
}

// ==========================================================================
// Prompt Actions (Copy / Dispatch)
// ==========================================================================

function setPromptActionsEnabled(enabled) {
  const buttons = promptActions.querySelectorAll('button');
  buttons.forEach(btn => { btn.disabled = !enabled; });
}

function buildPromptActions() {
  let html = '<button class="swipe-prompt-copy">copy</button>';
  if (dispatchEnabled) {
    html += '<button class="swipe-prompt-dispatch" data-target="cli">cli</button>';
    html += '<button class="swipe-prompt-dispatch" data-target="web">web</button>';
    html += '<button class="swipe-prompt-dispatch" data-target="dash">dash</button>';
  }
  if (proxyEnabled) {
    const active = localStorage.getItem('proxy-toggle-active') === 'true' ? ' active' : '';
    html += `<button class="prompt-proxy-toggle${active}" title="Append proxy API instructions to prompt">+proxy</button>`;
  }
  promptActions.innerHTML = html;
}

// ==========================================================================
// Proxy Toggle Helpers
// ==========================================================================

const PROXY_TOGGLE_KEY = 'proxy-toggle-active';
let cachedProxyToken = null;

function isProxyActive() {
  return localStorage.getItem(PROXY_TOGGLE_KEY) === 'true';
}

async function getOrCreateProxyToken() {
  if (cachedProxyToken) return cachedProxyToken;
  if (!urlKey) return null;
  try {
    const resp = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/proxy/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'prompt-proxy', scope: 'readWrite', singleUse: false })
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    cachedProxyToken = data.token;
    return cachedProxyToken;
  } catch { return null; }
}

function buildProxyBlock(token) {
  const baseUrl = window.location.origin;
  return `\n\n## Linear API Proxy\n\nYou have access to a Linear API proxy. Use it to read and modify Linear issues, projects, and more.\n\nTo get started, fetch the full API documentation:\n\n  curl -H "Authorization: Bearer ${token}" ${baseUrl}/api/proxy/instructions\n\nThis will return all available endpoints with examples. Your token scope is: readWrite.`;
}

async function maybeAppendProxy(text) {
  if (!isProxyActive()) return text;
  const token = await getOrCreateProxyToken();
  if (!token) return text;
  return text + buildProxyBlock(token);
}

function handleProxyToggleClick(e) {
  const btn = e.target.closest('.prompt-proxy-toggle');
  if (!btn) return;
  const nowActive = !isProxyActive();
  localStorage.setItem(PROXY_TOGGLE_KEY, nowActive ? 'true' : 'false');
  document.querySelectorAll('.prompt-proxy-toggle').forEach(b => {
    b.classList.toggle('active', nowActive);
  });
}

async function handleCopyClick(e) {
  const btn = e.target.closest('.swipe-prompt-copy');
  if (!btn) return;

  const raw = promptText.dataset.rawPrompt;
  if (!raw) return;

  const text = await maybeAppendProxy(raw);
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'copy';
      btn.classList.remove('copied');
    }, 2000);
  }).catch(() => {
    btn.textContent = 'failed';
    setTimeout(() => { btn.textContent = 'copy'; }, 2000);
  });
}

async function handleDispatchClick(e) {
  const btn = e.target.closest('.swipe-prompt-dispatch');
  if (!btn || btn.disabled) return;

  const target = btn.dataset.target;
  const raw = promptText.dataset.rawPrompt;
  if (!raw) return;

  const prompt = await maybeAppendProxy(raw);
  const apiPrefix = urlKey ? `/workspace/${encodeURIComponent(urlKey)}` : '';

  btn.disabled = true;
  const originalText = btn.textContent;

  try {
    const response = await fetch(`${apiPrefix}/api/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, target })
    });

    if (!response.ok) throw new Error('Dispatch failed');

    btn.textContent = '\u2713';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
    }, 2000);
  } catch (err) {
    btn.textContent = 'err';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
    }, 2000);
  }
}

// ==========================================================================
// Keyboard Navigation
// ==========================================================================

function handleKeydown(e) {
  // Don't capture when focused on inputs
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    goPrev();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    goNext();
  }
}

// ==========================================================================
// Event Listeners
// ==========================================================================

// Filter
filterSelect.addEventListener('change', (e) => {
  moreVisible = false;
  applyFilter(e.target.value);
});

// Arrows
arrowLeft.addEventListener('click', goPrev);
arrowRight.addEventListener('click', goNext);

// Touch events on card container
const cardContainer = document.querySelector('.swipe-card-container');
cardContainer.addEventListener('touchstart', handleSwipeStart, { passive: true });
cardContainer.addEventListener('touchmove', handleSwipeMove, { passive: false });
cardContainer.addEventListener('touchend', handleSwipeEnd);

// Mouse events for desktop swipe support
cardContainer.addEventListener('mousedown', handleMouseDown);
document.addEventListener('mousemove', handleMouseMove);
document.addEventListener('mouseup', handleMouseUp);
// Safety net: reset mouse drag if cursor leaves the browser window
// (mouseup won't fire on document if button is released outside)
document.addEventListener('mouseleave', handleMouseUp);

// Accordion clicks and blocking issue link clicks (delegated)
card.addEventListener('click', (e) => {
  // Blocking/parent/subtask issue link navigation
  const link = e.target.closest('a.swipe-blocking-issue, a.swipe-relation-issue');
  if (link) {
    e.preventDefault();
    e.stopPropagation();
    const identifier = link.dataset.navigateIdentifier;
    if (identifier && !navigateToIdentifier(identifier)) {
      // Issue not in current filter — do a full navigation
      window.location.href = link.href;
    }
    return;
  }
  handleAccordionClick(e);
});

// Prompt button clicks (delegated)
promptButtons.addEventListener('click', handlePromptClick);

// Prompt action clicks (delegated)
promptActions.addEventListener('click', (e) => {
  handleCopyClick(e);
  handleDispatchClick(e);
  handleProxyToggleClick(e);
});

// Keyboard
document.addEventListener('keydown', handleKeydown);

// ==========================================================================
// Initialize
// ==========================================================================

buildPromptActions();
applyFilter(currentFilter);

// Navigate to initial identifier from URL (after filter is applied)
if (initialIdentifier) {
  navigateToIdentifier(initialIdentifier);
} else {
  updateUrl();
}

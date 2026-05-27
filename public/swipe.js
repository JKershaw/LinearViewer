/**
 * Swipe Page - Client-Side Logic
 *
 * Mobile-first task card swiping. Prompt generation is handled by
 * the shared PromptSection module (public/prompt-section.js),
 * embedded as the fourth card accordion.
 */

// Terminal states are non-actionable; mirrored from lib/tree.js (no shared import in public/).
const TERMINAL_STATES = ['completed', 'canceled', 'duplicate'];
function isTerminalState(stateType) {
  return TERMINAL_STATES.includes(stateType);
}

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
const hasForeman = data.hasForeman || false;
const hasMiniForeman = data.hasMiniForeman || false;
const dispatchEnabled = data.dispatchEnabled || false;
const proxyEnabled = data.proxyEnabled || false;
const isLocalhost = data.isLocalhost || false;
const initialIdentifier = data.initialIdentifier || null;

// Build reverse lookup: issueId → array of issues that block it (non-terminal only)
const blockedByMap = new Map();
for (const issue of allIssues) {
  if (isTerminalState(issue.stateType)) continue;
  for (const blockedId of issue.blocksIds || []) {
    if (!blockedByMap.has(blockedId)) blockedByMap.set(blockedId, []);
    blockedByMap.get(blockedId).push(issue);
  }
}
const issueById = new Map(allIssues.map(i => [i.id, i]));

let currentFilter = filters.length > 0 ? filters[0].key : '';
let filteredIssues = [];
let currentIndex = 0;
let activePromptHandle = null;

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
const filterSelect = document.querySelector('.swipe-filter-select');
const arrowLeft = document.querySelector('.swipe-arrow-left');
const arrowRight = document.querySelector('.swipe-arrow-right');

// ==========================================================================
// Markdown Rendering
// ==========================================================================

function stripCodeBlockWrapper(text) {
  if (!text) return text;
  const m = text.match(/^\s*```[a-z]*\s*\n([\s\S]*?)\n\s*```\s*$/);
  return m ? m[1] : text;
}

function renderMarkdown(text) {
  if (!text) return '';
  const cleaned = stripCodeBlockWrapper(text);
  const html = typeof marked !== 'undefined' ? marked.parse(cleaned) : window.escapeHtml(cleaned);
  return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(html) : html;
}

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

const swipeBase = urlKey ? `/workspace/${encodeURIComponent(urlKey)}/swipe` : '/swipe';

function updateUrl() {
  const issue = filteredIssues[currentIndex];
  const path = issue && issue.identifier ? `${swipeBase}/${encodeURIComponent(issue.identifier)}` : swipeBase;
  history.replaceState(null, '', path + window.location.search);
  document.title = issue && issue.identifier ? `Swipe - ${issue.identifier} ${issue.title}` : 'Swipe - Tasks';
}

function navigateToIdentifier(identifier) {
  const idx = filteredIssues.findIndex(i => i.identifier === identifier);
  if (idx === -1) return false;
  currentIndex = idx;
  updateArrows();
  updateCounter();
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
  } else if (filterKey.startsWith('label:')) {
    const labelName = filterKey.slice(6);
    filteredIssues = allIssues.filter(i => (i.labels || []).includes(labelName));
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
  renderCard();
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
    case 'duplicate':
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

function tearDownActivePrompt() {
  if (activePromptHandle) {
    activePromptHandle.destroy();
    activePromptHandle = null;
  }
}

function renderCard(direction) {
  tearDownActivePrompt();
  const issue = filteredIssues[currentIndex];

  if (!issue) {
    card.innerHTML = '<div class="swipe-card-empty">No tasks in this view</div>';
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
    .filter(i => i && !isTerminalState(i.stateType));
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

  // Accordion sections (Description, Comments, Recap, Prompts)
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

  // Recap accordion (lazy loaded) — only available when authenticated
  if (urlKey) {
    accordionHtml += `
  <div class="swipe-card-accordion">
    <div class="swipe-accordion-header" data-accordion="recap">
      <span class="swipe-accordion-toggle">\u25B6</span> Recap
    </div>
    <div class="swipe-accordion-body" data-accordion-body="recap">
      <div class="recap-section" data-recap-placeholder="1"></div>
    </div>
  </div>`;
  }

  // Prompts accordion (lazy loaded, fourth position) — only available when authenticated
  if (urlKey) {
    const cached = window.PromptSection && window.PromptSection.getCached
      ? window.PromptSection.getCached(issue.id)
      : null;
    const hint = cached ? ` <span class="swipe-prompts-cache-hint">· ${_esc(cached.name || cached.label)} cached</span>` : '';
    accordionHtml += `
  <div class="swipe-card-accordion">
    <div class="swipe-accordion-header" data-accordion="prompts">
      <span class="swipe-accordion-toggle">\u25B6</span> Prompts${hint}
    </div>
    <div class="swipe-accordion-body" data-accordion-body="prompts">
      <div class="swipe-prompt-placeholder" data-prompt-placeholder="1"></div>
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

  if (direction) {
    animateCardTransition(html, direction);
  } else {
    card.innerHTML = html;
  }
}

// ==========================================================================
// Card Animation
// ==========================================================================

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

  card.innerHTML = newHtml;
  card.classList.add('entering');
  card.style.transition = 'none';
  card.style.transform = `translate3d(${enterX}, 0, 0)`;
  card.style.opacity = '0';

  card.offsetHeight; // force reflow

  card.style.transition = '';
  card.classList.remove('entering');
  card.style.transform = 'translate3d(0, 0, 0)';
  card.style.opacity = '1';

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
    clearAnimations();
    card.style.transform = 'translate3d(-20px, 0, 0)';
    const id = setTimeout(() => { card.style.transform = ''; }, 150);
    animationTimers.push(id);
    return;
  }
  currentIndex++;
  updateArrows();
  updateCounter();
  renderCard('left');
  updateUrl();
}

function goPrev() {
  if (currentIndex <= 0) {
    clearAnimations();
    card.style.transform = 'translate3d(20px, 0, 0)';
    const id = setTimeout(() => { card.style.transform = ''; }, 150);
    animationTimers.push(id);
    return;
  }
  currentIndex--;
  updateArrows();
  updateCounter();
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

const SWIPE_THRESHOLD = 0.3;
const DIRECTION_LOCK_THRESHOLD = 10;

function getPointerCoords(e) {
  if (e.touches) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function handleSwipeStart(e) {
  if (filteredIssues.length <= 1) return;
  if (e.target.closest('.swipe-accordion-header, a, button, select, .swipe-accordion-body')) return;

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

  if (!swipeDirection) return;

  e.preventDefault();

  let translationX = deltaX;
  if ((currentIndex === 0 && deltaX > 0) || (currentIndex >= filteredIssues.length - 1 && deltaX < 0)) {
    translationX = deltaX * 0.3;
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
      goNext();
      return;
    } else if (deltaX > 0 && currentIndex > 0) {
      goPrev();
      return;
    }
  }

  card.style.transform = 'translate3d(0, 0, 0)';
  card.style.opacity = '1';
  const snapBack = setTimeout(() => {
    card.style.transform = '';
    card.style.opacity = '';
  }, 300);
  animationTimers.push(snapBack);
}

function handleMouseDown(e) {
  if (e.button !== 0) return;
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

  if (type === 'comments' && !isOpen && body.querySelector('.swipe-comments-loading')) {
    loadComments(body);
  }

  if (type === 'recap' && !isOpen) {
    const placeholder = body.querySelector('[data-recap-placeholder="1"]');
    if (placeholder && window.RecapSection) {
      placeholder.removeAttribute('data-recap-placeholder');
      const issue = filteredIssues[currentIndex];
      if (issue && urlKey) {
        window.RecapSection.init(placeholder, {
          urlKey,
          identifier: issue.identifier || issue.id
        });
      }
    }
  }

  if (type === 'prompts' && !isOpen) {
    const placeholder = body.querySelector('[data-prompt-placeholder="1"]');
    if (placeholder && window.PromptSection) {
      placeholder.removeAttribute('data-prompt-placeholder');
      const issue = filteredIssues[currentIndex];
      if (issue) {
        tearDownActivePrompt();
        activePromptHandle = window.PromptSection.init(placeholder, {
          urlKey,
          issue,
          hasAI,
          hasForeman,
          hasMiniForeman,
          dispatchEnabled,
          proxyEnabled,
          isLocalhost,
          customPrompts,
          defaultPromptKeys,
          morePromptKeys,
          promptMeta
        });
      }
    }
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
// Keyboard Navigation
// ==========================================================================

function handleKeydown(e) {
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

filterSelect.addEventListener('change', (e) => {
  applyFilter(e.target.value);
});

arrowLeft.addEventListener('click', goPrev);
arrowRight.addEventListener('click', goNext);

const cardContainer = document.querySelector('.swipe-card-container');
cardContainer.addEventListener('touchstart', handleSwipeStart, { passive: true });
cardContainer.addEventListener('touchmove', handleSwipeMove, { passive: false });
cardContainer.addEventListener('touchend', handleSwipeEnd);

cardContainer.addEventListener('mousedown', handleMouseDown);
document.addEventListener('mousemove', handleMouseMove);
document.addEventListener('mouseup', handleMouseUp);
document.addEventListener('mouseleave', handleMouseUp);

card.addEventListener('click', (e) => {
  const link = e.target.closest('a.swipe-blocking-issue, a.swipe-relation-issue');
  if (link) {
    e.preventDefault();
    e.stopPropagation();
    const identifier = link.dataset.navigateIdentifier;
    if (identifier && !navigateToIdentifier(identifier)) {
      window.location.href = link.href;
    }
    return;
  }
  handleAccordionClick(e);
});

document.addEventListener('keydown', handleKeydown);

// ==========================================================================
// Initialize
// ==========================================================================

applyFilter(currentFilter);

if (initialIdentifier) {
  navigateToIdentifier(initialIdentifier);
} else {
  updateUrl();
}

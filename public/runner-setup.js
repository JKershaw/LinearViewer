/**
 * Runner setup page client (LIN-3098 S4): two taps, phone-first.
 *
 *   Tap 1 (create runner prompt): mint the runner credential with LIN-3059's
 *     `ProxyToggle.getRunnerBootstrap` (public/common.js), unchanged, and put
 *     the served runner prompt plus a `## Your runner credential` block into
 *     a read-only, pre-selected textarea.
 *   Tap 2 (copy): copy it, synchronously inside the tap (iOS allows the
 *     clipboard only there). If that is refused, the text stays selected and
 *     a long-press fallback note appears (R6).
 *
 * After a successful mint it sets `localStorage['harbour-runner:<urlKey>'] = 1`,
 * which scopes N3's proxyForce to this browser (public/prompt-section.js).
 * The bootstrap is never logged, stored or sent anywhere else; it exists only
 * in the textarea. Errors render from RUNNER_BOOTSTRAP_ERROR_COPY.
 * The press itself is not recorded (that is LIN-2942's).
 */
(function () {
  'use strict';

  const main = document.querySelector('[data-testid="runner-setup-page"]');
  const mintBtn = main && main.querySelector('[data-testid="runner-setup-mint"]');
  if (!mintBtn) return; // not an owner state: nothing to press

  const copyBtn = main.querySelector('[data-testid="runner-setup-copy"]');
  const output = main.querySelector('[data-testid="runner-setup-output"]');
  const errorEl = main.querySelector('[data-testid="runner-setup-error"]');
  const fallback = main.querySelector('[data-testid="runner-setup-fallback"]');
  const feedback = main.querySelector('[data-testid="runner-setup-copy-feedback"]');
  const promptEl = main.querySelector('[data-testid="runner-setup-prompt"]');
  const { urlKey, accountId, baseUrl } = main.dataset;

  // The block runner.mjs login parses (parseCredentialBlock): `- key: value`.
  function credentialBlock({ token, expiresAt }) {
    return [
      '## Your runner credential',
      '',
      `- baseUrl: ${baseUrl}`,
      `- urlKey: ${urlKey}`,
      `- ownerAccountId: ${accountId}`,
      `- bootstrap: ${token}`,
      `- expiresAt: ${expiresAt || 'unknown'}`,
      '',
      'Pipe this block into `runner.mjs login` (see "Set up" above); never echo it. The bootstrap works once, and only until the time above.'
    ].join('\n');
  }

  function selectAll() {
    output.focus();
    output.setSelectionRange(0, output.value.length);
  }

  mintBtn.addEventListener('click', async () => {
    mintBtn.disabled = true;
    errorEl.hidden = true;
    fallback.hidden = true;
    feedback.textContent = '';
    const result = await window.ProxyToggle.getRunnerBootstrap(urlKey);
    mintBtn.disabled = false;
    if (result.error) {
      errorEl.textContent = result.error.message;
      errorEl.hidden = false;
      return;
    }
    output.value = `${promptEl.textContent.trimEnd()}\n\n---\n\n${credentialBlock(result)}\n`;
    // Copy is now the next step, so it takes the primary look.
    copyBtn.hidden = false;
    copyBtn.classList.add('save');
    mintBtn.classList.remove('save');
    mintBtn.textContent = 'create a new one';
    try {
      localStorage.setItem(`harbour-runner:${urlKey}`, '1');
    } catch {
      // Storage refused (private mode): the page still works; only N3's
      // run-step forcing won't know a runner was set up in this browser.
    }
    selectAll();
  });

  copyBtn.addEventListener('click', () => {
    // Called directly in the tap, never after an await: iOS allows the
    // clipboard only inside the user gesture.
    let pending;
    try {
      pending = navigator.clipboard && navigator.clipboard.writeText(output.value);
    } catch (err) {
      pending = Promise.reject(err);
    }
    Promise.resolve(pending || Promise.reject(new Error('no clipboard'))).then(
      () => {
        feedback.textContent = 'copied ✓';
        fallback.hidden = true;
      },
      () => {
        feedback.textContent = '';
        fallback.hidden = false;
        selectAll();
      }
    );
  });
})();

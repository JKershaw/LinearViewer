/**
 * Unit tests for lib/render-task-chat.js
 *
 * Run with: node --test tests/unit/render-task-chat.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderTaskChatPage } from '../../lib/render-task-chat.js';

function render(data = {}, options = {}) {
  return renderTaskChatPage(
    { defaultTask: '', aiConfigured: true, savedChatsAvailable: false, ...data },
    { urlKey: 'ws-a', workspaces: [], featureFlags: {}, ...options }
  );
}

describe('renderTaskChatPage', () => {
  test('renders a complete HTML document', () => {
    const html = render();
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
  });

  test('includes the task-chat stylesheet and script', () => {
    const html = render();
    assert.ok(html.includes('/task-chat.css'));
    assert.ok(html.includes('/task-chat.js'));
  });

  // LIN-1298 v2: Task Chat is the source of the conversational idiom, but was
  // the one surface still on its own private `.chat-*` rules. It now migrates
  // onto the shared chat interface (chat.css primitives + the chat.js ChatUI
  // render helper) — a shared thread + an inline composer variant for the ask bar.
  test('the transcript and ask bar adopt the shared chat UI (LIN-1298 v2)', () => {
    const html = render();
    assert.ok(html.includes('/chat.css'), 'the shared chat stylesheet is linked');
    assert.ok(html.includes('/chat.js'), 'the shared chat render helper is loaded');
    assert.match(html, /class="task-chat-transcript chat-thread"/, 'the transcript is a shared chat thread');
    assert.match(html, /class="task-chat-ask chat-composer chat-composer--inline"/, 'the ask bar is an inline shared composer');
  });

  test('prefills the task input from defaultTask', () => {
    const html = render({ defaultTask: 'LIN-123' });
    assert.match(html, /id="task-chat-id"[^>]*value="LIN-123"/);
  });

  test('shows an AI-unconfigured warning when aiConfigured is false', () => {
    const html = render({ aiConfigured: false });
    assert.match(html, /data-ai-unconfigured/);
  });

  test('no AI-unconfigured warning when aiConfigured is true', () => {
    const html = render({ aiConfigured: true });
    assert.ok(!html.includes('data-ai-unconfigured'));
  });

  test('offers a save affordance + saved-chats list only when savedChatsAvailable', () => {
    const html = render({ savedChatsAvailable: true });
    assert.match(html, /data-testid="task-chat-save"/);
    assert.match(html, /id="task-chat-saved-list"/);
  });

  test('renders an explicit unavailable notice when savedChatsAvailable is false', () => {
    const html = render({ savedChatsAvailable: false });
    assert.ok(!html.includes('data-testid="task-chat-save"'));
    assert.match(html, /data-testid="task-chat-saved-unavailable"/);
  });
});

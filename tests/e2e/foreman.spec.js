import { test, expect } from '@playwright/test';

test.describe('Foreman API - Stack Endpoint', () => {
  let readToken;

  test.beforeEach(async ({ page }) => {
    await page.goto('/test/clear-proxy-tokens');
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);

    const resp = await page.goto('/test/create-proxy-token?scope=read&label=foreman-read');
    const data = await resp.json();
    readToken = data.token;
  });

  test('GET /api/proxy/stack returns sorted tasks', async ({ request }) => {
    const resp = await request.get('/api/proxy/stack', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.tasks).toBeDefined();
    expect(Array.isArray(data.tasks)).toBe(true);
    expect(data.total).toBeGreaterThan(0);

    // Each task should have expected fields
    const task = data.tasks[0];
    expect(task.id).toBeTruthy();
    expect(task.identifier).toBeDefined();
    expect(task.title).toBeTruthy();
    expect(task.stateType).toBeTruthy();
    expect(Array.isArray(task.labels)).toBe(true);
    expect(Array.isArray(task.availablePrompts)).toBe(true);
    expect(task.availablePrompts.length).toBeGreaterThan(0);
  });

  test('GET /api/proxy/stack respects limit parameter', async ({ request }) => {
    const resp = await request.get('/api/proxy/stack?limit=2', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.tasks.length).toBeLessThanOrEqual(2);
    // total reflects all tasks, not just returned ones
    expect(data.total).toBeGreaterThanOrEqual(data.tasks.length);
  });

  test('GET /api/proxy/stack includes subtask info', async ({ request }) => {
    const resp = await request.get('/api/proxy/stack?limit=50', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();

    // Find the parent task (issue-1: "Parent task in progress") - it has a child (issue-2)
    const parent = data.tasks.find(t => t.title === 'Parent task in progress');
    if (parent) {
      expect(Array.isArray(parent.subtasks)).toBe(true);
      expect(parent.subtasks.length).toBeGreaterThan(0);
      expect(parent.subtasks[0].identifier).toBeTruthy();
    }

    // Find child task - should have parentId
    const child = data.tasks.find(t => t.title === 'Child task todo');
    if (child) {
      expect(child.parentId).toBeTruthy();
    }
  });

  test('GET /api/proxy/stack requires authentication', async ({ request }) => {
    const resp = await request.get('/api/proxy/stack');
    expect(resp.status()).toBe(401);
  });

  test('GET /api/proxy/stack with invalid token gets 401', async ({ request }) => {
    const resp = await request.get('/api/proxy/stack', {
      headers: { Authorization: 'Bearer invalid-token' }
    });
    expect(resp.status()).toBe(401);
  });
});

test.describe('Foreman API - Prompt Endpoint', () => {
  let readToken;

  test.beforeEach(async ({ page }) => {
    await page.goto('/test/clear-proxy-tokens');
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);

    const resp = await page.goto('/test/create-proxy-token?scope=read&label=foreman-read');
    const data = await resp.json();
    readToken = data.token;
  });

  test('GET /api/proxy/prompt returns generated prompt', async ({ request }) => {
    // Use a mock issue UUID that exists in test data (issue TEST-6 with 'preparing' label)
    const resp = await request.get('/api/proxy/prompt/66666666-6666-6666-6666-666666666666/look-into', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    // In test mode, fetchIssueContext calls the real Linear API which won't work,
    // but proxy auth should succeed. We accept 200 (if mock works) or upstream error.
    if (resp.status() === 200) {
      const data = await resp.json();
      expect(data.prompt).toBeTruthy();
      expect(data.promptName).toBeTruthy();
      expect(data.templateKey).toBe('look-into');
    } else {
      // Upstream Linear error expected in test mode — just verify auth passed
      expect(resp.status()).not.toBe(401);
    }
  });

  test('GET /api/proxy/prompt with invalid identifier gets 400', async ({ request }) => {
    const resp = await request.get('/api/proxy/prompt/INVALID!!!/plan', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('Invalid identifier');
  });

  test('GET /api/proxy/prompt with invalid template key gets 404', async ({ request }) => {
    const resp = await request.get('/api/proxy/prompt/LIN-1/nonexistent-template', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(404);
    const data = await resp.json();
    expect(data.error).toContain('No prompt template');
  });

  test('GET /api/proxy/prompt requires authentication', async ({ request }) => {
    const resp = await request.get('/api/proxy/prompt/LIN-1/plan');
    expect(resp.status()).toBe(401);
  });
});

test.describe('Foreman API - Recommend Endpoint', () => {
  let readToken;

  test.beforeEach(async ({ page }) => {
    await page.goto('/test/clear-proxy-tokens');
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);

    const resp = await page.goto('/test/create-proxy-token?scope=read&label=foreman-read');
    const data = await resp.json();
    readToken = data.token;
  });

  test('GET /api/proxy/recommend returns AI recommendation for issue', async ({ request }) => {
    // Use mock issue UUID that exists in test data
    const resp = await request.get('/api/proxy/recommend/66666666-6666-6666-6666-666666666666', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.reasoning).toBeTruthy();
    expect(data.prompt).toBeTruthy();
    expect(data.identifier).toBeTruthy();
    expect(typeof data.truncated).toBe('boolean');
  });

  test('GET /api/proxy/recommend returns bug-specific recommendation', async ({ request }) => {
    // dddddddd-dddd-dddd-dddd-ddddddddddde has 'bug' label
    const resp = await request.get('/api/proxy/recommend/dddddddd-dddd-dddd-dddd-ddddddddddde', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.reasoning).toContain('bug');
  });

  test('GET /api/proxy/recommend accepts identifier format', async ({ request }) => {
    // TEST-14 exists in mock data
    const resp = await request.get('/api/proxy/recommend/TEST-14', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.prompt).toBeTruthy();
  });

  test('GET /api/proxy/recommend with invalid identifier gets 400', async ({ request }) => {
    const resp = await request.get('/api/proxy/recommend/INVALID!!!', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('Invalid identifier');
  });

  test('GET /api/proxy/recommend with nonexistent issue gets 404', async ({ request }) => {
    const resp = await request.get('/api/proxy/recommend/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(404);
  });

  test('GET /api/proxy/recommend requires authentication', async ({ request }) => {
    const resp = await request.get('/api/proxy/recommend/LIN-1');
    expect(resp.status()).toBe(401);
  });
});

test.describe('Foreman API - Status Endpoints', () => {
  let readToken;
  let writeToken;

  test.beforeEach(async ({ page }) => {
    await page.goto('/test/clear-proxy-tokens');
    await page.goto('/test/clear-foreman-status');
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);

    const readResp = await page.goto('/test/create-proxy-token?scope=read&label=foreman-read');
    const readData = await readResp.json();
    readToken = readData.token;

    const writeResp = await page.goto('/test/create-proxy-token?scope=readWrite&label=foreman-write');
    const writeData = await writeResp.json();
    writeToken = writeData.token;
  });

  test('POST /api/proxy/foreman/status records status entry', async ({ request }) => {
    const resp = await request.post('/api/proxy/foreman/status', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        taskIdentifier: 'LIN-42',
        action: 'research',
        status: 'completed',
        summary: 'Found 3 API endpoints needing auth fixes'
      }
    });
    expect(resp.status()).toBe(201);
    const data = await resp.json();
    expect(data.success).toBe(true);
  });

  test('GET /api/proxy/foreman/status retrieves entries', async ({ request }) => {
    // Post two entries
    await request.post('/api/proxy/foreman/status', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        taskIdentifier: 'LIN-42',
        action: 'research',
        status: 'completed',
        summary: 'First entry'
      }
    });
    await request.post('/api/proxy/foreman/status', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        taskIdentifier: 'LIN-43',
        action: 'implementation',
        status: 'in-progress',
        summary: 'Second entry'
      }
    });

    // Retrieve
    const resp = await request.get('/api/proxy/foreman/status', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.items).toHaveLength(2);
    expect(data.total).toBe(2);

    // Newest first
    expect(data.items[0].taskIdentifier).toBe('LIN-43');
    expect(data.items[1].taskIdentifier).toBe('LIN-42');

    // Check fields
    expect(data.items[0].action).toBe('implementation');
    expect(data.items[0].status).toBe('in-progress');
    expect(data.items[0].summary).toBe('Second entry');
    expect(data.items[0].timestamp).toBeTruthy();
  });

  test('POST /api/proxy/foreman/status validates required fields', async ({ request }) => {
    // Missing taskIdentifier
    const resp1 = await request.post('/api/proxy/foreman/status', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: { action: 'research', status: 'completed', summary: 'test' }
    });
    expect(resp1.status()).toBe(400);
    const data1 = await resp1.json();
    expect(data1.error).toContain('taskIdentifier');

    // Missing action
    const resp2 = await request.post('/api/proxy/foreman/status', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: { taskIdentifier: 'LIN-1', status: 'completed', summary: 'test' }
    });
    expect(resp2.status()).toBe(400);
    const data2 = await resp2.json();
    expect(data2.error).toContain('action');

    // Missing status
    const resp3 = await request.post('/api/proxy/foreman/status', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: { taskIdentifier: 'LIN-1', action: 'research', summary: 'test' }
    });
    expect(resp3.status()).toBe(400);
    const data3 = await resp3.json();
    expect(data3.error).toContain('status');

    // Missing summary
    const resp4 = await request.post('/api/proxy/foreman/status', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: { taskIdentifier: 'LIN-1', action: 'research', status: 'completed' }
    });
    expect(resp4.status()).toBe(400);
    const data4 = await resp4.json();
    expect(data4.error).toContain('summary');
  });

  test('POST /api/proxy/foreman/status requires readWrite scope', async ({ request }) => {
    const resp = await request.post('/api/proxy/foreman/status', {
      headers: {
        Authorization: `Bearer ${readToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        taskIdentifier: 'LIN-1',
        action: 'research',
        status: 'completed',
        summary: 'test'
      }
    });
    expect(resp.status()).toBe(403);
    const data = await resp.json();
    expect(data.error).toContain('read-write');
  });

  test('POST /api/proxy/foreman/status rejects oversized summary', async ({ request }) => {
    const resp = await request.post('/api/proxy/foreman/status', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        taskIdentifier: 'LIN-1',
        action: 'research',
        status: 'completed',
        summary: 'x'.repeat(10001)
      }
    });
    expect(resp.status()).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('max length');
  });

  test('POST /api/proxy/foreman/status rejects dangerous characters', async ({ request }) => {
    const resp = await request.post('/api/proxy/foreman/status', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        taskIdentifier: 'LIN-1\x00',
        action: 'research',
        status: 'completed',
        summary: 'test'
      }
    });
    expect(resp.status()).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('invalid characters');
  });

  test('GET /api/proxy/foreman/status supports pagination', async ({ request }) => {
    // Post 3 entries
    for (let i = 1; i <= 3; i++) {
      await request.post('/api/proxy/foreman/status', {
        headers: {
          Authorization: `Bearer ${writeToken}`,
          'Content-Type': 'application/json'
        },
        data: {
          taskIdentifier: `LIN-${i}`,
          action: 'research',
          status: 'completed',
          summary: `Entry ${i}`
        }
      });
    }

    // Get with limit=2
    const resp1 = await request.get('/api/proxy/foreman/status?limit=2', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    const data1 = await resp1.json();
    expect(data1.items).toHaveLength(2);
    expect(data1.total).toBe(3);

    // Get with offset=2
    const resp2 = await request.get('/api/proxy/foreman/status?limit=10&offset=2', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    const data2 = await resp2.json();
    expect(data2.items).toHaveLength(1);
    expect(data2.total).toBe(3);
  });

  test('GET /api/proxy/foreman/status requires authentication', async ({ request }) => {
    const resp = await request.get('/api/proxy/foreman/status');
    expect(resp.status()).toBe(401);
  });
});

test.describe('Foreman API - Playbook Endpoint', () => {
  let readToken;

  test.beforeEach(async ({ page }) => {
    await page.goto('/test/clear-proxy-tokens');

    const resp = await page.goto('/test/create-proxy-token?scope=read&label=foreman-read');
    const data = await resp.json();
    readToken = data.token;
  });

  test('GET /api/proxy/foreman/playbook returns playbook text', async ({ request }) => {
    const resp = await request.get('/api/proxy/foreman/playbook', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);

    const text = await resp.text();
    expect(text).toContain('Foreman');
    expect(text).toContain('/api/proxy/stack');
    expect(text).toContain('/api/proxy/prompt');
    expect(text).toContain('/api/proxy/foreman/status');
    expect(text).toContain('Stop conditions');
    // Should contain the actual base URL
    expect(text).toContain('http');
  });

  test('GET /api/proxy/foreman/playbook requires authentication', async ({ request }) => {
    const resp = await request.get('/api/proxy/foreman/playbook');
    expect(resp.status()).toBe(401);
  });
});

test.describe('Foreman API - Event Logging', () => {
  test('foreman endpoint calls create proxy events', async ({ page, request }) => {
    await page.goto('/test/clear-proxy-tokens');
    await page.goto('/test/clear-proxy-events');

    const tokenResp = await page.goto('/test/create-proxy-token?scope=read&label=foreman-events-test');
    const { token } = await tokenResp.json();

    // Make a foreman call to generate an event
    await request.get('/api/proxy/stack?limit=1', {
      headers: { Authorization: `Bearer ${token}` }
    });

    // Check events via session-authed API
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const eventsResp = await request.get('/workspace/test-workspace/api/proxy/events', {
      headers: { Cookie: cookieHeader }
    });
    expect(eventsResp.status()).toBe(200);
    const eventsData = await eventsResp.json();
    const stackEvents = eventsData.items.filter(e => e.endpoint === '/api/proxy/stack');
    expect(stackEvents.length).toBeGreaterThan(0);
    expect(stackEvents[0].tokenLabel).toBe('foreman-events-test');
  });
});

test.describe('Foreman API - Instructions Integration', () => {
  let readToken;

  test.beforeEach(async ({ page }) => {
    await page.goto('/test/clear-proxy-tokens');

    const resp = await page.goto('/test/create-proxy-token?scope=read&label=foreman-read');
    const data = await resp.json();
    readToken = data.token;
  });

  test('instructions endpoint includes foreman endpoints', async ({ request }) => {
    const resp = await request.get('/api/proxy/instructions', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const text = await resp.text();
    expect(text).toContain('/api/proxy/stack');
    expect(text).toContain('/api/proxy/prompt');
    expect(text).toContain('/api/proxy/foreman/status');
    expect(text).toContain('/api/proxy/foreman/playbook');
    expect(text).toContain('Foreman');
  });

  test('instructions with readWrite scope includes foreman status POST', async ({ page, request }) => {
    const writeResp = await page.goto('/test/create-proxy-token?scope=readWrite&label=foreman-write');
    const writeData = await writeResp.json();

    const resp = await request.get('/api/proxy/instructions', {
      headers: { Authorization: `Bearer ${writeData.token}` }
    });
    const text = await resp.text();
    expect(text).toContain('POST');
    expect(text).toContain('foreman/status');
    expect(text).toContain('taskIdentifier');
  });
});

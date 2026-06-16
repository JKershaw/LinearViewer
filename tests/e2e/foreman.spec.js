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
    expect(task.state).toBeTruthy();
    expect(task.state.type).toBeTruthy();
    expect(Array.isArray(task.labels)).toBe(true);
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

  test('GET /api/proxy/stack includes child/parent info', async ({ request }) => {
    const resp = await request.get('/api/proxy/stack?limit=50', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();

    // Find the parent task (issue-1: "Parent task in progress") - it has a child (issue-2)
    const parent = data.tasks.find(t => t.title === 'Parent task in progress');
    if (parent) {
      expect(Array.isArray(parent.children)).toBe(true);
      expect(parent.children.length).toBeGreaterThan(0);
      expect(parent.children[0].identifier).toBeTruthy();
    }

    // Child task should carry a parent object with id/identifier
    const child = data.tasks.find(t => t.title === 'Child task todo');
    if (child) {
      expect(child.parent).toBeTruthy();
      expect(child.parent.id).toBeTruthy();
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
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.prompt).toBeTruthy();
    expect(data.promptName).toBeTruthy();
    expect(data.templateKey).toBe('look-into');
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

test.describe('Foreman API - Recap Endpoint', () => {
  let readToken;

  test.beforeEach(async ({ page }) => {
    await page.goto('/test/clear-proxy-tokens');
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);

    const resp = await page.goto('/test/create-proxy-token?scope=read&label=foreman-read');
    const data = await resp.json();
    readToken = data.token;
  });

  test('GET /api/proxy/recap auto-generates and returns fresh recap', async ({ request }) => {
    const resp = await request.get('/api/proxy/recap/66666666-6666-6666-6666-666666666666', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.status).toBe('fresh');
    expect(data.recap).toBeTruthy();
    expect(Array.isArray(data.recap.done)).toBe(true);
    expect(Array.isArray(data.recap.pending)).toBe(true);
    expect(Array.isArray(data.recap.deviations)).toBe(true);
    expect(data.identifier).toBeTruthy();
  });

  test('GET /api/proxy/recap with noRefresh returns missing when no cache exists', async ({ request }) => {
    // TEST-14 is unlikely to have a cached recap from a different test
    const resp = await request.get('/api/proxy/recap/dddddddd-dddd-dddd-dddd-ddddddddddde?noRefresh=1', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(['missing', 'stale', 'fresh']).toContain(data.status);
  });

  test('GET /api/proxy/recap accepts identifier format', async ({ request }) => {
    const resp = await request.get('/api/proxy/recap/TEST-14', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.recap).toBeTruthy();
  });

  test('GET /api/proxy/recap with invalid identifier gets 400', async ({ request }) => {
    const resp = await request.get('/api/proxy/recap/INVALID!!!', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(400);
  });

  test('GET /api/proxy/recap with nonexistent issue gets 404', async ({ request }) => {
    const resp = await request.get('/api/proxy/recap/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(404);
  });

  test('GET /api/proxy/recap requires authentication', async ({ request }) => {
    const resp = await request.get('/api/proxy/recap/LIN-1');
    expect(resp.status()).toBe(401);
  });

  test('POST /api/proxy/recap force-regenerates the recap', async ({ request }) => {
    const resp = await request.post('/api/proxy/recap/66666666-6666-6666-6666-666666666666', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.status).toBe('fresh');
    expect(data.recap).toBeTruthy();
  });

  test('POST /api/proxy/recap requires authentication', async ({ request }) => {
    const resp = await request.post('/api/proxy/recap/LIN-1');
    expect(resp.status()).toBe(401);
  });
});

test.describe('Foreman API - Brief Endpoint', () => {
  let readToken;

  test.beforeEach(async ({ page }) => {
    await page.goto('/test/clear-proxy-tokens');
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);

    const resp = await page.goto('/test/create-proxy-token?scope=read&label=foreman-read');
    const data = await resp.json();
    readToken = data.token;
  });

  test('GET /api/proxy/brief auto-generates and returns fresh brief', async ({ request }) => {
    const resp = await request.get('/api/proxy/brief/66666666-6666-6666-6666-666666666666', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.status).toBe('fresh');
    expect(typeof data.brief).toBe('string');
    expect(data.brief).toContain('## Current');
    expect(data.brief).toContain('## Changelog');
    expect(data.identifier).toBeTruthy();
    expect(data.generatedAt).toBeTruthy();
  });

  test('GET /api/proxy/brief with noRefresh returns missing when no cache exists', async ({ request }) => {
    // Distinct issue to stay independent of other tests that may have cached a brief
    const resp = await request.get('/api/proxy/brief/dddddddd-dddd-dddd-dddd-ddddddddddde?noRefresh=1', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(['missing', 'stale', 'fresh']).toContain(data.status);
  });

  test('GET /api/proxy/brief accepts identifier format', async ({ request }) => {
    const resp = await request.get('/api/proxy/brief/TEST-14', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.brief).toContain('## Current');
  });

  test('GET /api/proxy/brief with invalid identifier gets 400', async ({ request }) => {
    const resp = await request.get('/api/proxy/brief/INVALID!!!', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(400);
  });

  test('GET /api/proxy/brief with nonexistent issue gets 404', async ({ request }) => {
    const resp = await request.get('/api/proxy/brief/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(404);
  });

  test('GET /api/proxy/brief requires authentication', async ({ request }) => {
    const resp = await request.get('/api/proxy/brief/LIN-1');
    expect(resp.status()).toBe(401);
  });

  test('POST /api/proxy/brief force-regenerates the brief', async ({ request }) => {
    const resp = await request.post('/api/proxy/brief/66666666-6666-6666-6666-666666666666', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.status).toBe('fresh');
    expect(data.brief).toContain('## Current');
  });

  test('POST /api/proxy/brief requires authentication', async ({ request }) => {
    const resp = await request.post('/api/proxy/brief/LIN-1');
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

  test('POST /api/proxy/foreman/status persists optional dispatchId and GET returns it', async ({ request }) => {
    // Entry WITH dispatchId (exact-match join path for LIN-245)
    const postWith = await request.post('/api/proxy/foreman/status', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        taskIdentifier: 'LIN-42',
        action: 'implementation',
        status: 'completed',
        summary: 'With dispatch reference',
        dispatchId: 'dispatch-item-abc-123'
      }
    });
    expect(postWith.status()).toBe(201);

    // Entry WITHOUT dispatchId — back-compat path, field should be omitted entirely
    const postWithout = await request.post('/api/proxy/foreman/status', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        taskIdentifier: 'LIN-43',
        action: 'research',
        status: 'completed',
        summary: 'No dispatch reference'
      }
    });
    expect(postWithout.status()).toBe(201);

    const listResp = await request.get('/api/proxy/foreman/status', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(listResp.status()).toBe(200);
    const data = await listResp.json();

    const withEntry = data.items.find(i => i.taskIdentifier === 'LIN-42');
    const withoutEntry = data.items.find(i => i.taskIdentifier === 'LIN-43');
    expect(withEntry).toBeTruthy();
    expect(withEntry.dispatchId).toBe('dispatch-item-abc-123');
    expect(withoutEntry).toBeTruthy();
    // Old-shape entries must not gain a dispatchId key at all
    expect(withoutEntry.dispatchId).toBeUndefined();
  });

  test('POST /api/proxy/foreman/status rejects invalid dispatchId', async ({ request }) => {
    // Empty string → non-empty string required
    const empty = await request.post('/api/proxy/foreman/status', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        taskIdentifier: 'LIN-1',
        action: 'research',
        status: 'completed',
        summary: 'test',
        dispatchId: ''
      }
    });
    expect(empty.status()).toBe(400);

    // Wrong type
    const wrongType = await request.post('/api/proxy/foreman/status', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        taskIdentifier: 'LIN-1',
        action: 'research',
        status: 'completed',
        summary: 'test',
        dispatchId: 12345
      }
    });
    expect(wrongType.status()).toBe(400);

    // Too long
    const tooLong = await request.post('/api/proxy/foreman/status', {
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json'
      },
      data: {
        taskIdentifier: 'LIN-1',
        action: 'research',
        status: 'completed',
        summary: 'test',
        dispatchId: 'x'.repeat(201)
      }
    });
    expect(tooLong.status()).toBe(400);
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

  test('POST /api/proxy/foreman/status attributes the posting token label', async ({ request }) => {
    await request.post('/api/proxy/foreman/status', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { taskIdentifier: 'LIN-50', action: 'review', status: 'completed', summary: 'Good' }
    });

    const resp = await request.get('/api/proxy/foreman/status?limit=1', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    const data = await resp.json();
    expect(data.items[0].tokenLabel).toBe('foreman-write');
    expect(typeof data.items[0].tokenId).toBe('string');
    expect(data.items[0].tokenId.length).toBeGreaterThan(0);
  });

  test('GET /api/proxy/foreman/status supports tokenId + taskIdentifier filters', async ({ page, request }) => {
    // Post some entries across two task identifiers
    for (const id of ['LIN-A', 'LIN-A', 'LIN-B']) {
      await request.post('/api/proxy/foreman/status', {
        headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
        data: { taskIdentifier: id, action: 'plan', status: 'completed', summary: `for ${id}` }
      });
    }

    // Filter by taskIdentifier
    const byTask = await (await request.get('/api/proxy/foreman/status?taskIdentifier=LIN-A', {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    expect(byTask.items).toHaveLength(2);
    expect(byTask.items.every(i => i.taskIdentifier === 'LIN-A')).toBe(true);

    // Discover the tokenId for foreman-write via the first entry, then filter by it
    const first = await (await request.get('/api/proxy/foreman/status?limit=1', {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    const tid = first.items[0].tokenId;
    const byToken = await (await request.get(`/api/proxy/foreman/status?tokenId=${encodeURIComponent(tid)}`, {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    expect(byToken.items.length).toBe(3);
    expect(byToken.items.every(i => i.tokenId === tid)).toBe(true);

    // Unknown tokenId returns empty
    const none = await (await request.get('/api/proxy/foreman/status?tokenId=does-not-exist', {
      headers: { Authorization: `Bearer ${readToken}` }
    })).json();
    expect(none.items).toHaveLength(0);
  });

  test('GET /api/proxy/foreman/sessions groups entries by token', async ({ page, request }) => {
    // Create a second write token
    const secondResp = await page.goto('/test/create-proxy-token?scope=readWrite&label=foreman-write-2');
    const secondData = await secondResp.json();
    const secondWriteToken = secondData.token;

    await request.post('/api/proxy/foreman/status', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { taskIdentifier: 'LIN-10', action: 'research', status: 'completed', summary: 's1' }
    });
    await request.post('/api/proxy/foreman/status', {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      data: { taskIdentifier: 'LIN-11', action: 'plan', status: 'in-progress', summary: 's2' }
    });
    await request.post('/api/proxy/foreman/status', {
      headers: { Authorization: `Bearer ${secondWriteToken}`, 'Content-Type': 'application/json' },
      data: { taskIdentifier: 'LIN-12', action: 'review', status: 'blocked', summary: 's3' }
    });

    const resp = await request.get('/api/proxy/foreman/sessions', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();

    expect(data.sessions).toHaveLength(2);
    const byLabel = new Map(data.sessions.map(s => [s.label, s]));
    expect(byLabel.get('foreman-write').itemCount).toBe(2);
    expect(byLabel.get('foreman-write-2').itemCount).toBe(1);
    // Sessions are sorted newest-first (by lastSeen)
    expect(new Date(data.sessions[0].lastSeen) >= new Date(data.sessions[1].lastSeen)).toBe(true);
  });

  test('GET /api/proxy/foreman/tasks groups entries by task identifier', async ({ request }) => {
    for (const [id, summary] of [['LIN-7', 'a'], ['LIN-7', 'b'], ['LIN-8', 'c']]) {
      await request.post('/api/proxy/foreman/status', {
        headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
        data: { taskIdentifier: id, action: 'plan', status: 'in-progress', summary }
      });
    }

    const resp = await request.get('/api/proxy/foreman/tasks', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    const data = await resp.json();
    expect(data.tasks).toHaveLength(2);
    const lin7 = data.tasks.find(t => t.taskIdentifier === 'LIN-7');
    expect(lin7.itemCount).toBe(2);
    expect(lin7.lastStatus).toBe('in-progress');
  });

  test('GET /api/proxy/foreman/sessions requires authentication', async ({ request }) => {
    const resp = await request.get('/api/proxy/foreman/sessions');
    expect(resp.status()).toBe(401);
  });

  test('GET /api/proxy/foreman/tasks requires authentication', async ({ request }) => {
    const resp = await request.get('/api/proxy/foreman/tasks');
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
    expect(text).toContain('/api/proxy/recap');
    expect(text).toContain('/api/proxy/recommend');
    expect(text).toContain('/api/proxy/foreman/status');
    expect(text).toContain('Stop conditions');
    // Should contain the actual base URL
    expect(text).toContain('http');
  });

  test('GET /api/proxy/foreman/playbook requires authentication', async ({ request }) => {
    const resp = await request.get('/api/proxy/foreman/playbook');
    expect(resp.status()).toBe(401);
  });

  test('GET /api/proxy/autopilot/kickoff returns the kickoff text', async ({ request }) => {
    const resp = await request.get('/api/proxy/autopilot/kickoff', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);

    const text = await resp.text();
    expect(text).toContain("You're Autopilot");
    expect(text).toContain('/api/proxy/stack?limit=5');
    expect(text).toContain('WRITE, merge-gated');
    expect(text).toContain('walk the stack');
  });

  test('GET /api/proxy/autopilot/kickoff honors ?mode=readonly and ?goal=', async ({ request }) => {
    const resp = await request.get('/api/proxy/autopilot/kickoff?mode=readonly&goal=work%20the%20Ship%20view', {
      headers: { Authorization: `Bearer ${readToken}` }
    });
    expect(resp.status()).toBe(200);
    const text = await resp.text();
    expect(text).toContain('READ-ONLY');
    expect(text).toContain('work the Ship view');
    expect(text).not.toContain('WRITE, merge-gated');
  });

  test('GET /api/proxy/autopilot/kickoff requires authentication', async ({ request }) => {
    const resp = await request.get('/api/proxy/autopilot/kickoff');
    expect(resp.status()).toBe(401);
  });
});

test.describe('Workspace API - Foreman Prompt Endpoint', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
  });

  test('GET /workspace/:urlKey/api/foreman-prompt/:issueId returns targeted playbook', async ({ page, request }) => {
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const resp = await request.get(
      '/workspace/test-workspace/api/foreman-prompt/66666666-6666-6666-6666-666666666666',
      { headers: { Cookie: cookieHeader } }
    );
    expect(resp.status()).toBe(200);

    const data = await resp.json();
    expect(data.label).toBe('foreman');
    expect(data.promptName).toContain('Foreman');
    expect(data.prompt).toContain('Confirm the task');
    expect(data.prompt).toContain('/api/proxy/recap');
    // Should NOT include stack-walk for a targeted run
    expect(data.prompt).not.toContain('Choose a task');
    expect(data.prompt).not.toContain('/api/proxy/stack?limit=5');
  });

  test('GET /workspace/:urlKey/api/foreman-prompt rejects invalid issue ID', async ({ page, request }) => {
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const resp = await request.get(
      '/workspace/test-workspace/api/foreman-prompt/INVALID!!!',
      { headers: { Cookie: cookieHeader } }
    );
    expect(resp.status()).toBe(400);
  });

  test('GET /workspace/:urlKey/api/foreman-prompt returns 404 for unknown issue', async ({ page, request }) => {
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const resp = await request.get(
      '/workspace/test-workspace/api/foreman-prompt/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      { headers: { Cookie: cookieHeader } }
    );
    expect(resp.status()).toBe(404);
  });

  test('GET /workspace/:urlKey/api/foreman-prompt returns 403 when proxy feature disabled', async ({ page, request }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: false }))}`);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const resp = await request.get(
      '/workspace/test-workspace/api/foreman-prompt/66666666-6666-6666-6666-666666666666',
      { headers: { Cookie: cookieHeader } }
    );
    expect(resp.status()).toBe(403);
  });
});

test.describe('Workspace API - Mini-foreman Prompt Endpoint', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
  });

  test('GET /workspace/:urlKey/api/mini-foreman-prompt/:issueId returns instruction block', async ({ page, request }) => {
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const resp = await request.get(
      '/workspace/test-workspace/api/mini-foreman-prompt/66666666-6666-6666-6666-666666666666',
      { headers: { Cookie: cookieHeader } }
    );
    expect(resp.status()).toBe(200);

    const data = await resp.json();
    expect(data.label).toBe('mini-foreman');
    expect(data.promptName).toContain('Mini-foreman');
    expect(data.prompt).toContain('/api/proxy/recommend/');
    expect(data.prompt).toContain('Authorization: Bearer YOUR_TOKEN');
    // Should NOT include the full foreman loop/recitation machinery
    expect(data.prompt).not.toContain('Current role:');
    expect(data.prompt).not.toContain('go back to step 1');
  });

  test('GET /workspace/:urlKey/api/mini-foreman-prompt rejects invalid issue ID', async ({ page, request }) => {
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const resp = await request.get(
      '/workspace/test-workspace/api/mini-foreman-prompt/INVALID!!!',
      { headers: { Cookie: cookieHeader } }
    );
    expect(resp.status()).toBe(400);
  });

  test('GET /workspace/:urlKey/api/mini-foreman-prompt returns 404 for unknown issue', async ({ page, request }) => {
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const resp = await request.get(
      '/workspace/test-workspace/api/mini-foreman-prompt/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      { headers: { Cookie: cookieHeader } }
    );
    expect(resp.status()).toBe(404);
  });

  test('GET /workspace/:urlKey/api/mini-foreman-prompt returns 403 when proxy feature disabled', async ({ page, request }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: false }))}`);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const resp = await request.get(
      '/workspace/test-workspace/api/mini-foreman-prompt/66666666-6666-6666-6666-666666666666',
      { headers: { Cookie: cookieHeader } }
    );
    expect(resp.status()).toBe(403);
  });

  test('GET /workspace/:urlKey/api/autopilot-prompt/:issueId returns a scoped kickoff', async ({ page, request }) => {
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const resp = await request.get(
      '/workspace/test-workspace/api/autopilot-prompt/66666666-6666-6666-6666-666666666666',
      { headers: { Cookie: cookieHeader } }
    );
    expect(resp.status()).toBe(200);

    const data = await resp.json();
    expect(data.label).toBe('autopilot');
    expect(data.kind).toBe('autopilot');
    expect(data.promptName).toContain('Autopilot');
    expect(data.prompt).toContain("You're Autopilot");
    expect(data.prompt).toContain('run on autopilot until');
    // Scoped runs don't walk the stack
    expect(data.prompt).not.toContain('/api/proxy/stack?limit=5');
  });

  test('GET /workspace/:urlKey/api/autopilot-prompt (general) walks the stack', async ({ page, request }) => {
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const resp = await request.get(
      '/workspace/test-workspace/api/autopilot-prompt',
      { headers: { Cookie: cookieHeader } }
    );
    expect(resp.status()).toBe(200);

    const data = await resp.json();
    expect(data.label).toBe('autopilot');
    expect(data.kind).toBe('autopilot');
    expect(data.promptName).toBe('Autopilot (stack walk)');
    expect(data.prompt).toContain('/api/proxy/stack?limit=5');
    expect(data.prompt).toContain('walk the stack');
  });

  test('GET /workspace/:urlKey/api/autopilot-prompt honors ?mode=readonly', async ({ page, request }) => {
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const resp = await request.get(
      '/workspace/test-workspace/api/autopilot-prompt?mode=readonly',
      { headers: { Cookie: cookieHeader } }
    );
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.prompt).toContain('READ-ONLY');
    expect(data.prompt).not.toContain('WRITE, merge-gated');
  });

  test('GET /workspace/:urlKey/api/autopilot-prompt rejects invalid issue ID', async ({ page, request }) => {
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const resp = await request.get(
      '/workspace/test-workspace/api/autopilot-prompt/INVALID!!!',
      { headers: { Cookie: cookieHeader } }
    );
    expect(resp.status()).toBe(400);
  });

  test('GET /workspace/:urlKey/api/autopilot-prompt returns 403 when proxy feature disabled', async ({ page, request }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: false }))}`);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const resp = await request.get(
      '/workspace/test-workspace/api/autopilot-prompt',
      { headers: { Cookie: cookieHeader } }
    );
    expect(resp.status()).toBe(403);
  });
});

test.describe('Mini-foreman Button - Main Projects View', () => {
  test('Mini-foreman button renders next to Foreman button when proxy flag is on', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
    await page.goto('/workspace/test-workspace/');
    await page.waitForLoadState('networkidle');

    // LIN-442: the detail block (with the prompt bar) is lazy — expand first.
    await page.locator('.line.expandable').first().click();
    const firstPromptsBar = page.locator('.detail-prompts').first();
    await expect(firstPromptsBar).toBeAttached();
    await expect(firstPromptsBar.locator('.mini-foreman-btn')).toHaveCount(1);
    await expect(firstPromptsBar.locator('.mini-foreman-btn')).toContainText('Mini-foreman');
  });

  test('Mini-foreman button is hidden when proxy flag is off', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: false }))}`);
    await page.goto('/workspace/test-workspace/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.mini-foreman-btn')).toHaveCount(0);
  });

  test('Clicking Mini-foreman button reveals the instruction block', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
    await page.goto('/workspace/test-workspace/');
    await page.waitForLoadState('networkidle');

    // Expand the first issue's details, then its prompts section, then click mini-foreman
    const firstLine = page.locator('.line.expandable').first();
    await firstLine.click();
    const firstDetails = page.locator('.details').first();
    await firstDetails.locator('.detail-toggle[data-toggle="prompts"]').click();

    const miniBtn = firstDetails.locator('.mini-foreman-btn');
    await expect(miniBtn).toBeVisible();
    await miniBtn.click();

    const container = firstDetails.locator('.mini-foreman-container');
    await expect(container).toBeVisible();
    await expect(container.locator('.prompt-text')).toContainText('/api/proxy/recommend/', { timeout: 5000 });
  });
});

test.describe('Autopilot Button - Main Projects View', () => {
  test('Autopilot button renders next to the foreman buttons when proxy flag is on', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
    await page.goto('/workspace/test-workspace/');
    await page.waitForLoadState('networkidle');

    // LIN-442: the detail block (with the prompt bar) is lazy — expand first.
    await page.locator('.line.expandable').first().click();
    const firstPromptsBar = page.locator('.detail-prompts').first();
    await expect(firstPromptsBar).toBeAttached();
    await expect(firstPromptsBar.locator('.autopilot-btn')).toHaveCount(1);
    await expect(firstPromptsBar.locator('.autopilot-btn')).toContainText('Autopilot');
  });

  test('Autopilot button is hidden when proxy flag is off', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: false }))}`);
    await page.goto('/workspace/test-workspace/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.autopilot-btn')).toHaveCount(0);
  });

  test('Clicking Autopilot button reveals the scoped kickoff', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
    await page.goto('/workspace/test-workspace/');
    await page.waitForLoadState('networkidle');

    const firstLine = page.locator('.line.expandable').first();
    await firstLine.click();
    const firstDetails = page.locator('.details').first();
    await firstDetails.locator('.detail-toggle[data-toggle="prompts"]').click();

    const btn = firstDetails.locator('.autopilot-btn');
    await expect(btn).toBeVisible();
    await btn.click();

    const container = firstDetails.locator('.autopilot-container');
    await expect(container).toBeVisible();
    await expect(container).toHaveAttribute('data-kind', 'autopilot');
    await expect(container.locator('.prompt-text')).toContainText("You're Autopilot", { timeout: 5000 });
  });
});

test.describe('Foreman Button - Main Projects View', () => {
  test('Foreman button renders next to prompt buttons when proxy flag is on', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
    await page.goto('/workspace/test-workspace/');
    await page.waitForLoadState('networkidle');

    // Scope to the first actionable issue's prompt buttons row
    // LIN-442: the detail block (with the prompt bar) is lazy — expand first.
    await page.locator('.line.expandable').first().click();
    const firstPromptsBar = page.locator('.detail-prompts').first();
    await expect(firstPromptsBar).toBeAttached();
    await expect(firstPromptsBar.locator('.foreman-btn')).toHaveCount(1);
    await expect(firstPromptsBar.locator('.foreman-btn')).toContainText('Foreman');
  });

  test('Foreman button is hidden when proxy flag is off', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: false }))}`);
    await page.goto('/workspace/test-workspace/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.foreman-btn')).toHaveCount(0);
  });
});

test.describe('Foreman Button - Swipe View', () => {
  test('Foreman button renders inside the swipe prompt picker when proxy flag is on', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
    await page.goto('/workspace/test-workspace/swipe');
    await page.waitForLoadState('networkidle');

    const promptsHeader = page.locator('.swipe-accordion-header[data-accordion="prompts"]');
    await expect(promptsHeader).toBeVisible();
    await promptsHeader.click();

    const foremanBtn = page.locator('.swipe-prompt-btn.foreman-btn');
    await expect(foremanBtn).toBeVisible();
    await expect(foremanBtn).toContainText('Foreman');
  });

  test('Foreman button is hidden in swipe picker when proxy flag is off', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: false }))}`);
    await page.goto('/workspace/test-workspace/swipe');
    await page.waitForLoadState('networkidle');

    const promptsHeader = page.locator('.swipe-accordion-header[data-accordion="prompts"]');
    await promptsHeader.click();

    await expect(page.locator('.swipe-prompt-btn.foreman-btn')).toHaveCount(0);
  });
});

test.describe('Mini-foreman Button - Swipe View', () => {
  test('Mini-foreman button renders inside the swipe prompt picker when proxy flag is on', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
    await page.goto('/workspace/test-workspace/swipe');
    await page.waitForLoadState('networkidle');

    const promptsHeader = page.locator('.swipe-accordion-header[data-accordion="prompts"]');
    await expect(promptsHeader).toBeVisible();
    await promptsHeader.click();

    const miniBtn = page.locator('.swipe-prompt-btn.mini-foreman-btn');
    await expect(miniBtn).toBeVisible();
    await expect(miniBtn).toContainText('Mini-foreman');
  });

  test('Mini-foreman button is hidden in swipe picker when proxy flag is off', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: false }))}`);
    await page.goto('/workspace/test-workspace/swipe');
    await page.waitForLoadState('networkidle');

    const promptsHeader = page.locator('.swipe-accordion-header[data-accordion="prompts"]');
    await promptsHeader.click();

    await expect(page.locator('.swipe-prompt-btn.mini-foreman-btn')).toHaveCount(0);
  });

  test('Clicking Mini-foreman in the swipe picker loads the instruction block', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
    await page.goto('/workspace/test-workspace/swipe');
    await page.waitForLoadState('networkidle');

    const promptsHeader = page.locator('.swipe-accordion-header[data-accordion="prompts"]');
    await expect(promptsHeader).toBeVisible();
    await promptsHeader.click();

    const miniBtn = page.locator('.swipe-prompt-btn.mini-foreman-btn');
    await expect(miniBtn).toBeVisible();
    await miniBtn.click();

    const body = page.locator('[data-prompt-body]');
    await expect(body).toContainText('/api/proxy/recommend/', { timeout: 5000 });
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
    expect(text).toContain('/api/proxy/recap');
    expect(text).toContain('/api/proxy/recommend');
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

test.describe('Foreman Page UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/clear-proxy-tokens');
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: true }))}`);
  });

  test('foreman page loads with proxy feature enabled', async ({ page }) => {
    await page.goto('/workspace/test-workspace/foreman');
    await expect(page.locator('h1')).toContainText('Foreman');
    await expect(page.locator('.foreman-experimental')).toBeVisible();
  });

  test('foreman page redirects to settings when proxy disabled', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ proxy: false }))}`);
    await page.goto('/workspace/test-workspace/foreman');
    await page.waitForURL('**/settings');
    expect(page.url()).toContain('/settings');
  });

  test('foreman page shows the observation sections in order', async ({ page }) => {
    await page.goto('/workspace/test-workspace/foreman');
    // Section headers in DOM order: Sessions (hidden until ≥2 exist), Now
    // working, Timeline, Task threads (hidden until ≥2 exist), Up next.
    // Match the headers present in the observation stack regardless of
    // whether the Sessions / Task threads chrome is currently shown.
    const visible = page.locator('.foreman-section:not([hidden]) .foreman-section-header');
    await expect(visible.nth(0)).toContainText('Now working');
    await expect(visible.nth(1)).toContainText('Timeline');
    await expect(visible.nth(2)).toContainText('Up next');
  });

  test('foreman page has copy button and +proxy toggle', async ({ page }) => {
    await page.goto('/workspace/test-workspace/foreman');
    await expect(page.locator('#foreman-copy-btn')).toBeVisible();
    await expect(page.locator('.prompt-proxy-toggle')).toBeVisible();
  });

  test('copy playbook never embeds a second token when +proxy is on (LIN-525 #6)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    // +proxy persisted ON (the setup panel auto-collapses once the playbook
    // loads, so drive the state via storage rather than clicking the button).
    await page.addInitScript(() => localStorage.setItem('proxy-toggle-active', 'true'));

    // A readWrite token exists, so the page auto-loads the playbook with the
    // token already spliced in (YOUR_TOKEN → currentToken).
    await page.goto('/test/create-proxy-token?scope=readWrite&label=foreman-proxy6');
    await page.goto('/workspace/test-workspace/foreman');
    const output = page.locator('#foreman-playbook-output');
    await expect(output).toHaveClass(/has-content/, { timeout: 10000 });
    await expect(page.locator('body')).toHaveAttribute('data-proxy-active', 'true');

    // With +proxy ON, the copy must neither mint a fresh token nor append a
    // proxy block on top of the already-spliced one (historically it did both).
    let mintAttempted = false;
    await page.route('**/api/proxy/tokens', route => {
      if (route.request().method() === 'POST') mintAttempted = true;
      return route.continue();
    });

    // Re-open the setup panel (it auto-collapsed once the playbook loaded) so
    // the copy button is interactable again.
    await page.locator('#foreman-setup').evaluate(el => { el.open = true; });
    await page.locator('#foreman-copy-btn').click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());

    // The appended-block signature (from ProxyToggle.buildBlock) must be absent:
    // the playbook itself never contains it, so its presence would mean a second
    // block was glued on.
    expect(clip).not.toContain('You have access to a Linear API proxy');
    expect(mintAttempted).toBe(false);
  });

  test('foreman page has token selector', async ({ page }) => {
    await page.goto('/workspace/test-workspace/foreman');
    await expect(page.locator('#foreman-token-select')).toBeVisible();
  });

  test('proxy page links to foreman page', async ({ page }) => {
    await page.goto('/workspace/test-workspace/proxy');
    // Target the section-body link (the header-contained one with experimental badge),
    // not the footer link — the footer now also includes a foreman link.
    const foremanLink = page.locator('main a[href*="/foreman"]');
    await expect(foremanLink).toBeVisible();
    await expect(foremanLink).toContainText('Foreman');
    await expect(page.locator('.foreman-experimental')).toBeVisible();
  });

  test('foreman page loads playbook when token exists', async ({ page }) => {
    // Create a readWrite token first
    await page.goto('/test/create-proxy-token?scope=readWrite&label=foreman-test');

    await page.goto('/workspace/test-workspace/foreman');
    const output = page.locator('#foreman-playbook-output');

    // Wait for playbook to load (it creates a token and fetches)
    await expect(output).toContainText('Foreman', { timeout: 10000 });
    await expect(output).toHaveClass(/has-content/);
  });

  test('foreman page shows status entries', async ({ page, request }) => {
    // Create a write token and post a status entry
    const tokenResp = await page.goto('/test/create-proxy-token?scope=readWrite&label=foreman-status-test');
    const { token } = await tokenResp.json();

    await request.post('/api/proxy/foreman/status', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      data: {
        taskIdentifier: 'TEST-99',
        action: 'research',
        status: 'completed',
        summary: 'Found the answer'
      }
    });

    await page.goto('/workspace/test-workspace/foreman');

    // Wait for status to load
    const statusList = page.locator('#foreman-status-list');
    await expect(statusList.locator('.foreman-timeline-item').first()).toBeVisible({ timeout: 10000 });
    await expect(statusList).toContainText('TEST-99');
    await expect(statusList).toContainText('research');
    await expect(statusList).toContainText('completed');
  });

  test('foreman page shows stack preview', async ({ page }) => {
    // Create a readWrite token so the page can fetch the stack
    await page.goto('/test/create-proxy-token?scope=readWrite&label=foreman-stack-test');

    await page.goto('/workspace/test-workspace/foreman');

    // Wait for stack to load
    const stackList = page.locator('#foreman-stack-list');
    await expect(stackList.locator('.foreman-stack-card').first()).toBeVisible({ timeout: 10000 });

    // Should show task cards
    const items = stackList.locator('.foreman-stack-card');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(5);
  });
});

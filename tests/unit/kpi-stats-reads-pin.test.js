/**
 * LIN-3689: pins every store read `collectKpiStats` issues (collection, method,
 * filter, pipeline, projection) at a fixed `now`.
 *
 * Run with: node --test tests/unit/kpi-stats-reads-pin.test.js
 *
 * The snapshot below was captured on origin/main BEFORE `summarizeActivity` was
 * extracted and the optional `urlKey` filter was added, so it passes before and
 * after: the public /kpis page keeps reading exactly what it read.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { collectKpiStats } from '../../lib/kpi-stats.js';

const NOW = new Date('2026-06-10T12:00:00.000Z');

const NAMES = [
  'sessions', 'userPreferences', 'workspacePreferences', 'customPrompts', 'localIssues',
  'dispatchQueue', 'dispatchHistory', 'dispatchTokens', 'proxyTokens', 'proxyEvents',
  'agentStatus', 'freeTier', 'recapCache', 'briefCache', 'reportHistory', 'kpiDailyRollup'
];

// Dates and regexes are not JSON; render them as strings so deepStrictEqual
// compares plain data. `undefined` is kept visible too: JSON would drop a
// `urlKey: undefined`, which is exactly the key the loaders must not add.
const plain = value => JSON.parse(JSON.stringify(value, (_key, v) => {
  if (v === undefined) return '<undefined>';
  return v instanceof RegExp ? `RegExp(${v})` : v;
}));

function recordingCollections({ withAggregate }) {
  const calls = [];
  const collections = {};
  for (const name of NAMES) {
    const col = {
      find: (...args) => {
        calls.push({ collection: name, method: 'find', args: plain(args) });
        return { toArray: async () => [] };
      },
      countDocuments: async (...args) => {
        calls.push({ collection: name, method: 'countDocuments', args: plain(args) });
        return 0;
      }
    };
    if (withAggregate) {
      col.aggregate = (...args) => {
        calls.push({ collection: name, method: 'aggregate', args: plain(args) });
        return { toArray: async () => [] };
      };
    }
    collections[name] = col;
  }
  return { collections, calls };
}

async function recordReads(opts) {
  const { collections, calls } = recordingCollections(opts);
  await collectKpiStats(collections, { now: NOW, milestoneFunnelDeps: {} });
  return calls;
}

test('collectKpiStats read shapes (aggregate path)', async () => {
  const calls = await recordReads({ withAggregate: true });
  assert.deepStrictEqual(calls, AGGREGATE_SNAPSHOT);
});

test('collectKpiStats read shapes (find fallback path)', async () => {
  const calls = await recordReads({ withAggregate: false });
  assert.deepStrictEqual(calls, FIND_SNAPSHOT);
});
const AGGREGATE_SNAPSHOT = [
  {
    collection: 'sessions',
    method: 'find',
    args: [
      {},
      {
        projection: {
          expires: 1
        }
      }
    ]
  },
  {
    collection: 'userPreferences',
    method: 'countDocuments',
    args: [
      {}
    ]
  },
  {
    collection: 'workspacePreferences',
    method: 'find',
    args: [
      {}
    ]
  },
  {
    collection: 'customPrompts',
    method: 'find',
    args: [
      {}
    ]
  },
  {
    collection: 'localIssues',
    method: 'countDocuments',
    args: [
      {
        kind: 'issue'
      }
    ]
  },
  {
    collection: 'localIssues',
    method: 'countDocuments',
    args: [
      {
        kind: 'project'
      }
    ]
  },
  {
    collection: 'dispatchQueue',
    method: 'find',
    args: [
      {}
    ]
  },
  {
    collection: 'dispatchHistory',
    method: 'aggregate',
    args: [
      [
        {
          $match: {
            dispatchedAt: {
              $gte: '2026-05-11T12:00:00.000Z'
            }
          }
        },
        {
          $project: {
            urlKey: 1,
            status: 1,
            dispatchedAt: 1,
            resolvedAt: 1,
            kind: 1,
            rootItemId: 1,
            followUpTo: 1,
            abort: 1,
            abortTo: 1,
            issueIdentifier: 1,
            harness: 1,
            feedbackCount: {
              $cond: [
                {
                  $and: [
                    {
                      $eq: [
                        {
                          $type: '$feedbackDigest'
                        },
                        'object'
                      ]
                    },
                    {
                      $eq: [
                        {
                          $ifNull: [
                            '$feedbackDigest.version',
                            -1
                          ]
                        },
                        {
                          $ifNull: [
                            '$feedbackVersion',
                            0
                          ]
                        }
                      ]
                    }
                  ]
                },
                '$feedbackDigest.count',
                {
                  $size: {
                    $ifNull: [
                      '$feedback',
                      []
                    ]
                  }
                }
              ]
            },
            terminalEntry: {
              $cond: [
                {
                  $and: [
                    {
                      $eq: [
                        {
                          $type: '$feedbackDigest'
                        },
                        'object'
                      ]
                    },
                    {
                      $eq: [
                        {
                          $ifNull: [
                            '$feedbackDigest.version',
                            -1
                          ]
                        },
                        {
                          $ifNull: [
                            '$feedbackVersion',
                            0
                          ]
                        }
                      ]
                    }
                  ]
                },
                '$feedbackDigest.kpiTerminalEntry',
                {
                  $last: {
                    $filter: {
                      input: {
                        $map: {
                          input: {
                            $ifNull: [
                              '$feedback',
                              []
                            ]
                          },
                          as: 'f',
                          in: {
                            message: '$$f.message',
                            timestamp: '$$f.timestamp'
                          }
                        }
                      },
                      as: 'entry',
                      cond: {
                        $regexMatch: {
                          input: {
                            $ifNull: [
                              '$$entry.message',
                              ''
                            ]
                          },
                          regex: '^\\s*\\[(done|complete|failed|aborted|skipped)\\]',
                          options: 'i'
                        }
                      }
                    }
                  }
                }
              ]
            },
            usageEntry: {
              $cond: [
                {
                  $and: [
                    {
                      $eq: [
                        {
                          $type: '$feedbackDigest'
                        },
                        'object'
                      ]
                    },
                    {
                      $eq: [
                        {
                          $ifNull: [
                            '$feedbackDigest.version',
                            -1
                          ]
                        },
                        {
                          $ifNull: [
                            '$feedbackVersion',
                            0
                          ]
                        }
                      ]
                    }
                  ]
                },
                '$feedbackDigest.kpiUsageEntry',
                {
                  $last: {
                    $filter: {
                      input: {
                        $map: {
                          input: {
                            $ifNull: [
                              '$feedback',
                              []
                            ]
                          },
                          as: 'f',
                          in: {
                            message: '$$f.message',
                            timestamp: '$$f.timestamp',
                            kind: '$$f.kind'
                          }
                        }
                      },
                      as: 'entry',
                      cond: {
                        $eq: [
                          '$$entry.kind',
                          'usage'
                        ]
                      }
                    }
                  }
                }
              ]
            },
            evidenceCount: {
              $cond: [
                {
                  $and: [
                    {
                      $eq: [
                        {
                          $type: '$feedbackDigest'
                        },
                        'object'
                      ]
                    },
                    {
                      $eq: [
                        {
                          $ifNull: [
                            '$feedbackDigest.version',
                            -1
                          ]
                        },
                        {
                          $ifNull: [
                            '$feedbackVersion',
                            0
                          ]
                        }
                      ]
                    }
                  ]
                },
                '$feedbackDigest.kpiEvidenceCount',
                {
                  $size: {
                    $filter: {
                      input: {
                        $map: {
                          input: {
                            $ifNull: [
                              '$feedback',
                              []
                            ]
                          },
                          as: 'f',
                          in: {
                            message: '$$f.message',
                            timestamp: '$$f.timestamp',
                            kind: '$$f.kind'
                          }
                        }
                      },
                      as: 'entry',
                      cond: {
                        $eq: [
                          '$$entry.kind',
                          'evidence'
                        ]
                      }
                    }
                  }
                }
              ]
            },
            ticketMarkerEntries: {
              $cond: [
                {
                  $and: [
                    {
                      $eq: [
                        {
                          $type: '$feedbackDigest'
                        },
                        'object'
                      ]
                    },
                    {
                      $eq: [
                        {
                          $ifNull: [
                            '$feedbackDigest.version',
                            -1
                          ]
                        },
                        {
                          $ifNull: [
                            '$feedbackVersion',
                            0
                          ]
                        }
                      ]
                    }
                  ]
                },
                '$feedbackDigest.kpiTicketMarkerEntries',
                {
                  $filter: {
                    input: {
                      $map: {
                        input: {
                          $ifNull: [
                            '$feedback',
                            []
                          ]
                        },
                        as: 'f',
                        in: {
                          message: '$$f.message',
                          timestamp: '$$f.timestamp'
                        }
                      }
                    },
                    as: 'entry',
                    cond: {
                      $regexMatch: {
                        input: {
                          $ifNull: [
                            '$$entry.message',
                            ''
                          ]
                        },
                        regex: '^\\s*\\[ticket\\]\\s*(LIN-\\d+)\\s+(started|done|blocked|refused|dissolved|trimmed)\\b\\s*(?:[—-]\\s*(.*))?$',
                        options: 'i'
                      }
                    }
                  }
                }
              ]
            }
          }
        }
      ]
    ]
  },
  {
    collection: 'dispatchTokens',
    method: 'countDocuments',
    args: [
      {
        $or: [
          {
            expiresAt: null
          },
          {
            expiresAt: {
              $exists: false
            }
          },
          {
            expiresAt: {
              $gt: '2026-06-10T12:00:00.000Z'
            }
          }
        ]
      }
    ]
  },
  {
    collection: 'proxyTokens',
    method: 'countDocuments',
    args: [
      {}
    ]
  },
  {
    collection: 'proxyEvents',
    method: 'aggregate',
    args: [
      [
        {
          $match: {
            timestamp: {
              $gte: '2026-05-11T12:00:00.000Z'
            }
          }
        },
        {
          $group: {
            _id: {
              method: '$method',
              endpoint: '$endpoint',
              status: '$status',
              hour: {
                $dateToString: {
                  format: '%Y-%m-%dT%H',
                  date: '$timestamp',
                  timezone: 'UTC'
                }
              }
            },
            count: {
              $sum: 1
            },
            urlKeys: {
              $addToSet: '$urlKey'
            }
          }
        }
      ]
    ]
  },
  {
    collection: 'agentStatus',
    method: 'find',
    args: [
      {
        timestamp: {
          $gte: '2026-05-11T12:00:00.000Z'
        }
      },
      {
        projection: {
          dispatchId: 1,
          status: 1,
          timestamp: 1,
          urlKey: 1
        }
      }
    ]
  },
  {
    collection: 'freeTier',
    method: 'find',
    args: [
      {}
    ]
  },
  {
    collection: 'recapCache',
    method: 'countDocuments',
    args: [
      {}
    ]
  },
  {
    collection: 'briefCache',
    method: 'countDocuments',
    args: [
      {}
    ]
  },
  {
    collection: 'reportHistory',
    method: 'find',
    args: [
      {}
    ]
  },
  {
    collection: 'kpiDailyRollup',
    method: 'aggregate',
    args: [
      [
        {
          $group: {
            _id: '$day',
            done: {
              $sum: '$done'
            }
          }
        }
      ]
    ]
  }
];

const FIND_SNAPSHOT = [
  {
    collection: 'sessions',
    method: 'find',
    args: [
      {},
      {
        projection: {
          expires: 1
        }
      }
    ]
  },
  {
    collection: 'userPreferences',
    method: 'countDocuments',
    args: [
      {}
    ]
  },
  {
    collection: 'workspacePreferences',
    method: 'find',
    args: [
      {}
    ]
  },
  {
    collection: 'customPrompts',
    method: 'find',
    args: [
      {}
    ]
  },
  {
    collection: 'localIssues',
    method: 'countDocuments',
    args: [
      {
        kind: 'issue'
      }
    ]
  },
  {
    collection: 'localIssues',
    method: 'countDocuments',
    args: [
      {
        kind: 'project'
      }
    ]
  },
  {
    collection: 'dispatchQueue',
    method: 'find',
    args: [
      {}
    ]
  },
  {
    collection: 'dispatchHistory',
    method: 'find',
    args: [
      {
        dispatchedAt: {
          $gte: '2026-05-11T12:00:00.000Z'
        }
      }
    ]
  },
  {
    collection: 'dispatchTokens',
    method: 'countDocuments',
    args: [
      {
        $or: [
          {
            expiresAt: null
          },
          {
            expiresAt: {
              $exists: false
            }
          },
          {
            expiresAt: {
              $gt: '2026-06-10T12:00:00.000Z'
            }
          }
        ]
      }
    ]
  },
  {
    collection: 'proxyTokens',
    method: 'countDocuments',
    args: [
      {}
    ]
  },
  {
    collection: 'proxyEvents',
    method: 'find',
    args: [
      {
        timestamp: {
          $gte: '2026-05-11T12:00:00.000Z'
        }
      },
      {
        projection: {
          method: 1,
          endpoint: 1,
          status: 1,
          timestamp: 1,
          urlKey: 1
        }
      }
    ]
  },
  {
    collection: 'agentStatus',
    method: 'find',
    args: [
      {
        timestamp: {
          $gte: '2026-05-11T12:00:00.000Z'
        }
      },
      {
        projection: {
          dispatchId: 1,
          status: 1,
          timestamp: 1,
          urlKey: 1
        }
      }
    ]
  },
  {
    collection: 'freeTier',
    method: 'find',
    args: [
      {}
    ]
  },
  {
    collection: 'recapCache',
    method: 'countDocuments',
    args: [
      {}
    ]
  },
  {
    collection: 'briefCache',
    method: 'countDocuments',
    args: [
      {}
    ]
  },
  {
    collection: 'reportHistory',
    method: 'find',
    args: [
      {}
    ]
  },
  {
    collection: 'kpiDailyRollup',
    method: 'find',
    args: [
      {},
      {
        projection: {
          _id: 0,
          day: 1,
          done: 1
        }
      }
    ]
  }
];

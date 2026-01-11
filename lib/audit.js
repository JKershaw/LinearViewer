/**
 * Workspace Audit Module
 *
 * Queries Linear's GraphQL API and computes an audit report about
 * the workspace structure, labels, queues, and task health.
 */
import { GraphQLClient, gql } from 'graphql-request';
import { QUEUE_CONFIG, QUEUE_TYPES, getQueueForLabel, isInQueue } from './queue-config.js';

// =============================================================================
// GraphQL Queries
// =============================================================================

/**
 * Fetches all teams in the workspace.
 */
const TEAMS_QUERY = gql`
  query {
    teams {
      nodes {
        id
        name
        key
      }
    }
  }
`;

/**
 * Fetches all projects (including all states for audit).
 */
const ALL_PROJECTS_QUERY = gql`
  query {
    projects {
      nodes {
        id
        name
        state
        url
      }
    }
  }
`;

/**
 * Fetches all workflow states across teams.
 */
const WORKFLOW_STATES_QUERY = gql`
  query {
    workflowStates {
      nodes {
        id
        name
        type
        team {
          id
          name
        }
      }
    }
  }
`;

/**
 * Fetches all labels with their issue counts.
 */
const LABELS_QUERY = gql`
  query($first: Int!, $after: String) {
    issueLabels(first: $first, after: $after) {
      nodes {
        id
        name
        color
        issues {
          nodes {
            id
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/**
 * Issue fields for audit - includes all fields we need to check.
 */
const AUDIT_ISSUE_FIELDS = gql`
  fragment AuditIssueFields on Issue {
    id
    title
    description
    estimate
    dueDate
    project { id }
    state { name, type }
    assignee { id, name }
    labels {
      nodes {
        id
        name
      }
    }
  }
`;

/**
 * Fetches all issues for audit analysis.
 */
const AUDIT_ISSUES_QUERY = gql`
  ${AUDIT_ISSUE_FIELDS}
  query($first: Int!, $after: String) {
    issues(first: $first, after: $after) {
      nodes {
        ...AuditIssueFields
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// =============================================================================
// Data Fetching
// =============================================================================

/**
 * Fetches all paginated items from a Linear query.
 *
 * @param {GraphQLClient} client - GraphQL client
 * @param {string} query - GraphQL query with pagination
 * @param {string} dataPath - Path to data in response (e.g., 'issues', 'issueLabels')
 * @returns {Promise<Array>} All items
 */
async function fetchAllPaginated(client, query, dataPath) {
  const items = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const data = await client.request(query, { first: 250, after: cursor });
    const result = data[dataPath];
    items.push(...result.nodes);
    hasNextPage = result.pageInfo.hasNextPage;
    cursor = result.pageInfo.endCursor;
  }

  return items;
}

/**
 * Fetches all data needed for the audit.
 *
 * @param {string} accessToken - OAuth access token
 * @returns {Promise<Object>} Raw data from Linear
 */
async function fetchAuditData(accessToken) {
  const client = new GraphQLClient('https://api.linear.app/graphql', {
    headers: { Authorization: accessToken }
  });

  // Fetch all data in parallel
  const [teamsData, projectsData, statesData, labels, issues] = await Promise.all([
    client.request(TEAMS_QUERY),
    client.request(ALL_PROJECTS_QUERY),
    client.request(WORKFLOW_STATES_QUERY),
    fetchAllPaginated(client, LABELS_QUERY, 'issueLabels'),
    fetchAllPaginated(client, AUDIT_ISSUES_QUERY, 'issues')
  ]);

  return {
    teams: teamsData.teams?.nodes || [],
    projects: projectsData.projects?.nodes || [],
    workflowStates: statesData.workflowStates?.nodes || [],
    labels,
    issues
  };
}

// =============================================================================
// Audit Computation
// =============================================================================

/**
 * Computes workspace structure summary.
 *
 * @param {Object} data - Raw audit data
 * @returns {Object} Workspace structure info
 */
function computeWorkspaceStructure(data) {
  const { teams, projects, workflowStates } = data;

  // Count projects by state
  const projectsByState = {};
  for (const project of projects) {
    projectsByState[project.state] = (projectsByState[project.state] || 0) + 1;
  }

  // Group workflow states by team
  const statesByTeam = {};
  for (const state of workflowStates) {
    const teamName = state.team?.name || 'Unknown';
    if (!statesByTeam[teamName]) {
      statesByTeam[teamName] = [];
    }
    statesByTeam[teamName].push({
      name: state.name,
      type: state.type
    });
  }

  return {
    teams: teams.map(t => ({ id: t.id, name: t.name, key: t.key })),
    teamCount: teams.length,
    projects: projects.map(p => ({ id: p.id, name: p.name, state: p.state })),
    projectCount: projects.length,
    projectsByState,
    workflowStates: statesByTeam
  };
}

/**
 * Computes label analysis.
 *
 * @param {Object} data - Raw audit data
 * @returns {Object} Label analysis
 */
function computeLabelAnalysis(data) {
  const { labels, issues } = data;

  // Count issues per label
  const labelStats = labels.map(label => {
    const issueCount = label.issues?.nodes?.length || 0;
    const queueMapping = getQueueForLabel(label.name);

    return {
      id: label.id,
      name: label.name,
      color: label.color,
      issueCount,
      queue: queueMapping
    };
  });

  // Separate mapped vs unmapped labels
  const mappedLabels = labelStats.filter(l => l.queue !== null);
  const unmappedLabels = labelStats.filter(l => l.queue === null);

  return {
    all: labelStats.sort((a, b) => b.issueCount - a.issueCount),
    mapped: mappedLabels,
    unmapped: unmappedLabels,
    totalLabels: labels.length,
    mappedCount: mappedLabels.length,
    unmappedCount: unmappedLabels.length
  };
}

/**
 * Computes queue readiness analysis using hybrid approach.
 * Queues can be label-based, state-based, or implicit.
 *
 * @param {Object} data - Raw audit data
 * @param {Object} labelAnalysis - Pre-computed label analysis
 * @returns {Object} Queue readiness info
 */
function computeQueueReadiness(data, labelAnalysis) {
  const { issues, workflowStates } = data;

  // Get all state types that exist in the workspace
  const existingStateTypes = new Set(
    workflowStates.map(s => s.type?.toLowerCase()).filter(Boolean)
  );

  // Get all label names that exist in the workspace
  const existingLabels = new Set(
    labelAnalysis.all.map(l => l.name.toLowerCase())
  );

  // Build queue status for each queue definition
  const queueStatus = {};
  for (const queueDef of QUEUE_CONFIG) {
    // Count tasks in this queue
    const tasksInQueue = issues.filter(issue => isInQueue(issue, queueDef));

    // Determine if queue "exists" based on type
    let exists = false;
    let matchedLabel = null;

    switch (queueDef.type) {
      case QUEUE_TYPES.LABEL:
        // Label-based queue exists if at least one matching label exists
        for (const pattern of queueDef.labelPatterns || []) {
          if (existingLabels.has(pattern.toLowerCase())) {
            exists = true;
            matchedLabel = pattern;
            break;
          }
        }
        break;

      case QUEUE_TYPES.STATE:
        // State-based queue exists if matching state types exist in workflow
        exists = (queueDef.stateTypes || []).some(st =>
          existingStateTypes.has(st.toLowerCase())
        );
        break;

      case QUEUE_TYPES.IMPLICIT:
        // Implicit queues always exist if the base state types exist
        exists = (queueDef.stateTypes || []).some(st =>
          existingStateTypes.has(st.toLowerCase())
        );
        break;
    }

    queueStatus[queueDef.name] = {
      name: queueDef.name,
      type: queueDef.type,
      required: queueDef.required,
      description: queueDef.description,
      matchedLabel,
      taskCount: tasksInQueue.length,
      exists
    };
  }

  // Convert to array and identify missing required queues
  const queues = Object.values(queueStatus);
  const missingRequired = queues.filter(q => q.required && !q.exists);
  const missingOptional = queues.filter(q => !q.required && !q.exists);

  // Calculate readiness score (percentage of required queues that exist)
  const requiredQueues = queues.filter(q => q.required);
  const existingRequired = requiredQueues.filter(q => q.exists);
  const readinessScore = requiredQueues.length > 0
    ? Math.round((existingRequired.length / requiredQueues.length) * 100)
    : 100;

  return {
    queues,
    missingRequired,
    missingOptional,
    readinessScore,
    isReady: missingRequired.length === 0
  };
}

/**
 * Computes task health analysis.
 *
 * @param {Object} data - Raw audit data
 * @returns {Object} Task health info
 */
function computeTaskHealth(data) {
  const { issues } = data;

  // Count issues by state type
  const byStateType = {};
  const byState = {};

  // Track health issues
  const orphans = [];
  const unlabeled = [];
  const shortDescription = [];
  const noAssignee = [];

  const SHORT_DESCRIPTION_THRESHOLD = 20;

  for (const issue of issues) {
    // Count by state
    const stateType = issue.state?.type || 'unknown';
    const stateName = issue.state?.name || 'Unknown';
    byStateType[stateType] = (byStateType[stateType] || 0) + 1;
    byState[stateName] = (byState[stateName] || 0) + 1;

    // Check for orphans (no project)
    if (!issue.project?.id) {
      orphans.push({ id: issue.id, title: issue.title });
    }

    // Check for unlabeled
    const labelCount = issue.labels?.nodes?.length || 0;
    if (labelCount === 0) {
      unlabeled.push({ id: issue.id, title: issue.title });
    }

    // Check description length
    const descLength = issue.description?.length || 0;
    if (descLength < SHORT_DESCRIPTION_THRESHOLD) {
      shortDescription.push({
        id: issue.id,
        title: issue.title,
        descriptionLength: descLength
      });
    }

    // Check for no assignee
    if (!issue.assignee?.id) {
      noAssignee.push({ id: issue.id, title: issue.title });
    }
  }

  return {
    totalTasks: issues.length,
    byStateType,
    byState,
    orphans: {
      count: orphans.length,
      items: orphans.slice(0, 10) // Limit to first 10
    },
    unlabeled: {
      count: unlabeled.length,
      items: unlabeled.slice(0, 10)
    },
    shortDescription: {
      count: shortDescription.length,
      threshold: SHORT_DESCRIPTION_THRESHOLD,
      items: shortDescription.slice(0, 10)
    },
    noAssignee: {
      count: noAssignee.length,
      items: noAssignee.slice(0, 10)
    }
  };
}

/**
 * Computes field usage statistics.
 *
 * @param {Object} data - Raw audit data
 * @returns {Object} Field usage info
 */
function computeFieldUsage(data) {
  const { issues } = data;

  if (issues.length === 0) {
    return {
      estimatesUsage: 0,
      dueDatesUsage: 0
    };
  }

  // Count usage
  let withEstimates = 0;
  let withDueDates = 0;

  for (const issue of issues) {
    if (issue.estimate !== null && issue.estimate !== undefined) {
      withEstimates++;
    }
    if (issue.dueDate) {
      withDueDates++;
    }
  }

  return {
    estimatesUsage: Math.round((withEstimates / issues.length) * 100),
    dueDatesUsage: Math.round((withDueDates / issues.length) * 100),
    withEstimates,
    withDueDates,
    totalTasks: issues.length
  };
}

/**
 * Computes tasks per project.
 *
 * @param {Object} data - Raw audit data
 * @returns {Object[]} Project task counts
 */
function computeTasksPerProject(data) {
  const { issues, projects } = data;

  // Build project map
  const projectMap = new Map();
  for (const project of projects) {
    projectMap.set(project.id, {
      id: project.id,
      name: project.name,
      state: project.state,
      taskCount: 0
    });
  }

  // Count tasks per project
  for (const issue of issues) {
    if (issue.project?.id && projectMap.has(issue.project.id)) {
      projectMap.get(issue.project.id).taskCount++;
    }
  }

  return Array.from(projectMap.values())
    .sort((a, b) => b.taskCount - a.taskCount);
}

// =============================================================================
// Main Audit Function
// =============================================================================

/**
 * Runs a complete workspace audit.
 *
 * @param {string} accessToken - OAuth access token
 * @returns {Promise<Object>} Complete audit report
 */
export async function runAudit(accessToken) {
  // Fetch all data
  const data = await fetchAuditData(accessToken);

  // Compute all analyses
  const workspace = computeWorkspaceStructure(data);
  const labels = computeLabelAnalysis(data);
  const queues = computeQueueReadiness(data, labels);
  const health = computeTaskHealth(data);
  const fields = computeFieldUsage(data);
  const projectTasks = computeTasksPerProject(data);

  return {
    timestamp: new Date().toISOString(),
    workspace,
    labels,
    queues,
    health,
    fields,
    projectTasks
  };
}

// =============================================================================
// Test/Mock Support
// =============================================================================

/**
 * Computes audit from mock data (for testing).
 *
 * @param {Object} mockData - Mock data matching the shape of fetchAuditData output
 * @returns {Object} Complete audit report
 */
export function computeAuditFromData(mockData) {
  const data = {
    teams: mockData.teams || [],
    projects: mockData.projects || [],
    workflowStates: mockData.workflowStates || [],
    labels: mockData.labels || [],
    issues: mockData.issues || []
  };

  const workspace = computeWorkspaceStructure(data);
  const labels = computeLabelAnalysis(data);
  const queues = computeQueueReadiness(data, labels);
  const health = computeTaskHealth(data);
  const fields = computeFieldUsage(data);
  const projectTasks = computeTasksPerProject(data);

  return {
    timestamp: new Date().toISOString(),
    workspace,
    labels,
    queues,
    health,
    fields,
    projectTasks
  };
}

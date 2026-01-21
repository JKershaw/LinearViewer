#!/usr/bin/env node
/**
 * Prompt Audit Script
 *
 * Extracts all prompt templates and generates sample outputs for review.
 * Usage: node scripts/audit-prompts.js [template-key]
 *
 * If no template key is provided, outputs all templates.
 */

import { PROMPT_TEMPLATES, PROMPT_CATEGORIES, CATEGORY_DISPLAY_NAMES } from '../lib/prompt-templates.js';

// Mock issue data for generating sample prompts
const mockIssue = {
  identifier: 'LIN-123',
  title: 'Implement user authentication flow',
  description: 'Add OAuth2 authentication with support for Google and GitHub providers.',
  url: 'https://linear.app/team/issue/LIN-123',
  state: { name: 'Todo', type: 'unstarted' },
  priority: 2,
  assignee: { name: 'Developer' },
  labels: ['feature']
};

// Mock context for generating sample prompts
const mockContext = {
  parent: {
    identifier: 'LIN-100',
    title: 'User Management System',
    state: { name: 'In Progress', type: 'started' }
  },
  siblings: [
    { identifier: 'LIN-121', title: 'Design user settings page', state: { name: 'Done', type: 'completed' } },
    { identifier: 'LIN-122', title: 'Implement password reset', state: { name: 'Todo', type: 'unstarted' } }
  ],
  project: {
    name: 'Product',
    description: 'User-facing features and improvements'
  },
  children: [
    { identifier: 'LIN-124', title: 'Set up OAuth providers', state: { name: 'Done', type: 'completed' } },
    { identifier: 'LIN-125', title: 'Create login UI', state: { name: 'In Progress', type: 'started' } }
  ],
  comments: [
    {
      body: 'We should prioritize Google OAuth first as most users have Google accounts.',
      user: 'Product Manager',
      createdAt: '2024-01-15T10:00:00Z'
    },
    {
      body: 'Investigated OAuth libraries. Recommend using passport.js for flexibility.',
      user: 'Developer',
      createdAt: '2024-01-16T14:30:00Z'
    }
  ]
};

/**
 * Get all template keys organized by category
 */
function getTemplatesByCategory() {
  const byCategory = {};

  for (const [key, template] of Object.entries(PROMPT_TEMPLATES)) {
    const categoryName = CATEGORY_DISPLAY_NAMES[template.category] || template.category;
    if (!byCategory[categoryName]) {
      byCategory[categoryName] = [];
    }
    byCategory[categoryName].push({ key, template });
  }

  return byCategory;
}

/**
 * Generate a sample prompt for a template
 */
function generateSamplePrompt(key, template) {
  // Create issue variant with appropriate labels for the template
  const issueVariant = { ...mockIssue };
  if (key === 'blocked') {
    issueVariant.labels = ['blocked', 'feature'];
  } else if (key === 'bug') {
    issueVariant.labels = ['bug'];
  }

  return template.generate(issueVariant, mockContext);
}

/**
 * Output template info and sample prompt
 */
function outputTemplate(key, template) {
  const categoryName = CATEGORY_DISPLAY_NAMES[template.category] || template.category;

  console.log('='.repeat(80));
  console.log(`TEMPLATE: ${key}`);
  console.log('='.repeat(80));
  console.log(`Name: ${template.name}`);
  console.log(`Category: ${categoryName}`);
  console.log(`Description: ${template.description}`);

  if (template.aiHint) {
    console.log('\nAI Hint:');
    console.log(`  Situation: ${template.aiHint.situation}`);
    console.log(`  Goal: ${template.aiHint.goal}`);
    console.log(`  Workflow: ${template.aiHint.workflow}`);
    if (template.aiHint.readinessCheck) {
      console.log(`  Readiness Check: ${template.aiHint.readinessCheck}`);
    }
  }

  if (template.completionSignals) {
    console.log('\nCompletion Signals:');
    console.log(`  Core Outcome: ${template.completionSignals.coreOutcome}`);
    console.log(`  Readiness Check: ${template.completionSignals.readinessCheck}`);
  }

  console.log('\n' + '-'.repeat(80));
  console.log('GENERATED PROMPT:');
  console.log('-'.repeat(80));
  console.log(generateSamplePrompt(key, template));
  console.log('\n');
}

/**
 * Output summary statistics
 */
function outputSummary() {
  const byCategory = getTemplatesByCategory();
  const totalTemplates = Object.keys(PROMPT_TEMPLATES).length;

  console.log('='.repeat(80));
  console.log('PROMPT AUDIT SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Templates: ${totalTemplates}\n`);

  for (const [category, templates] of Object.entries(byCategory)) {
    console.log(`${category}: ${templates.length}`);
    for (const { key, template } of templates) {
      console.log(`  - ${key}: ${template.name}`);
    }
  }
  console.log('\n');
}

/**
 * Output as JSON for programmatic use
 */
function outputJSON(templateKey = null) {
  const output = {};

  for (const [key, template] of Object.entries(PROMPT_TEMPLATES)) {
    if (templateKey && key !== templateKey) continue;

    output[key] = {
      name: template.name,
      category: CATEGORY_DISPLAY_NAMES[template.category] || template.category,
      description: template.description,
      aiHint: template.aiHint || null,
      completionSignals: template.completionSignals || null,
      samplePrompt: generateSamplePrompt(key, template)
    };
  }

  console.log(JSON.stringify(output, null, 2));
}

// Main execution
const args = process.argv.slice(2);
const templateKey = args.find(a => !a.startsWith('--'));
const jsonMode = args.includes('--json');
const summaryOnly = args.includes('--summary');

if (jsonMode) {
  outputJSON(templateKey);
} else if (summaryOnly) {
  outputSummary();
} else if (templateKey) {
  const template = PROMPT_TEMPLATES[templateKey];
  if (template) {
    outputTemplate(templateKey, template);
  } else {
    console.error(`Unknown template: ${templateKey}`);
    console.error(`Available templates: ${Object.keys(PROMPT_TEMPLATES).join(', ')}`);
    process.exit(1);
  }
} else {
  outputSummary();
  for (const [key, template] of Object.entries(PROMPT_TEMPLATES)) {
    outputTemplate(key, template);
  }
}

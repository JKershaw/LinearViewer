/**
 * Roadmap chat prompt template.
 *
 * Builds a messages array for conversational Q&A about the roadmap.
 * Supports conversation history for multi-turn follow-ups.
 * Output is plain text (no markdown) for terminal-style rendering.
 */

import { summarizeRoadmapModel } from './roadmap-narrative-template.js';

/**
 * Build a messages array for roadmap chat.
 *
 * @param {Object} roadmapModel - The deterministic roadmap model
 * @param {Object} roadmapModel.velocity - { tasksPerWeek, pointsPerWeek, trend }
 * @param {Array}  roadmapModel.milestones - Milestones with timeline projections
 * @param {Object} roadmapModel.criticalPaths - Critical paths keyed by project name
 * @param {Array}  roadmapModel.risks - Risk objects
 * @param {string} question - The user's current question
 * @param {Array<{role: string, content: string}>} [history=[]] - Prior conversation turns
 * @returns {Array<{role: string, content: string}>} Messages array for streamChat
 */
export function buildRoadmapChatMessages(roadmapModel, question, history = []) {
  const summary = summarizeRoadmapModel(roadmapModel);

  const system = `You are a roadmap analyst answering questions about a team's project roadmap. You must ground every answer in the data below.

ROADMAP DATA:
${summary}

OUTPUT FORMAT: Plain text only. Do NOT use markdown (no **, no ##, no - bullets, no backticks). Use line breaks and indentation for structure. The output is displayed in a monospace terminal-style interface.

RULES:
- Cite specific data (project names, dates, velocity numbers) to support answers.
- Tasks may have subtasks shown as indented trees. Use subtask rollups to describe parent task progress.
- Do NOT invent or extrapolate beyond the data. If the data cannot answer the question, say so.
- Keep answers concise (under 200 words unless the question requires more detail).
- Lead with the direct answer, then supporting data.
- For what-if questions, state assumptions explicitly before reasoning.

QUESTION TYPES YOU HANDLE:
- Timeline: reference projected dates and velocity
- Priorities: reference project ordering and status
- Risks: reference blockers, dependencies, velocity trends
- Dependencies: reference critical path data
- What-if: reason conditionally using velocity and dependency data, label inferences clearly
- Progress: reference completion percentages and subtask rollups

TONE: Precise, data-driven, candid about uncertainty.`;

  const messages = [{ role: 'system', content: system }];

  // Append conversation history (capped to prevent token overflow)
  const maxHistoryTurns = 10;
  const recentHistory = history.slice(-maxHistoryTurns * 2);
  for (const msg of recentHistory) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: 'user', content: question });

  return messages;
}

// Backward-compatible export (returns system/user pair for testing)
export function buildRoadmapChatPrompt(roadmapModel, question) {
  const messages = buildRoadmapChatMessages(roadmapModel, question);
  const systemMsg = messages.find(m => m.role === 'system');
  const userMsg = messages.filter(m => m.role === 'user').pop();
  return { system: systemMsg?.content || '', user: userMsg?.content || '' };
}

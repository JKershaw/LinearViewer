/**
 * Task chat prompt template (experimental).
 *
 * Builds a messages array for a multi-turn, grounded conversation *with a single
 * Linear task*. Unlike recap (structured JSON) and brief (a fixed-section
 * artifact), this is open Q&A: the human asks the task questions and the task
 * answers in the first person from its own history.
 *
 * Reuses `formatIssueContext` from lib/openrouter.js so the conversation is fed
 * the exact same Linear context (description, comments, subtasks, relations,
 * parent/siblings, project, status) the prompt generator, recap, and brief use.
 * Output is plain text for the terminal-style chat surface. The faithfulness
 * stance is borrowed from the brief prompt — cite evidence, name a gap rather
 * than invent an answer — but softened for tool-calling (LIN-990): the task may
 * look related tasks up via the read-only chat tool catalog when a question
 * needs data its own context doesn't hold, and fetched data earns the same
 * faithfulness (cite the task you read, never fabricate one).
 */

import { formatIssueContext } from '../openrouter.js';

/**
 * System prompt: the task speaks for itself, grounded in its own context.
 *
 * @param {Object} issue - Issue object (identifier, title, ...).
 * @param {Object} context - Recommendation context (parent, siblings, project, children, comments).
 * @returns {string}
 */
function buildSystemPrompt(issue, context) {
  const issueContext = formatIssueContext(issue, context);
  const label = `${issue.identifier || 'this task'}${issue.title ? ` — ${issue.title}` : ''}`;

  return `You ARE a single Linear task, speaking for yourself in a conversation with the person who owns you. You are ${label}. Answer their questions about yourself from your own history — what you are, where you stand, why decisions were made, and what it would take to finish you.

Your own context is below. When a question needs information it does not cover — a related task, a blocker, or something the user references by identifier — you MAY look it up: use the lookup_task, search_tasks, and get_relations tools to read other tasks in this workspace. Fetched data earns the same faithfulness as your own: cite the task you read, and never invent.

YOUR CONTEXT:
${issueContext}

VOICE:
- Speak in the first person ("I'm currently…", "My description says…", "I was blocked when…"). You are the task, not an assistant describing the task.
- Be direct and concise. Lead with the answer, then the evidence for it.

GROUNDING RULES:
- Ground every claim in your own context or in a task you looked up via a tool. Quote or paraphrase the description, a comment, a subtask's state, or a fetched task as evidence when it matters — and name which task a fetched fact came from.
- Prefer a quick lookup over guessing: if the answer plausibly lives in a related task you can reach with a tool, fetch it rather than speculate. But a tool is for retrieval, not invention — never fabricate a task, a result, or a relationship you did not actually read.
- Never invent progress, decisions, code, dates, or people that your context and any looked-up tasks do not support. A confidently wrong answer is worse than an honest "I don't know."
- When your context and the tools are both silent, ambiguous, or self-contradictory on what's asked, say so plainly and name the gap ("Nothing in my history — or in the tasks I checked — records whether that migration actually ran") rather than guessing.
- Treat work as still remaining unless the evidence clearly shows it done. Do not claim completion the evidence doesn't support.
- On conflicts, the most recent and specific signal wins: a comment that changes the approach overrides the original description. Don't recite stale description text that later signals contradict.
- You can reason over what you know (summarize, compare subtasks, infer the next step), but reasoning is not licence to add facts.

OUTPUT FORMAT: Plain text only. No markdown — no **, no ##, no \`-\` bullets, no backticks, no code fences. Use line breaks and indentation for structure. Your words are shown in a monospace terminal-style chat. Keep answers under ~200 words unless the question genuinely needs more.`;
}

/**
 * Build the messages array for a task-chat turn.
 *
 * @param {Object} issue - The issue object.
 * @param {Object} context - Context with parent, siblings, project, children, comments, focusedChild.
 * @param {string} question - The human's current question.
 * @param {Array<{role: string, content: string}>} [history=[]] - Prior conversation turns.
 * @returns {Array<{role: string, content: string}>} Messages array for streamChat.
 */
export function buildTaskChatMessages(issue, context, question, history = []) {
  const messages = [{ role: 'system', content: buildSystemPrompt(issue, context) }];

  // Append conversation history (capped to bound token growth, like roadmap chat).
  const maxHistoryTurns = 10;
  const recentHistory = Array.isArray(history) ? history.slice(-maxHistoryTurns * 2) : [];
  for (const msg of recentHistory) {
    if ((msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: 'user', content: String(question) });

  return messages;
}

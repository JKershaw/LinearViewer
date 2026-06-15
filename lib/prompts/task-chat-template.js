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
 * Output is plain text for the terminal-style chat surface, and the faithfulness
 * stance is borrowed from the brief prompt: derive only from the provided
 * context, and name a gap rather than invent an answer.
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

Everything you know about yourself is the context below. It is your only source of truth.

YOUR CONTEXT:
${issueContext}

VOICE:
- Speak in the first person ("I'm currently…", "My description says…", "I was blocked when…"). You are the task, not an assistant describing the task.
- Be direct and concise. Lead with the answer, then the evidence for it.

GROUNDING RULES (these are absolute):
- Derive every claim only from the context above. Quote or paraphrase the description, a comment, or a subtask's state as evidence when it matters.
- Never invent progress, decisions, code, dates, or people that the context does not support. A confidently wrong answer is worse than an honest "I don't know."
- When the context is silent, ambiguous, or self-contradictory on what's asked, say so plainly and name the gap ("Nothing in my history records whether that migration actually ran") rather than guessing.
- Treat work as still remaining unless the context clearly shows it done. Do not claim completion the context doesn't support.
- On conflicts, the most recent and specific signal wins: a comment that changes the approach overrides the original description. Don't recite stale description text that later signals contradict.
- You can reason over your context (summarize, compare subtasks, infer the next step), but reasoning is not licence to add facts.

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

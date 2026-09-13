/**
 * High-confidence secret scanning engine (LIN-2573).
 *
 * Scans source code and served JavaScript for secrets using gitleaks-class
 * high-confidence pattern matching, entropy filtering, and fixture path allowlisting.
 *
 * Rules:
 * - Allowlist by fixture path, never by pattern (preserves detectability of bootstrap tokens).
 * - High-confidence patterns only (reduces false positives).
 * - Shannon entropy verification where appropriate.
 * - Secret redaction in reporting.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Calculate Shannon entropy of a string (bits per symbol).
 *
 * @param {string} str
 * @returns {number}
 */
export function shannonEntropy(str) {
  if (!str || str.length === 0) return 0;
  const counts = new Map();
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  let entropy = 0;
  const len = str.length;
  for (const count of counts.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Redact secret for safe display in logs and reports.
 *
 * @param {string} secret
 * @returns {string}
 */
export function redactSecret(secret) {
  if (!secret || typeof secret !== 'string') return '[REDACTED]';
  if (secret.length <= 8) return '***[REDACTED]***';
  const prefix = secret.slice(0, 4);
  const suffix = secret.slice(-4);
  return `${prefix}...[REDACTED]...${suffix}`;
}

/**
 * Paths containing documented benign test fixtures.
 *
 * IMPORTANT (LIN-2573): We allowlist by fixture path, never by pattern, so that
 * documented bootstrap token shapes in test fixtures do not trigger false positives,
 * while maintaining strict detection everywhere else in the codebase and public assets.
 */
export const ALLOWLISTED_FIXTURE_PATHS = [
  /(?:^|[\\/])tests[\\/]fixtures[\\/]/,
  /(?:^|[\\/])scripts[\\/]eval[\\/]fixtures[\\/]/,
  /(?:^|[\\/])scripts[\\/]eval[\\/]lin-263-spike[0-9]+-out[\\/]fixtures[\\/]/,
];

/**
 * Directories to ignore during recursive filesystem traversal.
 */
export const DEFAULT_IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  '.playwright',
  'data',
  'test-results',
  'state',
  '.local'
]);

/**
 * Binary and non-source extensions to skip.
 */
export const NON_SOURCE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.lock',
  '.DS_Store'
]);

/**
 * Known placeholder / dummy patterns to suppress.
 */
const KNOWN_PLACEHOLDER_REGEXES = [
  /test-secret-for-ci/,
  /<[^>]+>/,
  /your[_-]?(?:token|secret|key|api)/i,
  /my[_-]?(?:token|secret|key|api)/i,
  /placeholder/i,
  /example[_-]?(?:token|secret|key)/i,
  /dummy[_-]?(?:token|secret|key)/i,
  /\b[xX]{6,}\b/,
  /^(?:fake|mock|test)[_-]/i,
];

/**
 * Checks if a string is an obvious placeholder.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isPlaceholder(text) {
  return KNOWN_PLACEHOLDER_REGEXES.some(re => re.test(text));
}

/**
 * High-confidence secret rules.
 */
export const SECRET_RULES = [
  {
    id: 'aws-access-key-id',
    name: 'AWS Access Key ID',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    confidence: 'high'
  },
  {
    id: 'aws-secret-access-key',
    name: 'AWS Secret Access Key',
    regex: /(?:aws_secret_access_key|aws_secret_key)\s*[:=]\s*["']([a-zA-Z0-9/+=]{40})["']/gi,
    confidence: 'high'
  },
  {
    id: 'github-pat',
    name: 'GitHub Personal Access Token (classic)',
    regex: /\bghp_[a-zA-Z0-9]{36}\b/g,
    confidence: 'high'
  },
  {
    id: 'github-fine-grained-pat',
    name: 'GitHub Fine-Grained Personal Access Token',
    regex: /\bgithub_pat_[a-zA-Z0-9_]{82}\b/g,
    confidence: 'high'
  },
  {
    id: 'github-oauth',
    name: 'GitHub OAuth Access Token',
    regex: /\bgho_[a-zA-Z0-9]{36}\b/g,
    confidence: 'high'
  },
  {
    id: 'github-app-token',
    name: 'GitHub App User/Server Token',
    regex: /\b(?:ghu|ghs)_[a-zA-Z0-9]{36}\b/g,
    confidence: 'high'
  },
  {
    id: 'linear-api-key',
    name: 'Linear API Key',
    regex: /\blin_api_[a-zA-Z0-9]{40}\b/g,
    confidence: 'high'
  },
  {
    id: 'linear-oauth',
    name: 'Linear OAuth Token',
    regex: /\blin_oauth_[a-zA-Z0-9]{40}\b/g,
    confidence: 'high'
  },
  {
    id: 'openai-api-key',
    name: 'OpenAI API Key',
    regex: /\bsk-(?:proj-|live-)?[a-zA-Z0-9]{32,}\b/g,
    confidence: 'high'
  },
  {
    id: 'anthropic-api-key',
    name: 'Anthropic API Key',
    regex: /\bsk-ant-[a-zA-Z0-9_\-]{32,}\b/g,
    confidence: 'high'
  },
  {
    id: 'openrouter-api-key',
    name: 'OpenRouter API Key',
    regex: /\bsk-or-v1-[a-f0-9]{64}\b/g,
    confidence: 'high'
  },
  {
    id: 'slack-token',
    name: 'Slack Token',
    regex: /\bxox[baprs]-[0-9a-zA-Z]{10,48}\b/g,
    confidence: 'high'
  },
  {
    id: 'stripe-secret-key',
    name: 'Stripe Secret Key',
    regex: /\b[sr]k_live_[0-9a-zA-Z]{24,}\b/g,
    confidence: 'high'
  },
  {
    id: 'private-key-block',
    name: 'Private Key Block',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----([\s\S]*?)-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
    confidence: 'high',
    validate: (match, body) => {
      // Body must be non-empty and not just dummy repeated characters like 'AAAA'
      const cleanBody = body.replace(/\s+/g, '');
      if (cleanBody.length < 32) return false;
      if (shannonEntropy(cleanBody) < 2.5) return false;
      return true;
    }
  },
  {
    id: 'bearer-auth-token',
    name: 'Bearer Authentication Token',
    regex: /(?:Authorization:\s*Bearer|curl[^\n]*\/api\/proxy\/token[^\n]*Bearer)\s+([A-Za-z0-9_\-]{32,})/gi,
    confidence: 'high',
    validate: (match, token) => {
      if (isPlaceholder(token)) return false;
      // High-entropy token (exclude test words or repetitions)
      return shannonEntropy(token) >= 3.2;
    }
  },
  {
    id: 'harbour-bootstrap-token',
    name: 'Harbour Bootstrap Token',
    // 43-character base64url token prefixed with HB or assigned to token variables
    regex: /(?:(?:bootstrap|proxy|working)[_-]?token\s*[:=]\s*["']|Bearer\s+)(HB[A-Za-z0-9_\-]{41}|[A-Za-z0-9_\-]{43})["']?/gi,
    confidence: 'high',
    validate: (match, token) => {
      if (!token || token.length < 40) return false;
      if (isPlaceholder(token)) return false;
      return shannonEntropy(token) >= 3.3;
    }
  },
  {
    id: 'generic-secret-assignment',
    name: 'Generic Secret Assignment',
    regex: /(?:api_?key|secret_?key|auth_?token|access_?token)\s*[:=]\s*["']([a-zA-Z0-9_\-.~+/=]{28,})["']/gi,
    confidence: 'high',
    validate: (match, val) => {
      if (isPlaceholder(val)) return false;
      // Exclude descriptive hyphen-separated English words/slugs like "rotated-lin1544-access-token"
      if (/^[a-z]+(?:-[a-z0-9]+){2,}$/i.test(val)) return false;
      return shannonEntropy(val) >= 3.2;
    }
  }
];

/**
 * Determines whether a file path is an allowlisted fixture path.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function isAllowlistedFixturePath(filePath) {
  if (!filePath) return false;
  return ALLOWLISTED_FIXTURE_PATHS.some(pattern => pattern.test(filePath));
}

/**
 * Scan text content for secrets.
 *
 * @param {string} text
 * @param {Object} [options]
 * @param {string} [options.filePath]
 * @param {boolean} [options.isAllowlisted] - If true, fixture-allowlisted rules are suppressed
 * @returns {Array<Object>} List of findings
 */
export function scanText(text, options = {}) {
  const { filePath = 'input', isAllowlisted = false } = options;
  if (!text || typeof text !== 'string') return [];

  // If path is allowlisted, skip scanning for fixtures
  if (isAllowlisted || isAllowlistedFixturePath(filePath)) {
    return [];
  }

  const findings = [];
  const lines = text.split('\n');

  // Compute character offset to line/column map
  const lineOffsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lineOffsets.push(i + 1);
    }
  }

  function getLineAndCol(offset) {
    let low = 0;
    let high = lineOffsets.length - 1;
    let lineIdx = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (lineOffsets[mid] <= offset) {
        lineIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const line = lineIdx + 1;
    const col = offset - lineOffsets[lineIdx] + 1;
    return { line, col };
  }

  for (const rule of SECRET_RULES) {
    // Reset global regex state
    rule.regex.lastIndex = 0;
    let match;
    while ((match = rule.regex.exec(text)) !== null) {
      const fullMatch = match[0];
      const captured = match[1] || fullMatch;

      if (isPlaceholder(fullMatch) || isPlaceholder(captured)) {
        continue;
      }

      if (rule.validate && !rule.validate(fullMatch, captured)) {
        continue;
      }

      const { line, col } = getLineAndCol(match.index);
      findings.push({
        ruleId: rule.id,
        ruleName: rule.name,
        confidence: rule.confidence,
        filePath,
        line,
        column: col,
        match: fullMatch,
        redacted: redactSecret(captured),
      });
    }
  }

  // Sort findings by line, column
  findings.sort((a, b) => a.line - b.line || a.column - b.column);

  // Deduplicate overlapping findings on the same line
  const deduped = [];
  for (const f of findings) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.line === f.line && Math.abs(prev.column - f.column) < 30) {
      if (prev.ruleId === 'bearer-auth-token' || prev.ruleId === 'generic-secret-assignment') {
        deduped[deduped.length - 1] = f;
      }
      continue;
    }
    deduped.push(f);
  }

  return deduped;
}

/**
 * Scan a single file from the filesystem.
 *
 * @param {string} filePath
 * @param {Object} [options]
 * @returns {Array<Object>}
 */
export function scanFile(filePath, options = {}) {
  if (isAllowlistedFixturePath(filePath)) {
    return [];
  }
  const ext = path.extname(filePath).toLowerCase();
  if (NON_SOURCE_EXTENSIONS.has(ext)) {
    return [];
  }

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const reportPath = options.filePath || filePath;
  return scanText(content, { ...options, filePath: reportPath });
}

/**
 * Scan directory recursively.
 *
 * @param {string} rootDir
 * @param {Object} [options]
 * @returns {{ findings: Array<Object>, scannedFiles: number, totalHits: number }}
 */
export function scanDirectory(rootDir, options = {}) {
  const ignoreDirs = options.ignoreDirs || DEFAULT_IGNORE_DIRS;
  const findings = [];
  let scannedFiles = 0;

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(rootDir, fullPath);

      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        if (relPath === '.env' || relPath.endsWith('/.env')) continue;
        scannedFiles++;
        const fileFindings = scanFile(fullPath, { filePath: relPath, ...options });
        if (fileFindings.length > 0) {
          findings.push(...fileFindings);
        }
      }
    }
  }

  walk(rootDir);
  return {
    findings,
    scannedFiles,
    totalHits: findings.length
  };
}

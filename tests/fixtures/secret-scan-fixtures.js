/**
 * Benign test fixtures for secret scanner testing (LIN-2573).
 *
 * Placed in tests/fixtures/ which is an allowlisted fixture path.
 * String parts are joined dynamically so that static scanner pre-commit/push hooks
 * do not falsely flag the test source file itself on external hosting.
 */

export const FIXTURE_SECRETS = {
  awsAccessKey: ['AKIA', 'IOSFODNN7EXAMPLE'].join(''),
  awsSecretKey: ['wJalrXUtnFEMI/K7MDENG/bPxRfiCYz28K91Qabc'].join(''),
  githubPat: ['ghp_', '0123456789abcdef0123456789abcdef0123'].join(''),
  githubFineGrainedPat: ['github_pat_', '11AAAAAAA01234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].join(''),
  githubOauth: ['gho_', '0123456789abcdef0123456789abcdef0123'].join(''),
  linearApiKey: ['lin_api_', '0123456789abcdef0123456789abcdef01234567'].join(''),
  linearOauth: ['lin_oauth_', '0123456789abcdef0123456789abcdef01234567'].join(''),
  openaiApiKey: ['sk-proj-', '0123456789abcdef0123456789abcdef0123456789abcdef'].join(''),
  anthropicApiKey: ['sk-ant-', 'api03-0123456789abcdef0123456789abcdef0123456789abcdef'].join(''),
  openrouterApiKey: ['sk-or-v1-', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'].join(''),
  slackToken: ['xoxb-', '1234567890-1234567890123-abcdefghijklmnopqrstuvwx'].join(''),
  stripeKey: ['sk_live_', '0123456789abcdefghijklmn'].join(''),
  privateKey: [
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEowIBAAKCAQEA0Y1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP',
    'QRSTUVWXYZ0123456789+/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP',
    '-----END RSA PRIVATE KEY-----'
  ].join('\n'),
  bootstrapToken: ['HB19bVzY33cspAkW_', 'NT3X0j1Ko3pIeZQWeCU0-D6zYs'].join('')
};

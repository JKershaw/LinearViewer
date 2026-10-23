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
  githubAppToken: ['ghs_', '0123456789abcdef0123456789abcdef0123'].join(''),
  bearerToken: ['aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3', 'xYz0aB3dE5'].join(''),
  genericSecretValue: ['Zx9Qm4Tk7Wp2Rv8Bn5Cd3Fg6Hj1Ls0Yu'].join(''),
  secondAwsAccessKey: ['AKIA', 'JQWERTYUIOPASDFG'].join(''),
  bootstrapToken: ['HB', 'FIXTURE-not-a-real-token-x9Q4mZ7kT2pW3vR8'].join(''),
  // LIN-3780: Railway-incident secret types.
  resendApiKey: ['re_', 'Xk3mP9qR', '_', 'T7vW2yZ4bD6fH8jK0nM1pQ3s'].join(''),
  resendBareKey: ['re_', 'Xk3mP9qRT7vW2yZ4bD6fH8jK0nM1pQ3s'].join(''),
  atlassianApiToken: ['ATATT3', 'xFfGF0aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3xYz0aB3dE5gH7jK9mN1pQ3sT5=A1B2C3D4'].join(''),
  atlassianOauthSecret: ['ATOA', 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3xYz0'].join(''),
  mongodbUri: ['mongodb+srv://', 'appuser', ':', 'Zx9Qm4Tk7Wp2Rv8Bn5', '@cluster0.example.net/app'].join(''),
  githubClientSecret: ['github_client_secret = "', '0123456789abcdef0123456789abcdef01234567', '"'].join(''),
  linearClientSecret: ['LINEAR_CLIENT_SECRET: "', 'Zx9Qm4Tk7Wp2Rv8Bn5Cd3Fg6Hj1Ls0Yu', '"'].join(''),
  githubRefreshToken: ['ghr_', '0123456789abcdef0123456789abcdef0123'].join(''),
  encryptedPrivateKey: [
    '-----BEGIN ENCRYPTED PRIVATE KEY-----',
    'MIIEowIBAAKCAQEA0Y1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP',
    'QRSTUVWXYZ0123456789+/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP',
    '-----END ENCRYPTED PRIVATE KEY-----'
  ].join('\n'),
  truncatedPrivateKey: [
    '-----BEGIN RSA PRIVATE KEY-----',
    'Proc-Type: 4,ENCRYPTED',
    'DEK-Info: AES-128-CBC,0123456789ABCDEF0123456789ABCDEF',
    '',
    'MIIEowIBAAKCAQEA0Y1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP',
    'QRSTUVWXYZ0123456789+/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP'
  ].join('\n'),
  envStyleSecret: ['SERVICE_API_KEY=', 'aB3dE5gH7jK9mN1pQ3sT'].join('')
};

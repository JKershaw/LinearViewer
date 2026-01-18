# Linear Projects Viewer - Code Review Guidelines

Review this pull request for issues in the following areas. Focus on **changed code only** and provide specific, actionable feedback. Refer to CLAUDE.md for detailed project conventions.

## Severity Levels

- **Blocker**: Security vulnerabilities, data loss risks, broken functionality - must fix before merge
- **Warning**: Missing validation, error handling gaps, test coverage - should fix
- **Suggestion**: Style inconsistencies, minor improvements - optional

## Code Style

Verify adherence to project conventions:

- **ES Modules**: Use `import`/`export` only, no CommonJS `require()`
- **Formatting**: 2-space indentation, single quotes, semicolons required
- **Naming**: camelCase for functions/variables, UPPER_SNAKE_CASE for constants, PascalCase for classes
- **Documentation**: Exported functions should have JSDoc comments with `@param`, `@returns`, `@throws`

## Security (Blockers)

Check for security vulnerabilities:

- **Input Validation**: All route parameters and query strings must be validated before use
  - IDs should be validated against expected formats (e.g., UUID regex)
  - Bad: Using `req.params.id` directly without validation
  - Good: Validate format first, return 400 on invalid input
- **XSS Prevention**: User-generated content must be HTML-escaped before rendering
- **CSRF Protection**: State-changing operations use POST, OAuth flows validate state parameter
- **No Sensitive Data Logging**: Never log tokens, API keys, or credentials
- **Session Security**: Session modifications should be properly persisted

## Error Handling

Ensure proper error handling patterns:

- All async route handlers wrapped in try-catch
- Use existing error response helpers (check codebase for patterns)
- Return appropriate HTTP status codes (400, 401, 404, 500, 503)
- Log errors with context before returning error responses
- Handle API auth failures gracefully (token refresh or session cleanup)

## Architecture Patterns

Verify consistency with existing patterns in the codebase:

- **Routes**: Follow the existing pattern for route organization
- **Authentication**: Check for valid session/workspace before processing requests
- **Database**: Use async/await consistently

## Test Coverage

For new features or bug fixes:

- E2E tests should be added using Playwright
- Cover both positive and negative cases (valid input, invalid input, auth failures)
- Follow existing test patterns in the codebase

## What NOT to Flag

- Minor style preferences not listed above
- Suggestions for "nice to have" improvements
- Code that follows existing patterns in the codebase
- Test files using mock data appropriately

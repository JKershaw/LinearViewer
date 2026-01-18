# Linear Projects Viewer - Code Review Guidelines

Review this pull request for issues in the following areas. Focus on **changed code only** and provide specific, actionable feedback.

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

- **Input Validation**: All route parameters and query strings must be validated
  - UUIDs must pass `UUID_REGEX.test()` from `lib/workspace.js`
  - Bad: `const id = req.params.id` then use directly
  - Good: `if (!UUID_REGEX.test(id)) return badRequest.json(res, 'Invalid ID')`
- **XSS Prevention**: User-generated content must be escaped with `escapeHtml()` before HTML rendering
- **CSRF Protection**: State-changing operations use POST, OAuth flows validate state parameter
- **No Sensitive Data Logging**: Never log tokens, API keys, or credentials
- **Session Security**: Use `saveSession()` wrapper for session modifications

## Error Handling

Ensure proper error handling patterns:

- All async functions wrapped in try-catch
- Use error helpers from `lib/errors.js`: `badRequest`, `unauthorized`, `notFound`, `serverError`
- Return appropriate HTTP status codes (400, 401, 404, 500, 503)
- Log errors with context: `console.error('Context:', error)`
- Handle 401 from Linear API by attempting token refresh or removing workspace

## Architecture Patterns

Verify consistency with existing patterns:

- **Routes**: Factory functions returning Express routers (`export function createXRoutes()`)
- **Workspace Access**: Always check `getActiveWorkspace(req.session)` and return 401 if null
- **Token Refresh**: Use middleware pattern, check expiry with 5-minute buffer
- **Database**: Use async/await with MongoDB/MangoDB client

## Test Coverage

For new features or bug fixes:

- E2E tests should be added in `tests/e2e/` using Playwright
- Test mode support via `/test/set-session` endpoint for bypassing OAuth
- Cover both positive and negative cases (valid input, invalid input, auth failures)

## What NOT to Flag

- Minor style preferences not listed above
- Suggestions for "nice to have" improvements
- Code that follows existing patterns in the codebase
- Test files using mock data appropriately

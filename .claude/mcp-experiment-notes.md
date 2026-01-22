# MCP Server Experiment Notes

## Goal
Test whether Linear's official HTTP MCP server works in Claude Code on the Web.

## What We Did
Added `.mcp.json` at project root with Linear's hosted MCP server:
```json
{
  "mcpServers": {
    "linear": {
      "type": "http",
      "url": "https://mcp.linear.app/mcp",
      "headers": {
        "Authorization": "Bearer ${LINEAR_API_KEY}"
      }
    }
  }
}
```

## Why HTTP Transport
- Claude Code Web runs in a sandboxed environment
- Stdio MCP servers require local process spawning (problematic in sandbox)
- HTTP transport goes through the sandbox's network proxy (should work)
- Linear provides an official hosted MCP server at `https://mcp.linear.app/mcp`

## To Test
1. Start a new Claude Code Web session on this branch
2. Run `/mcp` to check connection status
3. Try using Linear tools (e.g., search issues, get issue details)

## If It Works
- We can remove `lib/linear-cli.js` (the fallback CLI)
- MCP provides a cleaner integration with Claude

## If It Doesn't Work
Possible issues:
- Sandbox proxy blocking the connection
- OAuth flow required instead of API key
- Environment variable not available at MCP load time

Fallback options:
1. Keep the CLI as-is
2. Try OAuth authentication via `/mcp` command
3. Host our own HTTP MCP server externally

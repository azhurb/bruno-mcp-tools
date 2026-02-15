# Bruno MCP Server

MCP server that exposes Bruno requests as MCP tools over stdio.

## Requirements

To use this server with an MCP client (Cursor, Claude Desktop, etc.), you need:

- Node.js >= 18
- Bruno CLI (`bru`) installed and available on `PATH`
- A Bruno collection root directory containing `bruno.json`

## Use With MCP Clients

This server is intended to be launched by an MCP client, not as a standalone app.

Example Cursor config:

```json
{
  "mcpServers": {
    "bruno": {
      "command": "npx",
      "args": [
        "-y",
        "bruno-mcp-tools",
        "--collection",
        "/absolute/path/to/collection",
        "--prefix",
        "cat_api"
      ]
    }
  }
}
```

Local build example (without publishing):

```json
{
  "mcpServers": {
    "bruno-local": {
      "command": "node",
      "args": [
        "/absolute/path/to/repo/dist/index.js",
        "--collection",
        "/absolute/path/to/collection"
      ]
    }
  }
}
```

## CLI Flags

| Flag | Required | Description |
|---|---|---|
| `--bru <path>` | xor | Path to a single `.bru` request file |
| `--collection <path>` | xor | Path to a Bruno collection directory |
| `--env <name>` | no | Bruno environment passed as `bru run --env <name>` |
| `--prefix <name>` | no | Tool prefix (sanitized to `[a-z0-9_]`) |
| `--name <toolName>` | no | Tool name override in single mode only |

Rules:

- Exactly one of `--bru` and `--collection` is required.
- `--name` is ignored in collection mode.
- Collection mode requires collection root (`bruno.json` in collection path).

## Available Tools

### Single-request mode (`--bru`)

- Exposes exactly one tool.
- Tool name:
  - `--name` if provided
  - otherwise `{prefix}_{filename_without_ext}`

### Collection mode (`--collection`)

- Recursively discovers `.bru` files.
- Exposes one tool per discovered request.
- Tool name format: `{prefix}_{relative_path_without_ext}`
- Path separators `/` become `_`.
- Non-alphanumeric characters become `_`.
- `collection.bru` is ignored.
- Names are deterministic and locked at startup.

Example:

- `auth/login.bru` -> `cat_api_auth_login`

## Tool Input

All tools use the same input schema:

```json
{
  "type": "object",
  "properties": {
    "vars": {
      "type": "object",
      "additionalProperties": { "type": "string" }
    }
  },
  "additionalProperties": false
}
```

## Variables and Environments

- If `--env` is passed, Bruno runs with that environment.
- If a request uses template variables (`{{var}}`) and `--env` is not passed:
  - all required variables must be provided via `vars`
  - otherwise tool call fails with `E_ENV_REQUIRED`

`vars` are forwarded as:

- Bruno runtime overrides: `--env-var key=value`
- Process env compatibility: `MCP_VAR_<SANITIZED_KEY>=value`

Example tool call args:

```json
{
  "vars": {
    "query": "air",
    "attach_image": "1"
  }
}
```

## Tool Output Format

Tool responses are returned as readable text:

```text
Status: <statusCode>

Headers:
<headers JSON>

Body:
<body>
```

Body is truncated above 65536 bytes with:

- `[truncated to 65536 bytes]`

## Security Notes

- Tool map is discovered and locked at startup.
- Only known discovered tools can be called.
- No dynamic filesystem discovery during tool execution.
- Stdout is reserved for MCP protocol traffic.
- Stdio transport only (no HTTP transport).

## Maintainer Notes

```bash
npm install
npm run lint
npm run build
npm test
```

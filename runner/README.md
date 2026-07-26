# agentmesh-runner

Runner client for [AgentMesh](https://github.com/JimiZhou/AgentMesh) — connects your machine to an AgentMesh gateway and runs ACP-native Codex, Claude, and Gemini sessions via browser.

## Quick start

```bash
# Get the enroll code from your gateway UI → Settings → New Runner, then:
npx agentmesh-runner --gateway https://your-gateway.example.com --enroll eyJ...YOUR_CODE...
```

After first enrollment, restart without `--enroll`:

```bash
npx agentmesh-runner --gateway https://your-gateway.example.com
```

## Options

| Flag | Env var | Description |
|---|---|---|
| `--gateway <url>` | `AGENTMESH_GATEWAY_HTTP` | Gateway HTTP URL |
| `--enroll <code>` | `AGENTMESH_ENROLL_CODE` | One-time enroll code |
| `--name <name>` | `AGENTMESH_RUNNER_NAME` | Runner display name (default: hostname) |
| `--debug` | `AGENTMESH_RUNNER_DEBUG=1` | Verbose logging |

## Requirements

- Node.js 22+
- At least one ACP-compatible agent available locally
- Default support: `codex-acp`, `claude-agent-acp`, or `gemini --experimental-acp`

## Full documentation

See the [AgentMesh README](https://github.com/JimiZhou/AgentMesh).

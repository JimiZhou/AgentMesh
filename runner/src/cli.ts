#!/usr/bin/env node
/**
 * agentmesh-runner CLI
 *
 * Usage:
 *   agentmesh-runner --gateway https://your-gateway.example.com --enroll <enroll-code>
 *   npx agentmesh-runner --gateway https://your-gateway.example.com --enroll <enroll-code>
 *
 * All flags can also be set via environment variables:
 *   AGENTMESH_GATEWAY_HTTP   Gateway HTTP URL (also derives the WS URL)
 *   AGENTMESH_ENROLL_CODE    One-time enroll code issued by the gateway
 *   AGENTMESH_RUNNER_NAME    Display name for this runner (defaults to hostname)
 */

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--gateway' && argv[i + 1]) {
      out['gateway'] = argv[++i];
    } else if (arg === '--enroll' && argv[i + 1]) {
      out['enroll'] = argv[++i];
    } else if (arg === '--name' && argv[i + 1]) {
      out['name'] = argv[++i];
    } else if (arg === '--debug') {
      out['debug'] = '1';
    } else if (arg === '--help' || arg === '-h') {
      out['help'] = '1';
    }
  }
  return out;
}

function printHelp() {
  console.log(`
agentmesh-runner — connect this machine as a runner to an AgentMesh gateway

Usage:
  agentmesh-runner [options]

Options:
  --gateway <url>    Gateway HTTP URL  (env: AGENTMESH_GATEWAY_HTTP)
  --enroll  <code>   One-time enroll code from the gateway UI  (env: AGENTMESH_ENROLL_CODE)
  --name    <name>   Runner display name  (env: AGENTMESH_RUNNER_NAME, default: hostname)
  --debug            Enable verbose debug logging
  --help, -h         Show this help message

Examples:
  # First-time enrollment (get the enroll code from Gateway → Settings → New Runner)
  agentmesh-runner --gateway https://gateway.example.com --enroll eyJ...

  # Re-use saved identity (already enrolled)
  agentmesh-runner --gateway https://gateway.example.com

  # Via environment variables
  AGENTMESH_GATEWAY_HTTP=https://gateway.example.com \\
  AGENTMESH_ENROLL_CODE=eyJ... \\
  agentmesh-runner
`);
}

const args = parseArgs(process.argv.slice(2));

if (args['help']) {
  printHelp();
  process.exit(0);
}

// Propagate CLI flags into env vars before index.ts reads them
if (args['gateway']) {
  process.env['AGENTMESH_GATEWAY_HTTP'] = args['gateway'];
}
if (args['enroll']) {
  process.env['AGENTMESH_ENROLL_CODE'] = args['enroll'];
}
if (args['name']) {
  process.env['AGENTMESH_RUNNER_NAME'] = args['name'];
}
if (args['debug']) {
  process.env['AGENTMESH_RUNNER_DEBUG'] = '1';
}

const gatewayHttp = process.env['AGENTMESH_GATEWAY_HTTP'] || 'http://127.0.0.1:8787';
const hasEnroll = !!process.env['AGENTMESH_ENROLL_CODE'];

console.log('');
console.log('  AgentMesh Runner');
console.log('  ────────────────────────────────────');
console.log(`  Gateway : ${gatewayHttp}`);
if (hasEnroll) {
  console.log('  Enroll  : [code provided – will enroll on first connect]');
}
console.log('');

// Dynamic import ensures env vars are set before the module initialises its
// module-level constants (gatewayHttp, ENROLL_CODE, etc.)
export {};
await import('./index.js');

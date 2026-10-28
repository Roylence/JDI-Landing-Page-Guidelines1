import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
export async function validateSnapshot(path) {
  const client = new Client({ name: 'snapshot-validator', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
      env: { ...process.env, DESIGN_SYSTEM_DATA_FILE: path }, stderr: 'inherit' }));
    const result = await client.callTool({ name: 'get_design_tokens', arguments: {} });
    if (result.isError) throw new Error(JSON.stringify(result.content));
  } finally { await client.close(); }
}

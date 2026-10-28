import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const original = await readFile(new URL('../data/design-system.json', import.meta.url), 'utf8');
async function session(run) {
  const directory = await mkdtemp(join(tmpdir(), 'design-system-mcp-'));
  const database = join(directory, 'design-system.json');
  await writeFile(database, original);
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
      // Deliberately launch outside the project to check data path independence.
      cwd: directory, env: { ...process.env, DESIGN_SYSTEM_DATA_FILE: database }, stderr: 'inherit' }));
    await run(client, database);
  } finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
}
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, JSON.stringify(result.content));
  return result.structuredContent;
}
test('stdio: exposes exactly three tools; searches category/keyword and paginates', async () => session(async client => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['get_asset_structure', 'get_design_tokens', 'search_assets']);
  const all = await call(client, 'search_assets', { limit: 50 });
  assert.equal(all.total, 24);
  const heroes = await call(client, 'search_assets', { category: 'hero', keyword: 'Banner', limit: 1 });
  assert.equal(heroes.total, 3);
  assert.equal(heroes.assets.length, 1);
  assert.equal(heroes.nextOffset, 1);
  const next = await call(client, 'search_assets', { category: 'hero', offset: 1, limit: 1 });
  assert.notEqual(next.assets[0].id, heroes.assets[0].id);
  assert.equal((await call(client, 'search_assets', { keyword: '不存在的资产' })).total, 0);
}));
test('semantic trees contain source text and token references, with no absolute coordinates', async () => session(async client => {
  const { assets } = await call(client, 'search_assets', { limit: 50 });
  const tokens = await call(client, 'get_design_tokens');
  for (const asset of assets) {
    const result = await call(client, 'get_asset_structure', { asset_id: asset.id });
    assert.equal(result.revision, tokens.revision);
    let textCount = 0;
    function visit(node) {
      for (const key of ['x', 'y', 'top', 'left', 'absoluteBoundingBox', 'absoluteTransform']) assert.ok(!(key in node));
      if (node.text) textCount++;
      for (const ref of Object.values(node.tokenRefs ?? {})) assert.ok(ref in tokens.tokens);
      node.children?.forEach(visit);
    }
    visit(result.asset.structure);
    assert.ok(textCount > 0);
  }
}));
test('tokens resolve aliases/units; a file update changes results without restarting server', async () => session(async (client, database) => {
  const before = await call(client, 'get_design_tokens');
  assert.equal(before.resolvedTokens['color/brand/default'], '#E2211C');
  assert.equal(before.cssVariables['--space-16'], '16px');
  assert.equal(Object.values(before.tokens).filter(token => token.origin === 'zero').length, 69);
  const data = JSON.parse(original);
  data.tokens['red/600'].$value = '#AA1122';
  await writeFile(database, JSON.stringify(data));
  const after = await call(client, 'get_design_tokens', { prefix: 'color/brand/' });
  assert.equal(after.resolvedTokens['color/brand/default'], '#AA1122');
  assert.notEqual(before.revision, after.revision);
  assert.ok(Object.keys(after.tokens).every(name => name.startsWith('color/brand/')));
}));
test('invalid IDs/inputs, alias cycles, malformed files and coordinate leakage fail closed', async () => session(async (client, database) => {
  assert.equal((await client.callTool({ name: 'get_asset_structure', arguments: { asset_id: '../../secret' } })).isError, true);
  assert.equal((await client.callTool({ name: 'search_assets', arguments: { limit: 0 } })).isError, true);
  const cycle = JSON.parse(original);
  cycle.tokens['red/600'].$value = { ref: 'color/brand/default' };
  await writeFile(database, JSON.stringify(cycle));
  assert.equal((await client.callTool({ name: 'get_design_tokens', arguments: {} })).isError, true);
  const unknown = JSON.parse(original);
  unknown.assets[0].structure.tokenRefs.background = 'made-up/color';
  await writeFile(database, JSON.stringify(unknown));
  assert.equal((await client.callTool({ name: 'get_asset_structure', arguments: { asset_id: unknown.assets[0].id } })).isError, true);
  const coordinates = JSON.parse(original);
  coordinates.assets[0].structure.x = 120;
  await writeFile(database, JSON.stringify(coordinates));
  assert.equal((await client.callTool({ name: 'search_assets', arguments: {} })).isError, true);
  await writeFile(database, '{broken');
  assert.equal((await client.callTool({ name: 'get_design_tokens', arguments: {} })).isError, true);
  await writeFile(database, original);
  assert.equal((await call(client, 'search_assets', { limit: 1 })).total, 24);
}));
test('requested Skill path and Cursor discovery entry stay identical', async () => {
  const requested = await readFile(new URL('../.cursor/skills/design-system-assembler.md', import.meta.url), 'utf8');
  const discovered = await readFile(new URL('../.cursor/skills/design-system-assembler/SKILL.md', import.meta.url), 'utf8');
  assert.equal(requested, discovered);
});

test('default snapshot resolves when client launches from a different directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'design-system-default-'));
  const client = new Client({ name: 'default-path-test', version: '1.0.0' });
  const environment = { ...process.env };
  delete environment.DESIGN_SYSTEM_DATA_FILE;
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
      cwd: directory, env: environment, stderr: 'inherit' }));
    assert.equal((await call(client, 'search_assets')).total, 24);
  } finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
});

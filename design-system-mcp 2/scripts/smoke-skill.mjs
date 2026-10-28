import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root = new URL('../', import.meta.url);
const expected = await readFile(new URL('.cursor/skills/design-system-assembler/SKILL.md', root), 'utf8');
const installed = [];
for (const host of ['.codex', '.cursor']) {
  const path = join(homedir(), host, 'skills/design-system-assembler/SKILL.md');
  const skill = await readFile(path, 'utf8');
  assert.equal(skill, expected, `${host} Skill differs from project source`);
  installed.push({ host, path, sha256: createHash('sha256').update(skill).digest('hex') });
}
for (const heading of ['行为铁律', '业务编排与叙事流', '防御性设计与极值规则', '标准执行 SOP']) {
  assert.ok(expected.includes(heading));
}
const cursor = JSON.parse(await readFile(join(homedir(), '.cursor/mcp.json'), 'utf8'));
const configuration = cursor.mcpServers['design-system'];
assert.ok(configuration?.command && configuration?.args?.length);
const client = new Client({ name: 'installed-skill-mcp-smoke', version: '1.0.0' });
const trace = [];
let revision;
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, JSON.stringify(result.content));
  const data = result.structuredContent;
  assert.ok(data?.revision);
  if (revision) assert.equal(data.revision, revision, 'Snapshot changed during assembly');
  revision = data.revision;
  trace.push({ tool: name, arguments: args, revision });
  return data;
}
try {
  await client.connect(new StdioClientTransport({ command: configuration.command, args: configuration.args, stderr: 'inherit' }));
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 3);
  // Follow the installed Skill's observable four-step SOP using real MCP calls.
  const tokens = await call('get_design_tokens');
  const templates = await call('search_assets', { category: 'templates', keyword: 'ai-developer' });
  assert.equal(templates.total, 1);
  const template = await call('get_asset_structure', { asset_id: templates.assets[0].id });
  const categories = template.asset.structure.children.map(node => node.role);
  const modules = [];
  for (const category of categories) {
    const results = await call('search_assets', { category, limit: 50 });
    assert.ok(results.assets.length);
    assert.equal(results.nextOffset, null);
    const expectedNode = template.asset.structure.children.find(node => node.role === category).id;
    const chosen = results.assets.find(asset => asset.sourceNodeIds.includes(expectedNode));
    assert.ok(chosen, `No sourced module for ${category}`);
    const { asset } = await call('get_asset_structure', { asset_id: chosen.id });
    const referencedTokens = new Set();
    function inspect(node) {
      assert.ok(!('x' in node) && !('y' in node));
      for (const reference of Object.values(node.tokenRefs ?? {})) referencedTokens.add(reference);
      for (const [key, reference] of Object.entries(node.layout ?? {})) if (key.endsWith('Token')) referencedTokens.add(reference);
      node.children?.forEach(inspect);
    }
    inspect(asset.structure);
    for (const reference of referencedTokens) assert.ok(Object.hasOwn(tokens.tokens, reference), `Missing token ${reference}`);
    modules.push({ id: asset.id, name: asset.name, category, sourceNodeIds: asset.sourceNodeIds,
      tokenReferences: [...referencedTokens],
      defensiveDesign: { headline: 'wrap', subtitle: 'token line clamp with accessible tooltip',
        mobileColumnsToken: 'columns/one', dataStates: ['skeleton', 'success', 'empty', 'error-retry'] } });
  }
  assert.equal(tokens.resolvedTokens['columns/one'], 1);
  assert.equal(tokens.resolvedTokens['color/brand/default'], '#E2211C');
  const report = { status: 'passed', testedAt: new Date().toISOString(),
    scope: 'Installed-file integrity, configured MCP stdio connection, and explicit application of Skill SOP. Host auto-discovery on a new turn is not asserted.',
    installed, scenario: 'ai-developer', intent: '验证 AI 开发者工具落地页的资产选择、Token 对齐与防御设计计划；不生成业务页面',
    revision, source: tokens.source, template: template.asset.id, modules,
    theme: { brand: tokens.resolvedTokens['color/brand/default'], mobile: tokens.resolvedTokens['breakpoint/mobile'], tablet: tokens.resolvedTokens['breakpoint/tablet'] },
    tokenCount: Object.keys(tokens.tokens).length, toolCalls: trace.length, trace };
  await mkdir(new URL('verification/', root), { recursive: true });
  await writeFile(new URL('verification/skill-mcp-smoke.json', root), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, tools: tools.tools.map(tool => tool.name), tokenCount: report.tokenCount,
    selectedModules: modules.length, toolCalls: trace.length, report: 'verification/skill-mcp-smoke.json' }));
} finally { await client.close(); }

import { execFileSync } from 'node:child_process';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const root = new URL('../', import.meta.url);
const destination = new URL('data/design-system.json', root);
const designId = '2115284788339286017';
function zero(args) {
  return execFileSync('zero', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000 });
}
let input;
if (process.argv[2] === '--import') {
  if (!process.argv[3]) throw new Error('Usage: npm run import:zero -- /absolute/path/export.json');
  input = await readFile(process.argv[3], 'utf8');
} else {
  // Read the official prerequisites before running this reviewed, read-only script.
  zero(['docs', 'show', 'design/SKILL.md']);
  zero(['docs', 'show', 'design/references/relay-plugin-api-index.md']);
  zero(['docs', 'show', 'design/references/gotchas.md']);
  zero(['docs', 'show', 'design/references/working-with-design-systems/design-system-guide.md']);
  input = zero(['--json', 'design', 'script', '--designId', designId,
    '--file', fileURLToPath(new URL('scripts/export-zero.js', root)),
    '--description', '只读导出模块文本和设计变量，不修改设计稿', '--yes']);
}
function unwrap(raw) {
  if (raw?.variables && raw?.sections) return raw;
  if (raw?.isError) throw new Error(JSON.stringify(raw));
  if (raw?.structuredContent) return unwrap(raw.structuredContent);
  for (const block of raw?.content ?? []) {
    if (block.type !== 'text') continue;
    try { return unwrap(JSON.parse(block.text)); } catch { /* Try the next JSON text block. */ }
  }
  throw new Error('ZERO export has no variables/sections payload');
}
const source = unwrap(JSON.parse(input));
if (!source.variables.length || !source.sections.length) throw new Error('Empty ZERO export; snapshot retained');
const byId = new Map(source.variables.map(v => [v.id, v]));
const collections = new Map(source.collections.map(c => [c.id, c]));
const tokens = {};
const typeMap = { COLOR: 'color', FLOAT: 'dimension', STRING: 'string', BOOLEAN: 'boolean' };
for (const variable of source.variables) {
  const collection = collections.get(variable.variableCollectionId);
  if (!collection) throw new Error(`Missing collection: ${variable.name}`);
  if (collection.modes.length !== 1) throw new Error('Multiple modes require an explicit mode mapping; snapshot retained');
  let value = variable.valuesByMode[collection.defaultModeId];
  if (value === undefined) throw new Error(`Missing default value: ${variable.name}`);
  if (value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS') {
    const target = byId.get(value.id);
    if (!target) throw new Error(`Missing alias target: ${variable.name}`);
    value = { ref: target.name };
  } else if (variable.resolvedType === 'COLOR') {
    const channel = n => Math.round(n * 255).toString(16).padStart(2, '0');
    value = `#${channel(value.r)}${channel(value.g)}${channel(value.b)}${value.a < 1 ? channel(value.a) : ''}`.toUpperCase();
  }
  if (!typeMap[variable.resolvedType] || Object.hasOwn(tokens, variable.name)) throw new Error(`Unsupported/duplicate token: ${variable.name}`);
  if (variable.resolvedType === 'FLOAT' && !/^(space|radius|size|type|border)\//.test(variable.name)) {
    throw new Error(`New numeric token needs an explicit unit mapping: ${variable.name}`);
  }
  tokens[variable.name] = { $type: typeMap[variable.resolvedType], $value: value,
    origin: 'zero', sourceId: variable.id, ...(variable.resolvedType === 'FLOAT' ? { unit: 'px' } : {}) };
}
// These are explicit implementation policies, not measurements extracted from ZERO.
for (const [name, value, type] of [
  ['breakpoint/mobile', 768, 'dimension'], ['breakpoint/tablet', 1024, 'dimension'],
  ['columns/one', 1, 'number'], ['columns/two', 2, 'number'], ['columns/three', 3, 'number'],
  ['line-clamp/subtitle', 2, 'number'],
]) tokens[name] = { $type: type, $value: value, origin: 'implementation-policy', ...(type === 'dimension' ? { unit: 'px' } : {}) };
const categoryBySection = {
  '7:11707': 'navigation', '7:11708': 'hero', '7:11709': 'benefits', '7:11710': 'demo',
  '7:11711': 'pain-points', '7:11712': 'features', '7:11713': 'use-cases', '7:11714': 'case-studies',
  '7:11715': 'customers', '7:11716': 'services', '7:11717': 'onboarding', '7:11718': 'guides',
  '7:11719': 'conversion', '7:11720': 'footer',
};
const categories = Object.values(categoryBySection);
const tags = ['导航 页头 header', '首屏 标题 banner CTA', '产品 方案 优势 benefits', '功能 体验 交互 AI demo', '行业 痛点 pain', '功能 介绍 features', '应用 场景 solutions', '客户 案例 proof', '行业 客户 logo trust', '运营 服务 support', '接入 流程 steps', '使用 指南 docs', '底部 留资 表单 CTA', '页脚 footer'];
const fontTokens = Object.keys(tokens).filter(k => k.startsWith('type/') && typeof tokens[k].$value === 'number');
function semantic(node) {
  if (!node) return null;
  if (node.kind === 'text') {
    const closest = fontTokens.reduce((best, key) => Math.abs(tokens[key].$value - (node.fontSize ?? 16)) < Math.abs(tokens[best].$value - (node.fontSize ?? 16)) ? key : best, fontTokens[0]);
    return { id: node.id, role: (node.fontSize ?? 0) >= 28 ? 'heading' : 'text', name: node.name, text: node.text,
      tokenRefs: { color: 'color/text/primary', ...(closest ? { fontSize: closest } : {}) } };
  }
  return { id: node.id, role: 'content-group', name: node.name,
    layout: { display: 'stack', gapToken: 'space/16' }, children: (node.children ?? []).map(semantic).filter(Boolean) };
}
const assets = [];
for (const section of source.sections) {
  // Section names/IDs come from the export; category mapping is an explicit adapter contract.
  const category = categoryBySection[section.id];
  const index = categories.indexOf(category);
  if (!category) throw new Error('New section requires category mapping; snapshot retained');
  for (const module of section.modules) {
    const structure = semantic(module.tree);
    if (!structure) throw new Error(`Module has no semantic content: ${module.id}`);
    structure.role = category;
    structure.layout = { display: 'stack', gapToken: 'space/32', maxWidthToken: 'size/content' };
    structure.tokenRefs = { background: category === 'footer' && module.name.includes('black') ? 'color/bg/footer' : 'color/bg/canvas',
      paddingBlock: 'space/100', paddingInlineMobile: 'space/16' };
    if (category === 'footer' && module.name.includes('black')) {
      const inverse = node => { if (node.tokenRefs?.color) node.tokenRefs.color = 'color/text/inverse'; node.children?.forEach(inverse); };
      inverse(structure);
    }
    assets.push({ id: `zero-${module.id.replace(':', '-')}`, name: module.name,
      category, tags: [section.name, ...tags[index].split(' ')], kind: 'module',
      sourceNodeIds: [module.id], structure });
  }
}
const flows = {
  'saas-b2b': ['navigation', 'hero', 'customers', 'pain-points', 'benefits', 'use-cases', 'case-studies', 'services', 'onboarding', 'conversion', 'footer'],
  'ai-developer': ['navigation', 'hero', 'demo', 'features', 'use-cases', 'onboarding', 'guides', 'case-studies', 'conversion', 'footer'],
  'consumer': ['navigation', 'hero', 'use-cases', 'benefits', 'demo', 'case-studies', 'guides', 'conversion', 'footer'],
};
for (const [scenario, flow] of Object.entries(flows)) {
  const selected = flow.map(category => assets.find(asset => asset.category === category));
  if (selected.some(asset => !asset)) throw new Error(`Incomplete flow: ${scenario}`);
  assets.push({ id: `template-${scenario}`, name: `${scenario} · 标准叙事模板`, category: 'templates',
    tags: [scenario, '落地页', 'landing-page'], kind: 'template', sourceNodeIds: selected.flatMap(asset => asset.sourceNodeIds),
    structure: { id: `template-${scenario}`, role: 'page', name: scenario,
      layout: { display: 'stack', gapToken: 'space/80' }, children: selected.map(asset => asset.structure) } });
}
const output = {
  schemaVersion: 1,
  source: { designId, url: `https://relay.jd.com/file/design?id=${designId}&page_id=7%3A11630`,
    exportedAt: source.exportedAt, mode: 'zero-snapshot', notes: [
      '来源为 ZERO 原生变量及模块文本；语义角色、Token 归一化和 stack 布局为人工定义的工程适配规则，不是像素级复刻。',
      '模板为现有模块的业务编排示例；布局策略与 ZERO 原生变量通过 origin 区分。',
      '仅支持单模式集合。插画/标志需按 sourceNodeIds 从 ZERO 正式导出，不附带临时 localhost 素材链接。',
    ] }, tokens, assets,
};
// Validate through the actual MCP server before atomically replacing the snapshot.
const temporary = fileURLToPath(destination) + `.${randomUUID()}.tmp`;
try {
  await writeFile(temporary, JSON.stringify(output, null, 2) + '\n');
  const { validateSnapshot } = await import('./validate-snapshot.mjs');
  await validateSnapshot(temporary);
  await rename(temporary, destination);
} finally { await rm(temporary, { force: true }); }
console.error(`Synced ${assets.length} assets, ${Object.keys(tokens).length} tokens. Source: ${source.exportedAt}`);

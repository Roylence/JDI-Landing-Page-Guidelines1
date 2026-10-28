import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const tokenSchema = z.strictObject({
  $type: z.enum(['color', 'dimension', 'number', 'string', 'boolean']),
  $value: z.union([z.string(), z.number().finite(), z.boolean(), z.strictObject({ ref: z.string() })]),
  origin: z.enum(['zero', 'implementation-policy']),
  sourceId: z.string().optional(),
  unit: z.literal('px').optional(),
});
type SemanticNode = {
  id: string; role: string; name: string; text?: string;
  tokenRefs?: Record<string, string>;
  layout?: { display: 'stack' | 'grid' | 'flex'; columnsToken?: string;
    mobileColumnsToken?: string; gapToken?: string; maxWidthToken?: string };
  children?: SemanticNode[];
};
const nodeSchema: z.ZodType<SemanticNode> = z.lazy(() => z.strictObject({
  id: z.string(), role: z.string(), name: z.string(), text: z.string().optional(),
  tokenRefs: z.record(z.string(), z.string()).optional(),
  layout: z.strictObject({
    display: z.enum(['stack', 'grid', 'flex']), columnsToken: z.string().optional(),
    mobileColumnsToken: z.string().optional(), gapToken: z.string().optional(),
    maxWidthToken: z.string().optional(),
  }).optional(),
  children: z.array(nodeSchema).optional(),
}));
const databaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: z.strictObject({
    designId: z.string(), url: z.string().url(), exportedAt: z.string().datetime(),
    mode: z.literal('zero-snapshot'), notes: z.array(z.string()),
  }),
  tokens: z.record(z.string().regex(/^[a-zA-Z0-9/-]+$/), tokenSchema),
  assets: z.array(z.strictObject({
    id: z.string(), name: z.string(), category: z.string(), tags: z.array(z.string()),
    kind: z.enum(['module', 'template']), sourceNodeIds: z.array(z.string()),
    structure: nodeSchema,
  })),
});
const databasePath = process.env.DESIGN_SYSTEM_DATA_FILE
  ? resolve(process.env.DESIGN_SYSTEM_DATA_FILE)
  : fileURLToPath(new URL('../data/design-system.json', import.meta.url));

async function loadSnapshot() {
  // A single read gives one coherent catalog/token revision; no module JSON cache.
  const bytes = await readFile(databasePath);
  const data = databaseSchema.parse(JSON.parse(bytes.toString('utf8')));
  const resolved: Record<string, string | number | boolean> = {};
  function resolveToken(name: string, trail: string[] = []): string | number | boolean {
    if (trail.includes(name)) throw new Error(`Token alias cycle: ${[...trail, name].join(' -> ')}`);
    if (Object.hasOwn(resolved, name)) return resolved[name]!;
    const token = data.tokens[name];
    if (!token) throw new Error(`Unknown token: ${name}`);
    let value = token.$value;
    if (typeof value === 'object') {
      const target = data.tokens[value.ref];
      if (target?.$type !== token.$type) throw new Error(`Token alias type mismatch: ${name}`);
      value = resolveToken(value.ref, [...trail, name]);
    }
    const valid = token.$type === 'color' ? typeof value === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(value)
      : token.$type === 'dimension' || token.$type === 'number' ? typeof value === 'number'
      : typeof value === token.$type;
    if (!valid || (token.$type === 'dimension' && token.unit !== 'px')) {
      throw new Error(`Invalid token value/unit: ${name}`);
    }
    resolved[name] = value;
    return value;
  }
  Object.keys(data.tokens).forEach(name => resolveToken(name));
  const ids = new Set<string>();
  function checkNode(node: SemanticNode) {
    const refs = [...Object.values(node.tokenRefs ?? {}),
      ...Object.entries(node.layout ?? {}).filter(([key]) => key.endsWith('Token')).map(([, value]) => value)];
    refs.forEach(ref => { if (!Object.hasOwn(data.tokens, ref)) throw new Error(`Unknown node token: ${ref}`); });
    node.children?.forEach(checkNode);
  }
  for (const asset of data.assets) {
    if (ids.has(asset.id)) throw new Error(`Duplicate asset ID: ${asset.id}`);
    ids.add(asset.id);
    checkNode(asset.structure);
  }
  return {
    data, resolved,
    meta: { revision: createHash('sha256').update(bytes).digest('hex'), readAt: new Date().toISOString(), source: data.source },
  };
}

const server = new McpServer({ name: 'zero-design-system', version: '1.0.0' });
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
async function respond(action: () => Promise<Record<string, unknown>>) {
  try {
    const output = await action();
    return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output };
  } catch (error) {
    // Fail closed: never substitute invented tokens or assets after an error.
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }] };
  }
}

server.registerTool('search_assets', {
  description: '按关键词和/或分类搜索已入库的 ZERO 模块或模板；空条件列出目录。返回分类、来源与快照版本。',
  annotations,
  inputSchema: {
    keyword: z.string().trim().max(200).optional(), category: z.string().trim().max(100).optional(),
    limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).default(0),
  },
}, args => respond(async () => {
  const { data, meta } = await loadSnapshot();
  const words = (args.keyword ?? '').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = data.assets.filter(asset => {
    const haystack = [asset.id, asset.name, asset.category, ...asset.tags].join(' ').toLocaleLowerCase();
    return (!args.category || asset.category.toLocaleLowerCase() === args.category.toLocaleLowerCase())
      && words.every(word => haystack.includes(word));
  });
  return { ...meta, categories: [...new Set(data.assets.map(asset => asset.category))],
    total: matches.length, offset: args.offset,
    assets: matches.slice(args.offset, args.offset + args.limit).map(({ structure: _tree, ...asset }) => asset),
    nextOffset: args.offset + args.limit < matches.length ? args.offset + args.limit : null };
}));

server.registerTool('get_asset_structure', {
  description: '根据资产 ID 获取语义树、内容、布局意图及 Token 引用，不返回画布绝对坐标。',
  annotations,
  inputSchema: { asset_id: z.string().trim().min(1).max(120) },
}, ({ asset_id }) => respond(async () => {
  const { data, meta } = await loadSnapshot();
  const asset = data.assets.find(item => item.id === asset_id);
  if (!asset) throw new Error(`Asset not found: ${asset_id}; call search_assets first`);
  return { ...meta, asset };
}));

server.registerTool('get_design_tokens', {
  description: '每次实时重读本地快照，返回最新 Token、解析后的别名和 CSS 变量；不自动请求远端 ZERO。',
  annotations,
  inputSchema: { prefix: z.string().max(100).optional() },
}, ({ prefix }) => respond(async () => {
  const { data, resolved, meta } = await loadSnapshot();
  const names = Object.keys(data.tokens).filter(name => !prefix || name.startsWith(prefix));
  const tokens = Object.fromEntries(names.map(name => [name, data.tokens[name]]));
  const resolvedTokens = Object.fromEntries(names.map(name => [name, resolved[name]]));
  const cssVariables = Object.fromEntries(names.map(name => [
    `--${name.replaceAll('/', '-')}`,
    `${resolved[name]}${data.tokens[name]!.$type === 'dimension' ? 'px' : ''}`,
  ]));
  return { ...meta, tokens, resolvedTokens, cssVariables };
}));

await server.connect(new StdioServerTransport());

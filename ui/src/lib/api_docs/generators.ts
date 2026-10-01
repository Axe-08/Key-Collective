/**
 * @file generators.ts
 * Code snippet and documentation export generators for ApiDocs.
 */

export function generateCurlSnippet(
  baseUrl: string,
  bearerToken: string,
  selectedModel: string,
  isStreaming: boolean
): string {
  return `curl ${baseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${bearerToken}" \\
  -H "x-pool-fallback: lenient" \\
  -d '{
    "model": "${selectedModel}",
    "messages": [{"role": "user", "content": "Ping!"}],
    "stream": ${isStreaming}
  }'`;
}

export function generateTsSnippet(
  baseUrl: string,
  bearerToken: string,
  selectedModel: string,
  isStreaming: boolean
): string {
  return `import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: '${bearerToken}',
  baseURL: '${baseUrl}',
  defaultHeaders: { 'x-pool-fallback': 'lenient' }
});

const response = await client.chat.completions.create({
  model: '${selectedModel}',
  messages: [{ role: 'user', content: 'Ping!' }],
  stream: ${isStreaming},
});`;
}

export function generatePySnippet(
  baseUrl: string,
  bearerToken: string,
  selectedModel: string,
  isStreaming: boolean
): string {
  return `from openai import OpenAI

client = OpenAI(
    api_key="${bearerToken}",
    base_url="${baseUrl}",
    default_headers={"x-pool-fallback": "lenient"}
)

stream = client.chat.completions.create(
    model="${selectedModel}",
    messages=[{"role": "user", "content": "Ping!"}],
    stream=${isStreaming ? 'True' : 'False'}
)`;
}

/** The subset of an OpenAPI 3 document the docs page renders. */
export interface OpenApiOperation {
  summary?: string;
  description?: string;
  parameters?: Array<{ name: string; in: string; required?: boolean; description?: string }>;
}
export interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Every (path, method) pair in the spec, in spec order (WP-3.10: the spec is the only source). */
export function listOperations(spec: OpenApiDocument): Array<{ path: string; method: string; op: OpenApiOperation }> {
  const out: Array<{ path: string; method: string; op: OpenApiOperation }> = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      if (item[method]) out.push({ path, method: method.toUpperCase(), op: item[method] });
    }
  }
  return out;
}

/** Markdown export of the served OpenAPI document. */
export function specToMarkdown(spec: OpenApiDocument, baseUrl: string): string {
  const lines = [
    `# ${spec.info?.title ?? 'Key Collective API'}${spec.info?.version ? ` (${spec.info.version})` : ''}`,
    '',
    `Base URL: \`${baseUrl}\``,
    '',
    'Authentication: `Authorization: Bearer <API key>`',
    '',
  ];
  for (const { path, method, op } of listOperations(spec)) {
    lines.push(`## ${method} \`${path}\``, '');
    if (op.summary) lines.push(op.summary, '');
    if (op.description) lines.push(op.description, '');
    for (const p of op.parameters ?? []) {
      lines.push(`- \`${p.name}\` (${p.in}${p.required ? ', required' : ''})${p.description ? `: ${p.description}` : ''}`);
    }
    if (op.parameters?.length) lines.push('');
  }
  return lines.join('\n');
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'assignment');
const [schemaText, pipeline, review, prototype] = await Promise.all([
  fs.readFile(path.join(directory, 'generation-command.schema.json'), 'utf8'),
  fs.readFile(path.join(directory, 'part-1-pipeline.md'), 'utf8'),
  fs.readFile(path.join(directory, 'part-3-image-review.md'), 'utf8'),
  fs.readFile(path.join(directory, 'part-2-ar-prototype.md'), 'utf8'),
]);
const schema = JSON.parse(schemaText);
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);
const examples = [...pipeline.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]));
const retry = examples.find(item => item.action === 'RETRY_SAFE');
assert.ok(retry, 'Missing the actual documented retry example');
assert.ok(validate(retry), JSON.stringify(validate.errors));
const generate = structuredClone(retry);
Object.assign(generate, { action: 'GENERATE', reason_code: 'NONE', rule_ids: [] });
generate.repair = { remove_motif_ids: [], replacement_motif_ids: [] };
assert.ok(validate(generate), JSON.stringify(validate.errors));
const escalate = structuredClone(generate);
Object.assign(escalate, { action: 'ESCALATE', reason_code: 'UNKNOWN_CULTURE', tool_call: null });
assert.ok(validate(escalate), JSON.stringify(validate.errors));

const invalidCases = [
  { name: 'GENERATE requires a non-null tool', base: generate, mutate: item => { item.tool_call = null; } },
  { name: 'GENERATE cannot request repair', base: generate, mutate: item => { item.repair.remove_motif_ids = ['forbidden']; } },
  { name: 'GENERATE cannot carry an error reason', base: generate, mutate: item => { item.reason_code = 'UNKNOWN_CULTURE'; } },
  { name: 'ESCALATE never executes a tool', base: escalate, mutate: item => { item.tool_call = generate.tool_call; } },
  { name: 'ESCALATE needs an explicit reason', base: escalate, mutate: item => { item.reason_code = 'NONE'; } },
  { name: 'RETRY cannot claim NONE', base: retry, mutate: item => { item.reason_code = 'NONE'; } },
  { name: 'RETRY requires a tool', base: retry, mutate: item => { item.tool_call = null; } },
  { name: 'Unknown tool is rejected', base: generate, mutate: item => { item.tool_call.name = 'execute_shell'; } },
  { name: 'Invalid palette is rejected', base: generate, mutate: item => { item.tool_call.arguments.palette_hex = ['red']; } },
  { name: 'Extra top-level keys are rejected', base: generate, mutate: item => { item.extra = true; } },
  { name: 'Missing task ID is rejected', base: generate, mutate: item => { delete item.task_id; } },
];
for (const test of invalidCases) {
  const item = structuredClone(test.base);
  test.mutate(item);
  assert.equal(validate(item), false, test.name);
}
const scores = review.split('## 五、分项复核表')[1]?.split('## 六、')[0]
  .split('\n').filter(line => /^\| \d{2} \|/.test(line)).map(line => line.split('|').slice(1, -1).map(item => item.trim()));
assert.equal(scores?.length, 20, 'Expected exactly 20 weighted score rows');
for (const [index, score] of scores.entries()) {
  assert.equal(score[0], String(index + 1).padStart(2, '0'));
  const weighted = [0.3, 0.25, 0.2, 0.15, 0.1].reduce((sum, weight, i) => sum + weight * Number(score[i + 1]), 0);
  assert.ok(Math.abs(weighted - Number(score[6])) < 0.00051, `Weighted score mismatch: ${score[0]}`);
  const final = Number.parseInt(score[7], 10);
  assert.ok(final >= 1 && final <= 5, `Invalid final score: ${score[0]}`);
  if (score[0] !== '16') assert.equal(final, Math.floor(weighted + 0.5), `Score band mismatch: ${score[0]}`);
}
const retro = prototype.split('## 五、Vibecoding 复盘（200 字以内）')[1]?.split('## 六、')[0]?.trim();
assert.ok(retro && Array.from(retro).length <= 200, 'Retrospective must be <=200 characters including the prompt');
const result = {
  recordedAt: new Date().toISOString(), schema: 'Draft 2020-12, Ajv strict mode',
  validCases: 3, rejectedInvalidCases: invalidCases.length, scoreRows: scores.length,
  retrospectiveCharacters: Array.from(retro).length,
  scope: 'Structure/cross-field invariants and arithmetic only; trusted regional permissions, human aesthetics and live production remain separate.',
};
await fs.mkdir(path.join(directory, 'evidence'), { recursive: true });
await fs.writeFile(path.join(directory, 'evidence/document-validation.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));

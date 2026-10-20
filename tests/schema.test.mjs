// Validates every example against references/building.schema.json without adding a dependency.
// The checker covers exactly the JSON Schema keywords the schema uses and fails loudly on any other,
// so a new keyword cannot be silently ignored.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const skillRoot = path.resolve(import.meta.dirname, '..');
const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, 'references', 'building.schema.json'), 'utf8'));
const examples = fs.readdirSync(path.join(skillRoot, 'examples'), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && fs.existsSync(path.join(skillRoot, 'examples', entry.name, 'building.json')))
  .map(entry => entry.name);

const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', 'default']);
const KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'enum', 'const', '$ref', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'if', 'then', 'else', 'not', 'oneOf', 'anyOf', '$defs']);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}
function resolve(ref) {
  assert.ok(ref.startsWith('#/'), `Only local $ref is supported: ${ref}`);
  return ref.slice(2).split('/').reduce((node, key) => node[key], schema);
}

export function check(node, value, at = '$', errors = []) {
  for (const key of Object.keys(node)) if (!ANNOTATIONS.has(key) && !KEYWORDS.has(key)) throw new Error(`Unsupported schema keyword ${key} at ${at}`);
  if (node.$ref) check(resolve(node.$ref), value, at, errors);
  if (node.type) {
    const types = [].concat(node.type), actual = typeOf(value);
    if (!types.some(type => type === actual || (type === 'number' && actual === 'integer'))) { errors.push(`${at}: expected ${types.join('|')}, got ${actual}`); return errors; }
  }
  if ('const' in node && JSON.stringify(node.const) !== JSON.stringify(value)) errors.push(`${at}: expected ${JSON.stringify(node.const)}`);
  if (node.enum && !node.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) errors.push(`${at}: ${JSON.stringify(value)} not in enum`);
  if (typeof value === 'number') {
    if (node.minimum != null && value < node.minimum) errors.push(`${at}: below minimum ${node.minimum}`);
    if (node.maximum != null && value > node.maximum) errors.push(`${at}: above maximum ${node.maximum}`);
    if (node.exclusiveMinimum != null && value <= node.exclusiveMinimum) errors.push(`${at}: not above ${node.exclusiveMinimum}`);
    if (node.exclusiveMaximum != null && value >= node.exclusiveMaximum) errors.push(`${at}: not below ${node.exclusiveMaximum}`);
  }
  if (typeof value === 'string') {
    if (node.pattern && !new RegExp(node.pattern, 'u').test(value)) errors.push(`${at}: does not match ${node.pattern}`);
    if (node.minLength != null && value.length < node.minLength) errors.push(`${at}: shorter than ${node.minLength}`);
  }
  if (Array.isArray(value)) {
    if (node.minItems != null && value.length < node.minItems) errors.push(`${at}: fewer than ${node.minItems} items`);
    if (node.items) value.forEach((item, i) => check(node.items, item, `${at}[${i}]`, errors));
  }
  if (typeOf(value) === 'object') {
    for (const key of node.required ?? []) if (!(key in value)) errors.push(`${at}: missing ${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (node.properties?.[key]) check(node.properties[key], item, `${at}.${key}`, errors);
      else if (node.additionalProperties === false) errors.push(`${at}: unexpected property ${key}`);
    }
  }
  const passes = sub => check(sub, value, at, []).length === 0;
  if (node.if) {
    if (passes(node.if)) { if (node.then) check(node.then, value, at, errors); }
    else if (node.else) check(node.else, value, at, errors);
  }
  if (node.not && passes(node.not)) errors.push(`${at}: matches a forbidden shape`);
  if (node.anyOf && !node.anyOf.some(passes)) errors.push(`${at}: matches none of anyOf`);
  if (node.oneOf && node.oneOf.filter(passes).length !== 1) errors.push(`${at}: must match exactly one of oneOf`);
  return errors;
}

test('every example validates against building.schema.json', () => {
  assert.ok(examples.length >= 4);
  for (const name of examples) {
    const model = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', name, 'building.json'), 'utf8'));
    assert.deepEqual(check(schema, model), [], `${name} does not match the schema`);
  }
});

test('the schema checker rejects malformed models', () => {
  const model = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', examples[0], 'building.json'), 'utf8'));
  model.walls[0].thicknessMm = 'thick';
  model.levels[0].extra = true;
  const errors = check(schema, model);
  assert.ok(errors.some(error => error.includes('walls[0].thicknessMm')));
  assert.ok(errors.some(error => error.includes('unexpected property extra')));
});

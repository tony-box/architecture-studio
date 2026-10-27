import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadStudioApi, buildDrawingSet } from '../scripts/export-drawings.mjs';
import { inspect } from '../scripts/inspect.mjs';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'assets', 'studio-template.html'), 'utf8');
const examples = fs.readdirSync(path.join(root, 'examples'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => JSON.parse(fs.readFileSync(path.join(root, 'examples', entry.name, 'building.json'), 'utf8')));

test('every example declares its composition and resolves the current findings', () => {
  for (const model of examples) {
    const { api } = loadStudioApi(html);
    api.state.model = model;
    assert.ok(['symmetric', 'balanced', 'rhythm'].includes(model.composition?.strategy), model.project.id);
    assert.equal(model.project.jurisdiction.codeReviewStatus, 'unavailable', model.project.id);
    const findings = api.validateModel(model).filter(item => item.severity === 'error' || item.code.startsWith('composition.'));
    assert.equal(findings.length, 0, `${model.project.id}: ${JSON.stringify(findings)}`);
    const report = api.compositionReport(model);
    assert.equal(report.proposal.length, 0, model.project.id);
    assert.ok(model.assumptions.some(item => /omit|omitted/i.test(item.statement)), 'partial studies disclose omissions');
  }
});

test('example devices use the current vocabulary and reach their system origin', () => {
  const { api } = loadStudioApi(html);
  const connectionKinds = new Set(['panel', 'circuit-end', 'fixture-connection', 'vertical-stack', 'outdoor-unit', 'air-handler']);
  for (const model of examples) for (const system of model.systems) {
    assert.equal(system.status, 'concept');
    for (const node of system.nodes) {
      assert.ok(api.SYSTEM_SYMBOLS[node.kind] || connectionKinds.has(node.kind), `${model.project.id}: ${node.kind}`);
      if (api.SYSTEM_SYMBOLS[node.kind] && node.kind !== 'junction-box') {
        assert.equal(node.evidence.status, 'needs-review', node.id);
        assert.ok(node.evidence.reference, `${node.id} names a placement rule or design practice`);
      }
    }
    const reached = new Set([system.nodes[0].id]);
    for (let i = 0; i < system.nodes.length; i += 1) for (const edge of system.edges) {
      if (reached.has(edge.from)) reached.add(edge.to);
      if (reached.has(edge.to)) reached.add(edge.from);
    }
    assert.equal(reached.size, system.nodes.length, `${model.project.id}: ${system.id} is disconnected`);
  }
});

test('example capability claims are present in the model and rendered sheets', () => {
  const { api } = loadStudioApi(html);
  const barn = examples.find(model => model.project.id === 'lakeside-barn-residence');
  for (const side of ['west', 'east']) {
    const door = barn.openings.find(item => item.id === `opening-overhead-${side}`);
    const clerestory = barn.openings.find(item => item.id === `opening-clerestory-${side}`);
    assert.equal(clerestory.offsetMm + clerestory.widthMm / 2, door.offsetMm + door.widthMm / 2);
    assert.ok(clerestory.sillMm >= door.sillMm + door.heightMm);
  }
  for (const model of examples) {
    const { errors, sheets } = buildDrawingSet(html, model);
    assert.equal(errors.length, 0, model.project.id);
    const svg = sheets.map(sheet => sheet.svg).join('\n');
    for (const system of model.systems) for (const node of system.nodes) if (api.SYSTEM_SYMBOLS[node.kind]) {
      assert.ok(svg.includes(`data-entity="${node.id}" data-symbol="${node.kind}"`), `${node.id} renders its symbol`);
    }
    if (model.project.id.startsWith('hillside-')) {
      const walk = inspect(html, model, 'surface-walk');
      assert.equal(walk.path.widthMm, model.openings.find(item => item.id === 'opening-front-door').widthMm);
      assert.ok(walk.clearanceToBuildingMm >= 0 && walk.clearanceToPropertyLineMm >= 0);
      assert.equal(walk.findings.length, 0);
      assert.ok(sheets.some(sheet => sheet.sheetId === 'L-101'));
    }
    if (model.project.id.startsWith('mixed-material-')) {
      assert.ok(model.surfaces.find(item => item.id === 'surface-shop-walk').boundary.some(point => point.anchor));
    }
  }
});

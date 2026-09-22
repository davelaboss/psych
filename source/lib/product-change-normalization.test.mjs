import assert from 'node:assert/strict';
import test from 'node:test';
import {
  productChangeHasDifference,
  semanticProductChangeValue,
  storedProductChangeValue,
} from './product-change-normalization.ts';

test('stores blank or omitted known-defect input as a non-null empty string', () => {
  assert.equal(semanticProductChangeValue('knownDefects', ''), '');
  assert.equal(storedProductChangeValue('knownDefects', ''), '');
  assert.equal(storedProductChangeValue('knownDefects', null), '');
  assert.equal(storedProductChangeValue('knownDefects', undefined), '');
});

test('stores blank or omitted condition-note input as a non-null empty string', () => {
  assert.equal(semanticProductChangeValue('conditionNotes', ''), '');
  assert.equal(storedProductChangeValue('conditionNotes', ''), '');
  assert.equal(storedProductChangeValue('conditionNotes', null), '');
  assert.equal(storedProductChangeValue('conditionNotes', undefined), '');
});

test('preserves an existing known-defects value when the field is omitted', () => {
  const before = { title: 'Silla', knownDefects: 'Marca pequeña', category: 'Oficina' };
  const changes = { title: 'Silla ergonómica' };
  const after = { ...before, ...changes };

  assert.deepEqual(after, {
    title: 'Silla ergonómica',
    knownDefects: 'Marca pequeña',
    category: 'Oficina',
  });
  assert.equal(productChangeHasDifference('knownDefects', 'Marca pequeña', 'Marca pequeña'), false);
});

test('keeps populated known-defects text and existing normalization for other fields', () => {
  assert.equal(storedProductChangeValue('knownDefects', 'Rayón lateral'), 'Rayón lateral');
  assert.equal(productChangeHasDifference('knownDefects', 'Marca pequeña', ''), true);
  assert.equal(storedProductChangeValue('internalNotes', ''), null);
  assert.equal(storedProductChangeValue('featured', true), 1);
  assert.equal(storedProductChangeValue('tags', ['mueble', 'oficina']), '["mueble","oficina"]');
});

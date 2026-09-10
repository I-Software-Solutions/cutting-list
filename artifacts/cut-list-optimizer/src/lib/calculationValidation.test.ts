import assert from 'node:assert/strict';
import { isEnteredRow, validateCalculationRows } from './calculationValidation';
import type { CutPiece, StockItem } from '../types';

const piece = (overrides: Partial<CutPiece> = {}): CutPiece => ({
  id: 'p1', length: '', width: '', qty: '1', label: '', material: '', grain: false, ...overrides,
});
const stock = (overrides: Partial<StockItem> = {}): StockItem => ({
  id: 's1', length: '', width: '', qty: '1', material: '', ...overrides,
});
function test(name: string, run: () => void) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`, error);
    process.exitCode = 1;
  }
}

test('untouched rows are placeholders, not invalid requests', () => {
  assert.equal(isEnteredRow(piece()), false);
  assert.deepEqual(validateCalculationRows([piece()], [stock()], 'sheet', 'metric'), []);
});
test('linear rows require widths in sheet mode without mutating any data', () => {
  const pieces = [piece({ length: '500', label: 'Frame', qty: '3' })];
  const bars = [stock({ length: '2400' })];
  const snapshot = JSON.stringify({ pieces, bars });
  assert.equal(validateCalculationRows(pieces, bars, 'linear', 'metric').length, 0);
  const issues = validateCalculationRows(pieces, bars, 'sheet', 'metric');
  assert.equal(issues.length, 2);
  assert.match(issues[0].row, /Piece row 1 \(Frame\)/);
  assert.match(issues[0].message, /width greater than 0/);
  assert.match(issues[1].row, /Stock row 1/);
  assert.equal(JSON.stringify({ pieces, bars }), snapshot);
});
test('valid and incomplete pieces cannot be silently combined into a partial plan', () => {
  const rows = [piece({ length: '500', width: '300' }), piece({ id: 'p2', length: '400', label: 'Missing width' })];
  const issues = validateCalculationRows(rows, [stock({ length: '2400', width: '1200' })], 'sheet', 'metric');
  assert.equal(issues.length, 1);
  assert.match(issues[0].row, /Piece row 2 \(Missing width\)/);
});
test('label-only and width-only rows need a length', () => {
  for (const row of [piece({ label: 'Unfinished' }), piece({ width: '300' })]) {
    assert.equal(isEnteredRow(row), true);
    assert.match(validateCalculationRows([row], [], 'sheet', 'metric')[0].message, /length greater than 0/);
  }
});
test('zero, negative, invalid and nonfinite dimensions are rejected', () => {
  for (const length of ['0', '-2', 'abc', 'Infinity']) {
    assert.match(validateCalculationRows([piece({ length })], [], 'linear', 'metric')[0].message, /length greater than 0/);
  }
});
test('quantity must be a positive whole number', () => {
  for (const qty of ['0', '', '-2', '1.5', 'abc']) {
    assert.match(validateCalculationRows([piece({ length: '500', qty })], [], 'linear', 'metric')[0].message, /quantity/);
  }
});
test('linear mode ignores but preserves widths', () => {
  const row = piece({ length: '500', width: '300' });
  assert.deepEqual(validateCalculationRows([row], [stock({ length: '2400' })], 'linear', 'metric'), []);
  assert.equal(row.width, '300');
});
test('imperial dimensions and fractions remain supported', () => {
  assert.deepEqual(validateCalculationRows(
    [piece({ length: `3'6"`, width: '10 3/4' })],
    [stock({ length: `8'`, width: '48' })], 'sheet', 'imperial',
  ), []);
});
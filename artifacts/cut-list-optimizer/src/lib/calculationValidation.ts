import type { CutPiece, Mode, StockItem } from '../types';
import { parseValue, type Units } from './units';

type Row = CutPiece | StockItem;

export interface CalculationIssue {
  key: string;
  row: string;
  message: string;
}

// Untouched placeholder rows are not requests. A partly entered row is, even
// when its length is missing, so it must never disappear from a cutting plan.
export function isEnteredRow(row: Row): boolean {
  return Boolean(
    row.length.trim() || row.width.trim() || row.material.trim() ||
    ('label' in row && row.label.trim()) || ('grain' in row && row.grain) ||
    row.qty.trim() !== '1'
  );
}

function isPositiveDimension(raw: string, units: Units): boolean {
  const value = parseValue(raw, units);
  return Number.isFinite(value) && value > 0;
}

export function validateCalculationRows(
  pieces: CutPiece[], stock: StockItem[], mode: Mode, units: Units,
): CalculationIssue[] {
  const issues: CalculationIssue[] = [];
  const checkRows = (rows: Row[], section: 'Piece' | 'Stock') => {
    rows.forEach((row, index) => {
      if (!isEnteredRow(row)) return;
      const fields: string[] = [];
      if (!isPositiveDimension(row.length, units)) fields.push('length greater than 0');
      if (mode === 'sheet' && !isPositiveDimension(row.width, units)) {
        fields.push('width greater than 0 for Sheets (2D)');
      }
      if (!/^\d+$/.test(row.qty.trim()) || !Number.isSafeInteger(Number(row.qty)) || Number(row.qty) < 1) {
        fields.push('whole-number quantity of at least 1');
      }
      if (fields.length) {
        const label = 'label' in row ? row.label.trim() : row.material.trim();
        issues.push({
          key: `${section}-${row.id}`,
          row: `${section} row ${index + 1}${label ? ` (${label})` : ''}`,
          message: `Enter ${fields.join(', ')}.`,
        });
      }
    });
  };
  checkRows(pieces, 'Piece');
  checkRows(stock, 'Stock');
  return issues;
}
import { Plus, Trash2 } from 'lucide-react';
import type { CutPiece, StockItem } from '../types';
import type { Mode } from '../types';
import type { Units } from '../lib/units';
import { unitLabel } from '../lib/units';
import { BoardTypeSelector, type BoardType } from './BoardTypeSelector';
import { NumericInput } from './NumericInput';

interface PieceTableProps {
  mode: Mode;
  units: Units;
  pieces: CutPiece[];
  showMaterial: boolean;
  onChange: (pieces: CutPiece[]) => void;
}

function newPiece(): CutPiece {
  return { id: crypto.randomUUID(), length: '', width: '', qty: '1', label: '', material: '', grain: false };
}

export function PieceTable({ mode, units, pieces, showMaterial, onChange }: PieceTableProps) {
  const ul = unitLabel(units);

  const update = (id: string, field: keyof CutPiece, value: string | boolean) => {
    onChange(pieces.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const remove = (id: string) => {
    onChange(pieces.filter(p => p.id !== id));
  };

  const add = () => onChange([...pieces, newPiece()]);

  return (
    <div data-section="pieces">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 80 }}>Length ({ul})</th>
            {mode === 'sheet' && <th style={{ width: 80 }}>Width ({ul})</th>}
            <th style={{ width: 46 }}>Qty</th>
            <th>Label</th>
            {showMaterial && <th style={{ width: 90 }}>Material</th>}
            <th style={{ width: 28 }}></th>
          </tr>
        </thead>
        <tbody>
          {pieces.map(p => (
            <tr
              key={p.id}
              data-piece={JSON.stringify({ length: p.length, width: p.width, qty: p.qty, label: p.label, material: p.material })}
            >
              <td>
                <NumericInput
                  className="cell-input"
                  value={p.length}
                  onChange={e => update(p.id, 'length', e.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                />
              </td>
              {mode === 'sheet' && (
                <td>
                  <NumericInput
                    className="cell-input"
                    value={p.width}
                    onChange={e => update(p.id, 'width', e.target.value)}
                    placeholder="0"
                    inputMode="decimal"
                  />
                </td>
              )}
              <td>
                <NumericInput
                  className="cell-input"
                  value={p.qty}
                  onChange={e => update(p.id, 'qty', e.target.value)}
                  placeholder="1"
                  inputMode="numeric"
                />
              </td>
              <td>
                <input
                  className="cell-input"
                  value={p.label}
                  onChange={e => update(p.id, 'label', e.target.value)}
                  placeholder="Label"
                />
              </td>
              {showMaterial && (
                <td>
                  <input
                    className="cell-input"
                    value={p.material}
                    onChange={e => update(p.id, 'material', e.target.value)}
                    placeholder="e.g. Oak"
                  />
                </td>
              )}
              <td>
                <button
                  onClick={() => remove(p.id)}
                  className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-destructive transition-colors"
                  title="Remove row"
                >
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={add}
        className="flex items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Plus size={13} /> Add row
      </button>
    </div>
  );
}

interface StockTableProps {
  mode: Mode;
  units: Units;
  stock: StockItem[];
  showMaterial: boolean;
  onChange: (stock: StockItem[]) => void;
}

function newStock(): StockItem {
  return { id: crypto.randomUUID(), length: '', width: '', qty: '1', material: '' };
}

export function StockTable({ mode, units, stock, showMaterial, onChange }: StockTableProps) {
  const ul = unitLabel(units);
  const stockType = mode === 'sheet' ? 'sheet' : 'linear';

  const update = (id: string, field: keyof StockItem, value: string) => {
    onChange(stock.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const applyBoardType = (id: string, board: BoardType) => {
    onChange(stock.map(s => s.id === id ? {
      ...s,
      length: String(board.length),
      width: String(board.width),
      material: board.code,
    } : s));
  };

  const remove = (id: string) => {
    onChange(stock.filter(s => s.id !== id));
  };

  const add = () => onChange([...stock, newStock()]);

  return (
    <div data-section="stock">
      {/* Board-type picker — spans full width above the table */}
      <div className="px-3 pt-2 pb-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Add board type:</span>
          <BoardTypeSelector
            env="dev"
            type={stockType}
            placeholder="Search i-framer…"
            onSelect={(board) => {
              const existing = stock.find(s => s.material === board.code);
              if (!existing) {
                onChange([...stock.filter(s => s.length || s.material), {
                  id: crypto.randomUUID(),
                  length: String(board.length),
                  width: String(board.width),
                  qty: '1',
                  material: board.code,
                }]);
              }
            }}
          />
        </div>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 80 }}>Length ({ul})</th>
            {mode === 'sheet' && <th style={{ width: 80 }}>Width ({ul})</th>}
            <th style={{ width: 46 }}>Qty</th>
            {showMaterial && <th>Material / Code</th>}
            <th style={{ width: 28 }}></th>
          </tr>
        </thead>
        <tbody>
          {stock.map(s => (
            <tr
              key={s.id}
              data-stock={JSON.stringify({ length: s.length, width: s.width, qty: s.qty, material: s.material })}
            >
              <td>
                <NumericInput
                  className="cell-input"
                  value={s.length}
                  onChange={e => update(s.id, 'length', e.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                />
              </td>
              {mode === 'sheet' && (
                <td>
                  <NumericInput
                    className="cell-input"
                    value={s.width}
                    onChange={e => update(s.id, 'width', e.target.value)}
                    placeholder="0"
                    inputMode="decimal"
                  />
                </td>
              )}
              <td>
                <NumericInput
                  className="cell-input"
                  value={s.qty}
                  onChange={e => update(s.id, 'qty', e.target.value)}
                  placeholder="1"
                  inputMode="numeric"
                />
              </td>
              {showMaterial && (
                <td>
                  <div className="flex items-center gap-1">
                    <input
                      className="cell-input flex-1"
                      value={s.material}
                      onChange={e => update(s.id, 'material', e.target.value)}
                      placeholder="Code"
                    />
                    <BoardTypeSelector
                      env="dev"
                      type={stockType}
                      placeholder="…"
                      onSelect={(board) => applyBoardType(s.id, board)}
                    />
                  </div>
                </td>
              )}
              <td>
                <button
                  onClick={() => remove(s.id)}
                  className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-destructive transition-colors"
                  title="Remove row"
                >
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={add}
        className="flex items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Plus size={13} /> Add row
      </button>
    </div>
  );
}

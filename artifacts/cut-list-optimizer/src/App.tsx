import { useState, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronRight, Play, RotateCcw, Settings, Upload, Folder, ListFilter, Layers } from 'lucide-react';
import type { CutPiece, StockItem, Options, OptimizationResult, Mode } from './types';
import type { Units } from './lib/units';
import { optimizeSheets, optimizeLinear } from './lib/optimizer';
import { convertFieldString } from './lib/units';
import { findOversizePieces } from './lib/oversizeCheck';
import { unitLabel } from './lib/units';
import { PieceTable, StockTable } from './components/InputTable';
import { Toggle } from './components/Toggle';
import { ResultPanel } from './components/ResultPanel';
import { ImportModal } from './components/ImportModal';
import { SavedJobsPanel, type SavedJobFull } from './components/SavedJobsPanel';
import { NumericInput } from './components/NumericInput';
import { isEnteredRow, validateCalculationRows } from './lib/calculationValidation';
import { responseError } from './lib/apiError';
import { BoardManager } from './components/BoardManager';

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';

function makeDefaultPieces(): CutPiece[] {
  return Array.from({ length: 5 }, () => ({
    id: crypto.randomUUID(), length: '', width: '', qty: '1', label: '', material: '', grain: false,
  }));
}

function makeDefaultStock(): StockItem[] {
  return Array.from({ length: 5 }, () => ({
    id: crypto.randomUUID(), length: '', width: '', qty: '1', material: '',
  }));
}

const defaultOptions: Options = {
  kerf: '0',
  labelsOnPanels: false,
  useOneSheet: false,
  considerMaterial: false,
  edgeBanding: false,
  considerGrain: false,
};

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

interface ParseResult<T> {
  value: T;
  repaired: boolean;
}

function parseSavedPieces(raw: unknown): ParseResult<CutPiece[]> {
  if (!Array.isArray(raw)) return { value: makeDefaultPieces(), repaired: true };
  let repaired = false;
  const objects = raw.filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null);
  if (objects.length !== raw.length) repaired = true;
  const pieces = objects.map((p) => {
    if (
      !(typeof p.id === 'string' && p.id !== '') ||
      typeof p.length !== 'string' ||
      typeof p.width !== 'string' ||
      typeof p.qty !== 'string' ||
      typeof p.label !== 'string' ||
      typeof p.material !== 'string' ||
      typeof p.grain !== 'boolean'
    ) {
      repaired = true;
    }
    return {
      id: typeof p.id === 'string' && p.id !== '' ? p.id : crypto.randomUUID(),
      length: asString(p.length, ''),
      width: asString(p.width, ''),
      qty: asString(p.qty, '1'),
      label: asString(p.label, ''),
      material: asString(p.material, ''),
      grain: typeof p.grain === 'boolean' ? p.grain : false,
    };
  });
  if (pieces.length === 0) return { value: makeDefaultPieces(), repaired: true };
  return { value: pieces, repaired };
}

function parseSavedStock(raw: unknown): ParseResult<StockItem[]> {
  if (!Array.isArray(raw)) return { value: makeDefaultStock(), repaired: true };
  let repaired = false;
  const objects = raw.filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null);
  if (objects.length !== raw.length) repaired = true;
  const stock = objects.map((s) => {
    if (
      !(typeof s.id === 'string' && s.id !== '') ||
      typeof s.length !== 'string' ||
      typeof s.width !== 'string' ||
      typeof s.qty !== 'string' ||
      typeof s.material !== 'string'
    ) {
      repaired = true;
    }
    return {
      id: typeof s.id === 'string' && s.id !== '' ? s.id : crypto.randomUUID(),
      length: asString(s.length, ''),
      width: asString(s.width, ''),
      qty: asString(s.qty, '1'),
      material: asString(s.material, ''),
    };
  });
  if (stock.length === 0) return { value: makeDefaultStock(), repaired: true };
  return { value: stock, repaired };
}

function parseSavedMode(raw: unknown): ParseResult<Mode> {
  return raw === 'sheet' || raw === 'linear'
    ? { value: raw, repaired: false }
    : { value: 'sheet', repaired: true };
}

function parseSavedUnits(raw: unknown): ParseResult<Units> {
  return raw === 'metric' || raw === 'imperial'
    ? { value: raw, repaired: false }
    : { value: 'metric', repaired: true };
}

function parseSavedOptions(rawInput: Record<string, unknown> | unknown): ParseResult<Options> {
  const isObject = typeof rawInput === 'object' && rawInput !== null && !Array.isArray(rawInput);
  const raw: Record<string, unknown> = isObject ? (rawInput as Record<string, unknown>) : {};
  const repaired =
    !isObject ||
    typeof raw.kerf !== 'string' ||
    typeof raw.labelsOnPanels !== 'boolean' ||
    typeof raw.useOneSheet !== 'boolean' ||
    typeof raw.considerMaterial !== 'boolean' ||
    typeof raw.edgeBanding !== 'boolean' ||
    typeof raw.considerGrain !== 'boolean';
  return {
    value: {
      kerf: typeof raw.kerf === 'string' ? raw.kerf : defaultOptions.kerf,
      labelsOnPanels: typeof raw.labelsOnPanels === 'boolean' ? raw.labelsOnPanels : defaultOptions.labelsOnPanels,
      useOneSheet: typeof raw.useOneSheet === 'boolean' ? raw.useOneSheet : defaultOptions.useOneSheet,
      considerMaterial: typeof raw.considerMaterial === 'boolean' ? raw.considerMaterial : defaultOptions.considerMaterial,
      edgeBanding: typeof raw.edgeBanding === 'boolean' ? raw.edgeBanding : defaultOptions.edgeBanding,
      considerGrain: typeof raw.considerGrain === 'boolean' ? raw.considerGrain : defaultOptions.considerGrain,
    },
    repaired,
  };
}

interface CollapsibleSectionProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function CollapsibleSection({ title, icon, children, defaultOpen = true }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border">
      <button
        className="panel-header w-full"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          {icon && <span className="text-muted-foreground">{icon}</span>}
          <span>{title}</span>
        </div>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

function OptionsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState<Mode>('sheet');
  const [units, setUnits] = useState<Units>('metric');
  const [pieces, setPieces] = useState<CutPiece[]>(makeDefaultPieces);
  const [stock, setStock] = useState<StockItem[]>(makeDefaultStock);
  const [options, setOptions] = useState<Options>(defaultOptions);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repairNotice, setRepairNotice] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showJobs, setShowJobs] = useState(false);
  const [showBoards, setShowBoards] = useState(false);
  const [materialFilter, setMaterialFilter] = useState('');

  const [savedId, setSavedId] = useState<number | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  const setOpt = useCallback(<K extends keyof Options>(key: K, value: Options[K]) => {
    setOptions(o => ({ ...o, [key]: value }));
    setResult(null);
  }, []);

  // Distinct material codes present in the cutting list, with piece counts.
  // A material is "linear" (moulding) when none of its pieces have a width.
  const materialOptions = useMemo(() => {
    const map = new Map<string, { count: number; linear: boolean }>();
    for (const p of pieces) {
      const m = p.material.trim();
      if (!m || p.length.trim() === '') continue;
      const entry = map.get(m) ?? { count: 0, linear: true };
      entry.count += 1;
      if (p.width.trim() !== '') entry.linear = false;
      map.set(m, entry);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [pieces]);

  // Pieces too large to fit on any configured stock board (likely a bad import)
  const oversizeWarnings = useMemo(
    () => findOversizePieces(pieces, stock, units),
    [pieces, stock, units],
  );

  const handleRemoveOversize = useCallback(() => {
    const ids = new Set(oversizeWarnings.map(w => w.pieceId));
    setPieces(prev => prev.filter(p => !ids.has(p.id)));
    setResult(null);
  }, [oversizeWarnings]);

  // Ignore a stale filter if that material no longer exists
  const activeFilter = materialFilter && materialOptions.some(([m]) => m === materialFilter)
    ? materialFilter : '';

  const visiblePieces = useMemo(
    () => activeFilter ? pieces.filter(p => p.material.trim() === activeFilter) : pieces,
    [pieces, activeFilter],
  );
  const visibleStock = useMemo(
    () => activeFilter ? stock.filter(s => s.material.trim() === activeFilter) : stock,
    [stock, activeFilter],
  );
  const calculationIssues = useMemo(
    () => validateCalculationRows(visiblePieces, visibleStock, mode, units),
    [visiblePieces, visibleStock, mode, units],
  );
  const hasPreservedWidths = mode === 'linear' &&
    [...visiblePieces, ...visibleStock].some(row => row.width.trim() !== '');

  // When a filter is active, edits from the tables only cover the visible rows —
  // merge them back into the full list, and give new rows the filtered material
  const handlePiecesChange = useCallback((next: CutPiece[]) => {
    setResult(null);
    setError(null);
    if (!activeFilter) { setPieces(next); return; }
    setPieces(prev => {
      const visibleIds = new Set(prev.filter(p => p.material.trim() === activeFilter).map(p => p.id));
      const merged = next.map(p =>
        visibleIds.has(p.id) ? p : { ...p, material: p.material.trim() || activeFilter },
      );
      return [...prev.filter(p => !visibleIds.has(p.id)), ...merged];
    });
  }, [activeFilter]);

  const handleStockChange = useCallback((next: StockItem[]) => {
    setResult(null);
    setError(null);
    if (!activeFilter) { setStock(next); return; }
    setStock(prev => {
      const visibleIds = new Set(prev.filter(s => s.material.trim() === activeFilter).map(s => s.id));
      const merged = next.map(s =>
        visibleIds.has(s.id) ? s : { ...s, material: s.material.trim() || activeFilter },
      );
      return [...prev.filter(s => !visibleIds.has(s.id)), ...merged];
    });
  }, [activeFilter]);

  const handleFilterChange = useCallback((value: string) => {
    setMaterialFilter(value);
    // Selecting a moulding code switches to Linear mode, a sheet type to Sheets
    if (value) {
      const entry = materialOptions.find(([m]) => m === value);
      if (entry) setMode(entry[1].linear ? 'linear' : 'sheet');
    }
    setResult(null);
    setError(null);
  }, [materialOptions]);

  const handleCalculate = useCallback(() => {
    setError(null);
    setResult(null);
    try {
      if (calculationIssues.length > 0) {
        setError('Calculation blocked: fix the rows listed below. No pieces have been excluded.');
        return;
      }
      if (!Number.isFinite(Number(options.kerf)) || Number(options.kerf) < 0) {
        setError('Enter a kerf of 0 or greater.');
        return;
      }
      // Mixed sheet + moulding items can't be optimized together
      if (!activeFilter) {
        const kinds = new Set(materialOptions.map(([, info]) => info.linear));
        if (kinds.size > 1) {
          setError('Your list mixes sheet and moulding items — pick one item from the "Cutting list item" dropdown before calculating.');
          return;
        }
      }
      const validPieces = visiblePieces.filter(isEnteredRow);
      const validStock = visibleStock.filter(isEnteredRow);

      if (validPieces.length === 0) { setError('Add at least one piece to cut.'); return; }
      if (validStock.length === 0) { setError('Add at least one stock item.'); return; }

      let r: OptimizationResult;
      if (mode === 'sheet') {
        r = optimizeSheets(validPieces, validStock, options, units);
      } else {
        r = optimizeLinear(validPieces, validStock, options, units);
      }
      setResult(r);
    } catch (e) {
      setError('Calculation error: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [visiblePieces, visibleStock, options, mode, units, activeFilter, materialOptions, calculationIssues]);

  const handleReset = useCallback(() => {
    setPieces(makeDefaultPieces());
    setStock(makeDefaultStock());
    setOptions(defaultOptions);
    setResult(null);
    setError(null);
    setRepairNotice(false);
    setSavedId(null);
    setSavedName(null);
    setMaterialFilter('');
  }, []);

  const handleImportConfirm = useCallback((newPieces: CutPiece[], newStockItems: StockItem[]) => {
    setPieces(prev => {
      const empty = prev.filter(p => !p.length && !p.label);
      return [...prev.filter(p => p.length || p.label), ...newPieces, ...Array.from({ length: Math.max(0, empty.length - newPieces.length) }, () => ({ id: crypto.randomUUID(), length: '', width: '', qty: '1', label: '', material: '', grain: false }))];
    });
    if (newStockItems.length > 0) {
      setStock(prev => {
        const nonEmpty = prev.filter(s => s.length || s.material);
        const existingMaterials = new Set(nonEmpty.map(s => s.material));
        const toAdd = newStockItems.filter(s => !existingMaterials.has(s.material));
        return [...nonEmpty, ...toAdd];
      });
    }
    setOptions(o => ({ ...o, considerMaterial: true }));
    setShowImport(false);
    setResult(null);
    setSavedId(null);
    setSavedName(null);
    setMaterialFilter('');
  }, []);

  const handleUnitsChange = useCallback((newUnits: Units) => {
    if (newUnits === units) return;
    setPieces(prev => prev.map(p => ({
      ...p,
      length: convertFieldString(p.length, units, newUnits),
      width: convertFieldString(p.width, units, newUnits),
    })));
    setStock(prev => prev.map(s => ({
      ...s,
      length: convertFieldString(s.length, units, newUnits),
      width: convertFieldString(s.width, units, newUnits),
    })));
    setOptions(o => ({
      ...o,
      kerf: convertFieldString(o.kerf, units, newUnits),
    }));
    setUnits(newUnits);
    setResult(null);
  }, [units]);

  const handleModeChange = useCallback((newMode: Mode) => {
    setMode(newMode);
    setResult(null);
    setError(null);
    setMaterialFilter('');
  }, []);

  const hasCurrentJob = pieces.some(p => p.length.trim() !== '') || stock.some(s => s.length.trim() !== '');

  const handleSaveJob = useCallback(async (name: string) => {
    const body = { name, mode, units, pieces, stock, options };
    const res = await fetch(`${API_BASE}/api/cut-lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await responseError(res, 'Save failed');
    const saved = await res.json();
    setSavedId(saved.id);
    setSavedName(saved.name);
  }, [mode, units, pieces, stock, options]);

  const handleUpdateJob = useCallback(async () => {
    if (savedId === null) return;
    const body = { mode, units, pieces, stock, options };
    const res = await fetch(`${API_BASE}/api/cut-lists/${savedId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await responseError(res, 'Update failed');
  }, [savedId, mode, units, pieces, stock, options]);

  const handleLoadJob = useCallback((job: SavedJobFull) => {
    const piecesResult = parseSavedPieces(job.pieces);
    const stockResult = parseSavedStock(job.stock);
    const optionsResult = parseSavedOptions(job.options);
    const modeResult = parseSavedMode(job.mode);
    const unitsResult = parseSavedUnits(job.units);
    setPieces(piecesResult.value);
    setStock(stockResult.value);
    setOptions(optionsResult.value);
    setMode(modeResult.value);
    setUnits(unitsResult.value);
    setRepairNotice(
      piecesResult.repaired || stockResult.repaired || optionsResult.repaired ||
      modeResult.repaired || unitsResult.repaired
    );
    setResult(null);
    setError(null);
    setSavedId(job.id);
    setSavedName(job.name);
    setMaterialFilter('');
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ fontFamily: 'var(--app-font-sans)' }}>
      {showImport && (
        <ImportModal
          mode={mode}
          onClose={() => setShowImport(false)}
          onConfirm={handleImportConfirm}
        />
      )}
      <BoardManager open={showBoards} onClose={() => setShowBoards(false)} />
      {/* Top bar */}
      <header className="flex items-center justify-between px-3 py-2 bg-gray-800 text-white shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex flex-col gap-0.5">
                {[...Array(3)].map((_, j) => (
                  <div key={j} className="w-1 h-1 rounded-sm bg-green-400" />
                ))}
              </div>
            ))}
          </div>
          <span className="font-semibold text-sm ml-1">CutList Optimizer</span>
          {savedName && (
            <span className="text-xs text-gray-400 ml-1 truncate max-w-[160px]">— {savedName}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex items-center bg-gray-700 rounded p-0.5 text-xs">
            <button
              className={`px-2.5 py-1 rounded transition-colors ${mode === 'sheet' ? 'bg-white text-gray-900 font-medium' : 'text-gray-300 hover:text-white'}`}
              onClick={() => handleModeChange('sheet')}
            >
              Sheets (2D)
            </button>
            <button
              className={`px-2.5 py-1 rounded transition-colors ${mode === 'linear' ? 'bg-white text-gray-900 font-medium' : 'text-gray-300 hover:text-white'}`}
              onClick={() => handleModeChange('linear')}
            >
              Linear (1D)
            </button>
          </div>
          {/* Units toggle */}
          <div className="flex items-center bg-gray-700 rounded p-0.5 text-xs">
            <button
              className={`px-2.5 py-1 rounded transition-colors ${units === 'metric' ? 'bg-white text-gray-900 font-medium' : 'text-gray-300 hover:text-white'}`}
              onClick={() => handleUnitsChange('metric')}
            >
              mm
            </button>
            <button
              className={`px-2.5 py-1 rounded transition-colors ${units === 'imperial' ? 'bg-white text-gray-900 font-medium' : 'text-gray-300 hover:text-white'}`}
              onClick={() => handleUnitsChange('imperial')}
            >
              in
            </button>
          </div>
          <button
            className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded transition-colors ${showJobs ? 'bg-amber-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}`}
            onClick={() => setShowJobs(v => !v)}
            title="Saved jobs"
          >
            <Folder size={13} /> Jobs
          </button>
          <button
            className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded transition-colors ${showBoards ? 'bg-amber-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}`}
            onClick={() => setShowBoards(true)}
            title="Manage boards"
          >
            <Layers size={13} /> Boards
          </button>
          <button
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-3 py-1.5 rounded transition-colors"
            onClick={() => setShowImport(true)}
          >
            <Upload size={13} /> Import
          </button>
          <button
            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 text-white text-sm font-medium px-3 py-1.5 rounded transition-colors"
            onClick={handleCalculate}
          >
            <Play size={13} fill="white" /> Calculate
          </button>
          <button
            className="flex items-center gap-1 text-gray-300 hover:text-white text-sm px-2 py-1.5 rounded transition-colors"
            onClick={handleReset}
            title="Clear all"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </header>

      {/* Saved-job repair notice */}
      {repairNotice && (
        <div
          className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm flex items-start justify-between gap-3"
          data-testid="repair-notice"
        >
          <span>
            Some data in this saved job was invalid and has been reset to defaults — please review the values before calculating.
          </span>
          <button
            className="shrink-0 text-amber-700 hover:text-amber-900 font-medium"
            onClick={() => setRepairNotice(false)}
            aria-label="Dismiss notice"
            data-testid="repair-notice-dismiss"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Error bar */}
      {error && (
        <div role="alert" className="px-4 py-2 bg-red-50 border-b border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {calculationIssues.length > 0 && (
        <div
          role="alert"
          className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-sm max-h-40 overflow-y-auto shrink-0"
          data-testid="calculation-warning"
        >
          <p className="font-medium">Complete these rows before calculating. Your entries are preserved; incomplete rows will not be silently excluded.</p>
          <ul className="list-disc pl-5 mt-1">
            {calculationIssues.map(issue => (
              <li key={issue.key}><strong>{issue.row}:</strong> {issue.message}</li>
            ))}
          </ul>
        </div>
      )}
      {hasPreservedWidths && (
        <div className="px-4 py-2 bg-blue-50 border-b border-blue-200 text-blue-900 text-sm shrink-0" role="status">
          Linear (1D) uses lengths only. Widths are preserved and will reappear when you switch back to Sheets (2D).
        </div>
      )}

      {/* Oversize piece warning */}
      {oversizeWarnings.length > 0 && (
        <div
          className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm"
          data-testid="oversize-warning"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="font-medium">
                {oversizeWarnings.length} piece{oversizeWarnings.length !== 1 ? 's are' : ' is'} larger than any stock board
              </span>
              {' — check for import mistakes (wrong column or units), then fix or remove the row'}
              {oversizeWarnings.length !== 1 ? 's' : ''}:
              <span className="ml-1">
                {oversizeWarnings.slice(0, 6).map((w, i) => (
                  <span key={w.pieceId}>
                    {i > 0 && ', '}
                    <strong>{w.label || 'Unlabelled piece'}</strong>
                    {' ('}
                    {w.length}
                    {w.width > 0 ? ` × ${w.width}` : ''} {unitLabel(units)}
                    {w.material ? `, ${w.material}` : ''}
                    {')'}
                  </span>
                ))}
                {oversizeWarnings.length > 6 && ` and ${oversizeWarnings.length - 6} more`}
              </span>
            </div>
            <button
              className="shrink-0 text-xs font-medium text-amber-700 border border-amber-300 rounded px-2 py-1 hover:bg-amber-100 transition-colors"
              onClick={handleRemoveOversize}
              data-testid="remove-oversize"
            >
              Remove flagged piece{oversizeWarnings.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="w-[360px] shrink-0 border-r border-border bg-card overflow-y-auto flex flex-col">
          {materialOptions.length > 0 && (
            <div className="px-3 py-2 border-b border-border bg-muted/40">
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
                <ListFilter size={12} /> Cutting list item
              </label>
              <select
                className="w-full px-2 py-1.5 text-sm border border-input rounded bg-background"
                value={activeFilter}
                onChange={e => handleFilterChange(e.target.value)}
                data-testid="material-filter"
              >
                <option value="">All items ({pieces.filter(p => p.length.trim() !== '').length} pieces)</option>
                {materialOptions.map(([m, info]) => (
                  <option key={m} value={m}>
                    {m} — {info.linear ? 'moulding' : 'sheet'} ({info.count} {info.count === 1 ? 'piece' : 'pieces'})
                  </option>
                ))}
              </select>
            </div>
          )}
          <CollapsibleSection
            title={mode === 'sheet' ? 'Panels' : 'Pieces to cut'}
            icon={<span className="inline-block w-3 h-3 rounded-sm bg-blue-400 opacity-80" />}
          >
            <PieceTable
              mode={mode}
              units={units}
              pieces={visiblePieces}
              showMaterial={options.considerMaterial}
              onChange={handlePiecesChange}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title={mode === 'sheet' ? 'Stock sheets' : 'Stock bars'}
            icon={<span className="inline-block w-3 h-3 rounded-sm border-2 border-muted-foreground opacity-60" />}
          >
            <StockTable
              mode={mode}
              units={units}
              stock={visibleStock}
              showMaterial={options.considerMaterial}
              onChange={handleStockChange}
            />
          </CollapsibleSection>

          <CollapsibleSection title="Options" icon={<Settings size={12} />}>
            <div className="py-1">
              <OptionsRow label="Cut / blade / kerf thickness">
                <NumericInput
                  type="number"
                  aria-label="Cut / blade / kerf thickness"
                  min="0"
                  step="0.1"
                  className="w-16 px-2 py-1 text-sm border border-input rounded bg-background text-right"
                  value={options.kerf}
                  onChange={e => setOpt('kerf', e.target.value)}
                />
              </OptionsRow>
              <OptionsRow label="Labels on panels">
                <Toggle checked={options.labelsOnPanels} onChange={v => setOpt('labelsOnPanels', v)} />
              </OptionsRow>
              <OptionsRow label={`Use only one ${mode === 'sheet' ? 'sheet' : 'bar'} from stock`}>
                <Toggle checked={options.useOneSheet} onChange={v => setOpt('useOneSheet', v)} />
              </OptionsRow>
              <OptionsRow label="Consider material">
                <Toggle checked={options.considerMaterial} onChange={v => setOpt('considerMaterial', v)} />
              </OptionsRow>
              {mode === 'sheet' && (
                <>
                  <OptionsRow label="Edge banding">
                    <Toggle checked={options.edgeBanding} onChange={v => setOpt('edgeBanding', v)} />
                  </OptionsRow>
                  <OptionsRow label="Consider grain direction">
                    <Toggle checked={options.considerGrain} onChange={v => setOpt('considerGrain', v)} />
                  </OptionsRow>
                </>
              )}
            </div>
          </CollapsibleSection>

          {/* Quick-start hint */}
          {!result && (
            <div className="mt-auto px-3 py-3 text-xs text-muted-foreground border-t border-border">
              <p className="font-medium mb-1">Quick start</p>
              <p>1. Enter the pieces you need to cut (length × width × qty)</p>
              <p>2. Enter your available stock material (length × width × qty)</p>
              <p>3. Set kerf thickness if needed, then click <strong>Calculate</strong></p>
            </div>
          )}
        </aside>

        {/* Jobs sidebar */}
        {showJobs && (
          <aside className="w-[280px] shrink-0 border-r border-border bg-card flex flex-col overflow-hidden">
            <div className="panel-header border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <Folder size={12} className="text-muted-foreground" />
                <span>Saved Jobs</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SavedJobsPanel
                onLoad={handleLoadJob}
                currentName={savedName}
                onSave={handleSaveJob}
                onUpdate={handleUpdateJob}
                hasCurrentJob={hasCurrentJob}
                savedId={savedId}
              />
            </div>
          </aside>
        )}

        {/* Right panel */}
        <main className="flex-1 overflow-hidden flex flex-col">
          <ResultPanel
            result={result}
            units={units}
            showLabels={options.labelsOnPanels}
          />
        </main>
      </div>
    </div>
  );
}

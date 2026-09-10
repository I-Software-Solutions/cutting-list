import type {
  CutPiece,
  StockItem,
  Options,
  PlacedPiece,
  UsedSheet,
  UsedBar,
  SheetOptimizationResult,
  LinearOptimizationResult,
  GuillotineCutStep,
} from '../types';
import { parseValue } from './units';
import type { Units } from './units';

const PIECE_COLORS = [
  '#4e9af1', '#f47c7c', '#6dc06d', '#f0b429', '#a78bfa',
  '#f97316', '#14b8a6', '#ec4899', '#84cc16', '#06b6d4',
  '#8b5cf6', '#ef4444', '#10b981', '#f59e0b', '#3b82f6',
  '#d946ef', '#0ea5e9', '#22c55e', '#fb923c', '#e879f9',
];

interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Returns true if the piece can fit (in either orientation) on a fresh sheet of given dimensions */
function canFitOnSheet(
  sw: number,
  sh: number,
  pw: number,
  ph: number,
  canRotate: boolean,
): boolean {
  const normalFit = sw >= pw && sh >= ph;
  const rotatedFit = canRotate && sw >= ph && sh >= pw;
  return normalFit || rotatedFit;
}

interface SearchLeaf extends FreeRect {}
interface SearchSheet extends UsedSheet {
  leaves: SearchLeaf[];
}
interface SearchState {
  remaining: number[];
  sheets: SearchSheet[];
  stockRemaining: number[];
}

interface ExpandedSheetPiece {
  piece: CutPiece;
  idx: number;
  colorIdx: number;
  w: number;
  h: number;
}

function optimizeSheetsGreedy(
  pieces: CutPiece[], stock: StockItem[], options: Options, units: Units,
): SheetOptimizationResult {
  const kerf = parseValue(options.kerf, units);
  const eps: Array<{ piece: CutPiece; idx: number; colorIdx: number; w: number; h: number }> = [];
  let color = 0;
  for (const piece of pieces) {
    const qty = Math.max(1, parseInt(piece.qty) || 1);
    for (let idx = 0; idx < qty; idx++) {
      const w = parseValue(piece.length, units), h = parseValue(piece.width, units);
      eps.push({ piece, idx, colorIdx: color % PIECE_COLORS.length, w, h });
    }
    color++;
  }
  eps.sort((a, b) => b.w * b.h - a.w * a.h || a.piece.id.localeCompare(b.piece.id));
  const remain = stock.map(s => Math.max(1, parseInt(s.qty) || 1));
  const sheets: SearchSheet[] = [];
  const unplaced: typeof eps = [];
  for (const ep of eps) {
    let placed = false;
    const rotates = (!options.considerGrain || !ep.piece.grain) && ep.w !== ep.h;
    const orientations = rotates ? [[ep.w, ep.h, false], [ep.h, ep.w, true]] as Array<[number, number, boolean]> : [[ep.w, ep.h, false]] as Array<[number, number, boolean]>;
    for (let si = 0; si < sheets.length && !placed; si++) {
      if (options.considerMaterial && sheets[si].material !== ep.piece.material) continue;
      for (const [pw, ph, rot] of orientations) for (let li = 0; li < sheets[si].leaves.length && !placed; li++) {
        for (const topology of [0, 1] as const) {
          const candidate = { ...sheets[si], pieces: sheets[si].pieces.map(p => ({ ...p })), leaves: sheets[si].leaves.map(r => ({ ...r })), cutSequence: sheets[si].cutSequence.map(c => ({ ...c })) };
          if (placeSearch(candidate, li, ep, pw, ph, rot, kerf, topology)) {
            sheets[si] = candidate;
            placed = true;
            break;
          }
        }
      }
    }
    if (!placed && !(options.useOneSheet && sheets.length)) {
      for (let stockIndex = 0; stockIndex < stock.length && !placed; stockIndex++) {
        const item = stock[stockIndex], sw = parseValue(item.length, units), sh = parseValue(item.width, units);
        if (!remain[stockIndex] || (options.considerMaterial && item.material !== ep.piece.material)) continue;
        for (const [pw, ph, rot] of orientations) for (const topology of [0, 1] as const) {
          const candidate: SearchSheet = { stockId: item.id, stockIndex, sheetNum: sheets.length + 1, stockW: sw, stockH: sh, pieces: [], wastePercent: 0, material: item.material, cutSequence: [], leaves: [{ x: 0, y: 0, w: sw, h: sh }] };
          if (placeSearch(candidate, -1, ep, pw, ph, rot, kerf, topology)) { sheets.push(candidate); remain[stockIndex]--; placed = true; break; }
        }
      }
    }
    if (!placed) unplaced.push(ep);
  }
  const output = sheets.map(({ leaves: _leaves, ...sheet }) => {
    const area = sheet.stockW * sheet.stockH, used = sheet.pieces.reduce((n, p) => n + p.w * p.h, 0);
    return { ...sheet, wastePercent: area ? ((area - used) / area) * 100 : 0 };
  });
  const total = output.reduce((n, s) => n + s.stockW * s.stockH, 0);
  const used = output.reduce((n, s) => n + s.pieces.reduce((a, p) => a + p.w * p.h, 0), 0);
  return { mode: 'sheet', sheets: output, totalSheets: output.length, totalWastePercent: total ? ((total - used) / total) * 100 : 0, unplacedCount: unplaced.length };
}

const SEARCH_BEAM_WIDTH = 512;
const SEARCH_BUDGET = 200000;

function pieceOrders(expanded: ExpandedSheetPiece[]): number[][] {
  const indices = expanded.map((_, index) => index);
  const stable = (compare: (a: ExpandedSheetPiece, b: ExpandedSheetPiece) => number) =>
    indices.slice().sort((ai, bi) =>
      compare(expanded[ai], expanded[bi]) ||
      expanded[ai].piece.id.localeCompare(expanded[bi].piece.id) ||
      expanded[ai].idx - expanded[bi].idx);
  const orders = [
    stable((a, b) => b.w * b.h - a.w * a.h),
    stable((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || Math.min(b.w, b.h) - Math.min(a.w, a.h)),
    stable((a, b) => b.w - a.w || b.h - a.h),
    stable((a, b) => b.h - a.h || b.w - a.w),
    stable((a, b) => (b.w + b.h) - (a.w + a.h) || b.w * b.h - a.w * a.h),
  ];
  const seen = new Set<string>();
  return orders.filter(order => {
    const key = order.join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Bounded guillotine beam search.  Every placement replaces one leaf with the
 * two children of a straight cut pair, so the emitted sequence is always a
 * realizable guillotine plan (rather than merely a visual packing).
 */
export function optimizeSheets(
  pieces: CutPiece[],
  stock: StockItem[],
  options: Options,
  units: Units,
): SheetOptimizationResult {
  const kerf = parseValue(options.kerf, units);
  const expanded: ExpandedSheetPiece[] = [];
  let invalidPiece = false;
  let color = 0;
  for (const piece of pieces) {
    const qty = Math.max(1, parseInt(piece.qty) || 1);
    for (let idx = 0; idx < qty; idx++) {
      const w = parseValue(piece.length, units);
      const h = parseValue(piece.width, units);
      if (!(w > 0 && h > 0)) invalidPiece = true;
      if (w > 0 && h > 0) expanded.push({ piece, idx, colorIdx: color % PIECE_COLORS.length, w, h });
    }
    color++;
  }
  const stockValues = stock.map(item => ({
    item,
    qty: Math.max(1, parseInt(item.qty) || 1),
    w: parseValue(item.length, units),
    h: parseValue(item.width, units),
  }));
  if (!expanded.length || invalidPiece) return optimizeSheetsGreedy(pieces, stock, options, units);

  let beam: SearchState[] = pieceOrders(expanded).map(remaining => ({
    remaining,
    sheets: [],
    stockRemaining: stockValues.map(s => s.qty),
  }));
  let operations = 0;
  const completed: SearchState[] = [];

  const score = (s: SearchState) => {
    const area = s.sheets.reduce((n, sh) => n + sh.pieces.reduce((a, p) => a + p.w * p.h, 0), 0);
    const stockArea = s.sheets.reduce((n, sh) => n + sh.stockW * sh.stockH, 0);
    return s.sheets.length * 1e12 + (stockArea - area) * 100 + s.sheets.reduce((n, sh) => n + sh.cutSequence.length, 0);
  };
  const cloneSheet = (s: SearchSheet): SearchSheet => ({
    ...s,
    pieces: s.pieces.map(p => ({ ...p })),
    leaves: s.leaves.map(r => ({ ...r })),
    cutSequence: s.cutSequence.map(c => ({ ...c })),
  });

  while (beam.length && operations < SEARCH_BUDGET) {
    const next: SearchState[] = [];
    for (const state of beam) {
      if (!state.remaining.length) { completed.push(state); continue; }
      // Each seed has a different deterministic piece order. Search still
      // branches over every leaf, orientation, and guillotine topology.
      const choices = state.remaining.slice(0, 1);
      for (const pieceIndex of choices) {
        const ep = expanded[pieceIndex];
        const canRotate = !options.considerGrain || !ep.piece.grain;
        const orientations = canRotate && ep.w !== ep.h
          ? [[ep.w, ep.h, false], [ep.h, ep.w, true]] as Array<[number, number, boolean]>
          : [[ep.w, ep.h, false]] as Array<[number, number, boolean]>;
        for (const [pw, ph, rotated] of orientations) {
          for (let si = 0; si < state.sheets.length + 1; si++) {
            if (si === state.sheets.length) {
              if (options.useOneSheet && state.sheets.length) continue;
              for (let stockIndex = 0; stockIndex < stockValues.length; stockIndex++) {
                const sv = stockValues[stockIndex];
                if (!state.stockRemaining[stockIndex] || (options.considerMaterial && sv.item.material !== ep.piece.material)) continue;
                if (!canFitOnSheet(sv.w, sv.h, pw, ph, false)) continue;
                const sh: SearchSheet = {
                  stockId: sv.item.id, stockIndex, sheetNum: state.sheets.length + 1,
                  stockW: sv.w, stockH: sv.h, pieces: [], wastePercent: 0,
                  material: sv.item.material, cutSequence: [],
                  leaves: [{ x: 0, y: 0, w: sv.w, h: sv.h }],
                };
                for (const topology of [0, 1] as const) {
                  if (++operations > SEARCH_BUDGET) break;
                  const candidate = cloneSheet(sh);
                  if (!placeSearch(candidate, -1, ep, pw, ph, rotated, kerf, topology)) continue;
                  const ns: SearchState = { remaining: state.remaining.filter(i => i !== pieceIndex), sheets: state.sheets.map(cloneSheet).concat(candidate), stockRemaining: state.stockRemaining.slice() };
                  ns.stockRemaining[stockIndex]--;
                  if (!ns.remaining.length) completed.push(ns);
                  else next.push(ns);
                }
              }
            } else {
              if (options.considerMaterial && state.sheets[si].material !== ep.piece.material) continue;
              for (let li = 0; li < state.sheets[si].leaves.length; li++) {
                for (const topology of [0, 1] as const) {
                  if (++operations > SEARCH_BUDGET) break;
                  const candidate = cloneSheet(state.sheets[si]);
                  if (!placeSearch(candidate, li, ep, pw, ph, rotated, kerf, topology)) continue;
                  const ns: SearchState = { remaining: state.remaining.filter(i => i !== pieceIndex), sheets: state.sheets.map((v, j) => j === si ? candidate : cloneSheet(v)), stockRemaining: state.stockRemaining.slice() };
                  if (!ns.remaining.length) completed.push(ns);
                  else next.push(ns);
                }
                if (operations > SEARCH_BUDGET) break;
              }
            }
            if (operations > SEARCH_BUDGET) break;
          }
          if (operations > SEARCH_BUDGET) break;
        }
        if (operations > SEARCH_BUDGET) break;
      }
      if (operations > SEARCH_BUDGET) break;
    }
    // All states in a generation have placed the same number of pieces, so
    // finish the generation before comparing completed layouts from each order.
    if (completed.length) break;
    next.sort((a, b) => score(a) - score(b));
    beam = next.slice(0, SEARCH_BEAM_WIDTH);
  }
  if (!completed.length) return optimizeSheetsGreedy(pieces, stock, options, units);
  const objective = (s: SearchState) => {
    const area = s.sheets.reduce((n, sh) => n + sh.stockW * sh.stockH, 0);
    const cuts = s.sheets.reduce((n, sh) => n + sh.cutSequence.length, 0);
    return [s.sheets.length, area, cuts, s.sheets.map(sh => sh.stockIndex).join(',')];
  };
  completed.sort((a, b) => {
    const aa = objective(a), bb = objective(b);
    for (let i = 0; i < aa.length; i++) {
      if (aa[i] < bb[i]) return -1;
      if (aa[i] > bb[i]) return 1;
    }
    return 0;
  });
  const chosen = completed[0];
  const resultSheets: UsedSheet[] = chosen.sheets.map(({ leaves: _leaves, ...sheet }) => {
    const sh = sheet;
    const area = sh.stockW * sh.stockH;
    const used = sh.pieces.reduce((n, p) => n + p.w * p.h, 0);
    sh.wastePercent = area ? ((area - used) / area) * 100 : 0;
    return sh;
  });
  const totalArea = resultSheets.reduce((n, s) => n + s.stockW * s.stockH, 0);
  const usedArea = resultSheets.reduce((n, s) => n + s.pieces.reduce((a, p) => a + p.w * p.h, 0), 0);
  return { mode: 'sheet', sheets: resultSheets, totalSheets: resultSheets.length, totalWastePercent: totalArea ? ((totalArea - usedArea) / totalArea) * 100 : 0, unplacedCount: 0 };
}

function placeSearch(
  sheet: SearchSheet, leafIndex: number, ep: { piece: CutPiece; idx: number; colorIdx: number; w: number; h: number },
  pw: number, ph: number, rotated: boolean, kerf: number, topology: 0 | 1,
): boolean {
  const leaf = leafIndex < 0 ? sheet.leaves[0] : sheet.leaves[leafIndex];
  if (!leaf || leaf.w < pw || leaf.h < ph) return false;
  const placed: PlacedPiece = { pieceId: ep.piece.id, pieceIndex: ep.idx, x: leaf.x, y: leaf.y, w: pw, h: ph, rotated, label: ep.piece.label || `${pw}×${ph}`, color: PIECE_COLORS[ep.colorIdx], originalW: ep.w, originalH: ep.h };
  sheet.pieces.push(placed);
  const rightRoom = leaf.w - pw;
  const bottomRoom = leaf.h - ph;
  if (rightRoom > 0 && rightRoom < kerf) return false;
  if (bottomRoom > 0 && bottomRoom < kerf) return false;
  const right = topology === 0
    ? { x: leaf.x + pw + (rightRoom > 0 ? kerf : 0), y: leaf.y, w: Math.max(0, rightRoom - (rightRoom > 0 ? kerf : 0)), h: ph }
    : { x: leaf.x + pw + (rightRoom > 0 ? kerf : 0), y: leaf.y, w: Math.max(0, rightRoom - (rightRoom > 0 ? kerf : 0)), h: leaf.h };
  const bottom = topology === 0
    ? { x: leaf.x, y: leaf.y + ph + (bottomRoom > 0 ? kerf : 0), w: leaf.w, h: Math.max(0, bottomRoom - (bottomRoom > 0 ? kerf : 0)) }
    : { x: leaf.x, y: leaf.y + ph + (bottomRoom > 0 ? kerf : 0), w: pw, h: Math.max(0, bottomRoom - (bottomRoom > 0 ? kerf : 0)) };
  const children = [right, bottom].filter(r => r.w > 0 && r.h > 0);
  sheet.leaves.splice(leafIndex < 0 ? 0 : leafIndex, 1, ...children);
  const addCut = (orientation: 'horizontal' | 'vertical', x: number, y: number, x2: number, y2: number) => {
    const span = orientation === 'horizontal' ? Math.abs(x2 - x) : Math.abs(y2 - y);
    sheet.cutSequence.push({ number: sheet.cutSequence.length + 1, orientation, x, y, x2, y2, span, description: `Cut ${orientation} from (${x}, ${y}) to (${x2}, ${y2})` });
  };
  // The first cut is the parent separation; the second (when needed) is a
  // child cut.  Zero-width remnants are not cuts.
  if (topology === 0) {
    if (bottomRoom > 0) addCut('horizontal', leaf.x, leaf.y + ph, leaf.x + leaf.w, leaf.y + ph);
    if (rightRoom > 0) addCut('vertical', leaf.x + pw, leaf.y, leaf.x + pw, leaf.y + ph);
  } else {
    if (rightRoom > 0) addCut('vertical', leaf.x + pw, leaf.y, leaf.x + pw, leaf.y + leaf.h);
    if (bottomRoom > 0) addCut('horizontal', leaf.x, leaf.y + ph, leaf.x + pw, leaf.y + ph);
  }
  return true;
}

export function optimizeLinear(
  pieces: CutPiece[],
  stock: StockItem[],
  options: Options,
  units: Units,
): LinearOptimizationResult {
  const kerf = parseValue(options.kerf, units);

  const expandedPieces: Array<{ piece: CutPiece; idx: number; colorIdx: number }> = [];
  let colorCounter = 0;
  for (const piece of pieces) {
    const qty = Math.max(1, parseInt(piece.qty) || 1);
    for (let i = 0; i < qty; i++) {
      expandedPieces.push({ piece, idx: i, colorIdx: colorCounter % PIECE_COLORS.length });
    }
    colorCounter++;
  }

  expandedPieces.sort((a, b) =>
    parseValue(b.piece.length, units) - parseValue(a.piece.length, units),
  );

  const expandedStock: Array<{ item: StockItem; remaining: number }> = [];
  for (const item of stock) {
    const qty = Math.max(1, parseInt(item.qty) || 1);
    expandedStock.push({ item, remaining: qty });
  }

  const usedBars: UsedBar[] = [];
  const barRemaining: number[] = [];
  const unplaced: typeof expandedPieces = [];

  for (const ep of expandedPieces) {
    const pLen = parseValue(ep.piece.length, units);
    if (!pLen) continue;

    let wasPlaced = false;

    // Try packing into an existing open bar
    if (!options.useOneSheet) {
      for (let bi = 0; bi < usedBars.length; bi++) {
        if (options.considerMaterial && usedBars[bi].material !== ep.piece.material) continue;
        const needed = pLen + (usedBars[bi].segments.length > 0 ? kerf : 0);
        if (barRemaining[bi] >= needed) {
          barRemaining[bi] -= needed;
          usedBars[bi].segments.push({
            pieceId: ep.piece.id,
            pieceIndex: ep.idx,
            length: pLen,
            label: ep.piece.label || `${pLen}`,
            color: PIECE_COLORS[ep.colorIdx],
          });
          wasPlaced = true;
          break;
        }
      }
    }

    // Open a new bar from stock
    if (!wasPlaced) {
      for (let stockIdx = 0; stockIdx < expandedStock.length; stockIdx++) {
        if (expandedStock[stockIdx].remaining <= 0) continue;
        if (options.considerMaterial && expandedStock[stockIdx].item.material !== ep.piece.material) continue;
        const sLen = parseValue(expandedStock[stockIdx].item.length, units);
        if (sLen < pLen) continue;

        expandedStock[stockIdx].remaining--;
        const bar: UsedBar = {
          stockId: expandedStock[stockIdx].item.id,
          stockIndex: stockIdx,
          barNum: usedBars.length + 1,
          stockLength: sLen,
          segments: [],
          wasteLength: 0,
          wastePercent: 0,
          material: expandedStock[stockIdx].item.material,
        };
        usedBars.push(bar);
        barRemaining.push(sLen);

        const bi = usedBars.length - 1;
        barRemaining[bi] -= pLen;
        usedBars[bi].segments.push({
          pieceId: ep.piece.id,
          pieceIndex: ep.idx,
          length: pLen,
          label: ep.piece.label || `${pLen}`,
          color: PIECE_COLORS[ep.colorIdx],
        });
        wasPlaced = true;
        break;
      }
    }

    if (!wasPlaced) unplaced.push(ep);
  }

  for (let i = 0; i < usedBars.length; i++) {
    usedBars[i].wasteLength = Math.max(0, barRemaining[i]);
    usedBars[i].wastePercent = usedBars[i].stockLength > 0
      ? (usedBars[i].wasteLength / usedBars[i].stockLength) * 100
      : 0;
  }

  const totalLen = usedBars.reduce((s, b) => s + b.stockLength, 0);
  const wasteLen = usedBars.reduce((s, b) => s + b.wasteLength, 0);

  return {
    mode: 'linear',
    bars: usedBars,
    totalBars: usedBars.length,
    totalWastePercent: totalLen > 0 ? (wasteLen / totalLen) * 100 : 0,
    unplacedCount: unplaced.length,
  };
}

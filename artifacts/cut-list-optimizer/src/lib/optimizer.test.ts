import {
  optimizeSheets,
  retainBeamByOrder,
  type SheetSearchDiagnostics,
} from './optimizer';
import type { CutPiece, Options, StockItem } from '../types';

const LARGE_JOB_MAX_OPERATIONS = 200_000;

function test(name: string, fn: () => void) {
  try { fn(); console.log(`✓ ${name}`); } catch (e) {
    console.error(`✗ ${name}`, e); process.exitCode = 1;
  }
}
const options = (extra: Partial<Options> = {}): Options => ({
  kerf: '0', labelsOnPanels: false, useOneSheet: false, considerMaterial: false,
  edgeBanding: false, considerGrain: false, ...extra,
});
const p = (id: string, length: string, width: string, qty = '1', grain = false, material = ''): CutPiece =>
  { return { id, length, width, qty, label: id, material, grain }; };
const s = (id: string, length: string, width: string, qty = '1', material = ''): StockItem =>
  { return { id, length, width, qty, material }; };
const result = (pieces: CutPiece[], stock: StockItem[], o = options()) =>
  optimizeSheets(pieces, stock, o, 'metric');

function diagnosticResult(pieces: CutPiece[], stock: StockItem[], o = options()) {
  const diagnostics: SheetSearchDiagnostics = {
    operations: -1,
    operationBudget: -1,
    usedGreedyFallback: false,
  };
  const optimization = optimizeSheets(pieces, stock, o, 'metric', diagnostics);
  return { optimization, diagnostics };
}

function stableSnapshot(r: ReturnType<typeof result>) {
  return JSON.stringify({
    totalSheets: r.totalSheets,
    totalWastePercent: r.totalWastePercent,
    unplacedCount: r.unplacedCount,
    sheets: r.sheets.map(sheet => ({
      stockId: sheet.stockId,
      material: sheet.material,
      pieces: sheet.pieces.map(piece => ({
        pieceId: piece.pieceId,
        pieceIndex: piece.pieceIndex,
        x: piece.x,
        y: piece.y,
        w: piece.w,
        h: piece.h,
        rotated: piece.rotated,
      })),
    })),
  });
}

function assertLargeJobRegression(
  pieces: CutPiece[],
  stock: StockItem[],
  o: Options,
) {
  const first = diagnosticResult(pieces, stock, o);
  const second = diagnosticResult(pieces, stock, o);
  if (stableSnapshot(first.optimization) !== stableSnapshot(second.optimization)) {
    throw new Error('large-job result changed between identical runs');
  }
  if (first.diagnostics.operations !== second.diagnostics.operations) {
    throw new Error('large-job operation count changed between identical runs');
  }
  if (first.diagnostics.operationBudget !== LARGE_JOB_MAX_OPERATIONS) {
    throw new Error(`search budget changed from regression limit: ${first.diagnostics.operationBudget}`);
  }
  if (first.diagnostics.operations > LARGE_JOB_MAX_OPERATIONS) {
    throw new Error(`search exceeded budget: ${first.diagnostics.operations}`);
  }
  if (
    first.diagnostics.usedGreedyFallback &&
    first.diagnostics.operations !== LARGE_JOB_MAX_OPERATIONS
  ) {
    throw new Error(`search fell back before exhausting its budget: ${first.diagnostics.operations}`);
  }
  assertLayout(first.optimization);
}

function assertLayout(r: ReturnType<typeof result>, count = r.sheets.reduce((n, s) => n + s.pieces.length, 0)) {
  if (r.unplacedCount !== 0 || count === 0) throw new Error(`unplaced=${r.unplacedCount}`);
  for (const sh of r.sheets) for (let i = 0; i < sh.pieces.length; i++) {
    const a = sh.pieces[i];
    if (a.x < 0 || a.y < 0 || a.x + a.w > sh.stockW || a.y + a.h > sh.stockH) throw new Error('out of bounds');
    for (let j = i + 1; j < sh.pieces.length; j++) {
      const b = sh.pieces[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) throw new Error('overlap');
    }
  }
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-7;

function assertExecutableCutPlan(r: ReturnType<typeof result>, kerf: number) {
  for (const sheet of r.sheets) {
    let live: Rect[] = [{ x: 0, y: 0, w: sheet.stockW, h: sheet.stockH }];

    sheet.cutSequence.forEach((cut, index) => {
      if (cut.number !== index + 1) throw new Error(`cut ${cut.number} is out of order`);
      const matches = live
        .map((rect, rectIndex) => ({ rect, rectIndex }))
        .filter(({ rect }) => cut.orientation === 'horizontal'
          ? close(cut.x, rect.x) &&
            close(cut.x2, rect.x + rect.w) &&
            close(cut.y, cut.y2) &&
            cut.y > rect.y &&
            cut.y < rect.y + rect.h
          : close(cut.y, rect.y) &&
            close(cut.y2, rect.y + rect.h) &&
            close(cut.x, cut.x2) &&
            cut.x > rect.x &&
            cut.x < rect.x + rect.w);

      if (matches.length !== 1) {
        throw new Error(`cut ${cut.number} must span exactly one live workpiece; matched ${matches.length}`);
      }

      const { rect, rectIndex } = matches[0];
      const children = cut.orientation === 'horizontal'
        ? [
            { x: rect.x, y: rect.y, w: rect.w, h: cut.y - rect.y },
            { x: rect.x, y: cut.y + kerf, w: rect.w, h: rect.y + rect.h - cut.y - kerf },
          ]
        : [
            { x: rect.x, y: rect.y, w: cut.x - rect.x, h: rect.h },
            { x: cut.x + kerf, y: rect.y, w: rect.x + rect.w - cut.x - kerf, h: rect.h },
          ];
      if (children.some(child => child.w < -1e-7 || child.h < -1e-7)) {
        throw new Error(`cut ${cut.number} consumes more material than its workpiece`);
      }
      live.splice(rectIndex, 1, ...children.filter(child => child.w > 1e-7 && child.h > 1e-7));
    });

    const matchedRegions = new Set<number>();
    for (const piece of sheet.pieces) {
      const regionIndex = live.findIndex((rect, index) =>
        !matchedRegions.has(index) &&
        close(rect.x, piece.x) &&
        close(rect.y, piece.y) &&
        close(rect.w, piece.w) &&
        close(rect.h, piece.h));
      if (regionIndex < 0) {
        throw new Error(`piece ${piece.pieceId}[${piece.pieceIndex}] was not isolated by the cut sequence`);
      }
      matchedRegions.add(regionIndex);
    }
  }
}

test('regression job fits one board', () => {
  const r = result([
    p('a', '300', '500', '2'), p('b', '600', '800'), p('c', '250', '250', '3'), p('d', '400', '900'),
  ], [s('board', '1520', '1020')], options());
  if (r.totalSheets !== 1) throw new Error(`expected one sheet, got ${r.totalSheets}`);
  assertLayout(r, 7);
  const usedArea = r.sheets[0].pieces.reduce((n, piece) => n + piece.w * piece.h, 0);
  if (usedArea !== 1327500 || Math.abs(r.totalWastePercent - 14.38) > 0.02) throw new Error('wrong area/waste');
  assertExecutableCutPlan(r, 0);
});
test('is deterministic and respects stock quantity', () => {
  const pieces = [p('a', '700', '700', '2')];
  const stock = [s('x', '800', '800', '1')];
  const a = result(pieces, stock), b = result(pieces, stock);
  if (JSON.stringify(a) !== JSON.stringify(b) || a.unplacedCount !== 1) throw new Error('nondeterministic/stock');
});
test('kerf and material are respected', () => {
  if (result([p('a', '500', '500', '2')], [s('x', '500', '500')], options({ kerf: '1' })).unplacedCount !== 1) throw new Error('kerf');
  if (result([p('a', '600', '600', '1', false, 'PLY')], [s('x', '700', '700', '1', 'MDF')], options({ considerMaterial: true })).unplacedCount !== 1) throw new Error('material');
});
test('grain locks only grain-marked pieces', () => {
  if (result([p('free', '700', '500')], [s('x', '500', '700')], options({ considerGrain: true })).unplacedCount !== 0) throw new Error('free piece rotated incorrectly');
  if (result([p('grain', '700', '500', '1', true)], [s('x', '500', '700')], options({ considerGrain: true })).unplacedCount !== 1) throw new Error('grain rotated');
});
test('useOneSheet is a hard maximum', () => {
  const r = result([p('a', '700', '700', '2')], [s('x', '700', '700', '2')], options({ useOneSheet: true }));
  if (r.totalSheets > 1 || r.unplacedCount !== 1) throw new Error('useOneSheet');
});
test('one-sheet completion beats an earlier two-sheet completion', () => {
  const r = result([p('a', '400', '400', '2')], [s('x', '800', '400', '2')], options());
  if (r.totalSheets !== 1 || r.unplacedCount !== 0) throw new Error('did not minimize sheets');
});
test('alternate piece order can reduce the required sheet count', () => {
  const r = result([
    p('a', '100', '100'),
    p('b', '350', '200'),
    p('c', '450', '150'),
    p('d', '100', '150'),
    p('e', '200', '400'),
    p('f', '300', '250'),
  ], [s('sheet', '600', '600', '2')], options());
  if (r.totalSheets !== 1 || r.unplacedCount !== 0) {
    throw new Error(`expected alternate ordering to fit one sheet, got ${r.totalSheets}`);
  }
  if (r.sheets[0].pieces[0].pieceId === 'e') {
    throw new Error('area-descending order unexpectedly won the regression fixture');
  }
  assertLayout(r, 6);
  assertExecutableCutPlan(r, 0);
});
test('alternate piece order can select lower-waste stock', () => {
  const r = result([
    p('a', '450', '150'),
    p('b', '300', '150'),
    p('c', '250', '300'),
    p('d', '400', '100'),
    p('e', '350', '150'),
  ], [
    s('small', '600', '500'),
    s('large', '700', '600'),
  ], options());
  if (r.totalSheets !== 1 || r.unplacedCount !== 0 || r.sheets[0].stockId !== 'small') {
    throw new Error('did not select the lower-waste stock');
  }
  if (Math.abs(r.totalWastePercent - 6.6666666667) > 1e-7) {
    throw new Error(`wrong waste: ${r.totalWastePercent}`);
  }
  assertLayout(r, 5);
  assertExecutableCutPlan(r, 0);
});
test('beam retention reserves capacity for every active piece order', () => {
  const candidates = [
    ...Array.from({ length: 20 }, (_, rank) => ({ orderIndex: 0, rank })),
    { orderIndex: 1, rank: 100 },
    { orderIndex: 2, rank: 200 },
  ];
  const retained = retainBeamByOrder(candidates, 8, (a, b) => a.rank - b.rank);
  if (retained.length !== 8) throw new Error(`expected fixed beam width, got ${retained.length}`);
  for (const orderIndex of [0, 1, 2]) {
    if (!retained.some(candidate => candidate.orderIndex === orderIndex)) {
      throw new Error(`piece order ${orderIndex} was starved by a larger branch count`);
    }
  }
});
test('cut sequence is numbered, geometric, and parent-before-child', () => {
  const r = result([p('a', '400', '300'), p('b', '300', '300')], [s('x', '800', '600')], options({ useOneSheet: true }));
  assertLayout(r);
  for (const sh of r.sheets) sh.cutSequence.forEach((c, i) => {
    if (c.number !== i + 1 || c.span <= 0 || c.x2 === c.x && c.y2 === c.y) throw new Error('invalid cut sequence');
    if (c.orientation === 'horizontal' && c.y === c.y2) return;
    if (c.orientation === 'vertical' && c.x === c.x2) return;
    throw new Error('orientation mismatch');
  });
  assertExecutableCutPlan(r, 0);
});
test('kerf is consumed from the remainder and cuts stay executable', () => {
  const r = result([p('a', '500', '500', '2')], [s('x', '1003', '500')], options({ kerf: '3' }));
  assertLayout(r, 2);
  if (r.totalSheets !== 1 || r.sheets[0].cutSequence.length !== 1) throw new Error('wrong kerf layout');
  const [first, second] = r.sheets[0].pieces;
  if (first.x !== 0 || second.x !== 503 || r.sheets[0].cutSequence[0].x !== 500) {
    throw new Error('kerf was not taken from the positive-side remainder');
  }
  assertExecutableCutPlan(r, 3);
});
test('a stock-sized piece needs no cut even when kerf is nonzero', () => {
  const r = result([p('full', '500', '500')], [s('x', '500', '500')], options({ kerf: '3' }));
  assertLayout(r, 1);
  if (r.sheets[0].cutSequence.length !== 0) throw new Error('phantom edge cut');
  assertExecutableCutPlan(r, 3);
});
test('insufficient-stock fallback still emits an executable partial plan', () => {
  const r = result(
    [p('large', '600', '600'), p('small', '300', '300')],
    [s('x', '800', '800')],
    options({ kerf: '3', useOneSheet: true }),
  );
  if (r.totalSheets !== 1 || r.unplacedCount !== 1 || r.sheets[0].pieces.length !== 1) {
    throw new Error('wrong fallback result');
  }
  assertExecutableCutPlan(r, 3);
});
test('fallback places each requested piece at most once', () => {
  const r = result(
    [p('part', '400', '400', '3')],
    [s('x', '1000', '500')],
    options({ useOneSheet: true }),
  );
  const identities = r.sheets.flatMap(sheet =>
    sheet.pieces.map(piece => `${piece.pieceId}:${piece.pieceIndex}`));
  if (identities.length !== 2 || new Set(identities).size !== identities.length) {
    throw new Error(`duplicate fallback placements: ${identities.join(', ')}`);
  }
  if (identities.join(',') !== 'part:0,part:1' || r.unplacedCount !== 1) {
    throw new Error(`wrong fallback multiplicity: ${identities.join(', ')}`);
  }
  assertExecutableCutPlan(r, 0);
});
test('large mixed-size job is deterministic and search-bounded with kerf and grain', () => {
  const pieces = [
    p('cabinet-side', '720', '560', '8', true),
    p('shelf', '540', '300', '12'),
    p('rail', '680', '110', '10', true),
    p('drawer-front', '420', '180', '10'),
    p('back-panel', '760', '400', '6', true),
  ];
  assertLargeJobRegression(
    pieces,
    [s('full-sheet', '2440', '1220', '20')],
    options({ kerf: '3.2', considerGrain: true }),
  );
});
test('large multi-material job is deterministic and search-bounded across stock quantities', () => {
  const pieces = [
    p('ply-side', '700', '500', '8', true, 'PLY'),
    p('ply-shelf', '650', '280', '12', false, 'PLY'),
    p('mdf-door', '600', '400', '10', true, 'MDF'),
    p('mdf-trim', '900', '90', '12', false, 'MDF'),
  ];
  const stock = [
    s('ply-sheet', '2440', '1220', '12', 'PLY'),
    s('mdf-sheet', '2440', '1220', '10', 'MDF'),
    s('mdf-half', '1220', '1220', '4', 'MDF'),
  ];
  assertLargeJobRegression(
    pieces,
    stock,
    options({ kerf: '3', considerGrain: true, considerMaterial: true }),
  );
});
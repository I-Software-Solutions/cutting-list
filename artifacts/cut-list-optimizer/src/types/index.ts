export type Mode = 'sheet' | 'linear';
export type Units = 'metric' | 'imperial';

export interface CutPiece {
  id: string;
  length: string;
  width: string;
  qty: string;
  label: string;
  material: string;
  grain: boolean;
}

export interface StockItem {
  id: string;
  length: string;
  width: string;
  qty: string;
  material: string;
}

export interface Options {
  kerf: string;
  labelsOnPanels: boolean;
  useOneSheet: boolean;
  considerMaterial: boolean;
  edgeBanding: boolean;
  considerGrain: boolean;
}

export interface PlacedPiece {
  pieceId: string;
  pieceIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
  label: string;
  color: string;
  originalW: number;
  originalH: number;
}

export type GuillotineCutOrientation = 'horizontal' | 'vertical';

export interface GuillotineCutStep {
  number: number;
  orientation: GuillotineCutOrientation;
  x: number;
  y: number;
  x2: number;
  y2: number;
  span: number;
  description: string;
}

export interface UsedSheet {
  stockId: string;
  stockIndex: number;
  sheetNum: number;
  stockW: number;
  stockH: number;
  pieces: PlacedPiece[];
  wastePercent: number;
  material: string;
  cutSequence: GuillotineCutStep[];
}

export interface SheetOptimizationResult {
  mode: 'sheet';
  sheets: UsedSheet[];
  totalSheets: number;
  totalWastePercent: number;
  unplacedCount: number;
}

export interface LinearSegment {
  pieceId: string;
  pieceIndex: number;
  length: number;
  label: string;
  color: string;
}

export interface UsedBar {
  stockId: string;
  stockIndex: number;
  barNum: number;
  stockLength: number;
  segments: LinearSegment[];
  wasteLength: number;
  wastePercent: number;
  material: string;
}

export interface LinearOptimizationResult {
  mode: 'linear';
  bars: UsedBar[];
  totalBars: number;
  totalWastePercent: number;
  unplacedCount: number;
}

export type OptimizationResult = SheetOptimizationResult | LinearOptimizationResult;

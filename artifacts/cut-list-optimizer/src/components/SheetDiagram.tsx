import type { UsedSheet } from '../types';
import type { Units } from '../lib/units';
import { formatValue } from '../lib/units';
import { useCutPlayback } from '../hooks/use-cut-playback';
import { CutPlaybackPanel } from './CutPlaybackPanel';

interface Props {
  sheet: UsedSheet;
  units: Units;
  showLabels: boolean;
  index: number;
}

const MAX_W = 520;
const MAX_H = 380;

export function SheetDiagram({ sheet, units, showLabels, index }: Props) {
  const { stockW, stockH, pieces, wastePercent, sheetNum, cutSequence = [] } = sheet;
  const playback = useCutPlayback(cutSequence);
  const { currentIndex } = playback;

  if (!stockW || !stockH) return null;

  const scale = Math.min(MAX_W / stockW, MAX_H / stockH, 1);
  const dispW = stockW * scale;
  const dispH = stockH * scale;

  const ul = units === 'metric' ? 'mm' : 'in';

  // Bounding box of placed pieces → infer clear remaining strips
  const maxX = pieces.length > 0 ? Math.max(...pieces.map(p => p.x + p.w)) : 0;
  const maxY = pieces.length > 0 ? Math.max(...pieces.map(p => p.y + p.h)) : 0;
  const remainRight  = stockW - maxX;   // clear strip width on the right
  const remainBottom = stockH - maxY;   // clear strip height on the bottom

  const showRightStrip  = remainRight  > 0.02 * stockW && remainRight  * scale > 28;
  const showBottomStrip = remainBottom > 0.02 * stockH && remainBottom * scale > 20;

  return (
    <div className="mb-6 flex flex-col xl:flex-row gap-6 items-start" data-result={JSON.stringify({ type: 'sheet', sheetNum, stockW, stockH, wastePercent: wastePercent.toFixed(1), pieceCount: pieces.length })}>
      <div className="flex-1 min-w-0 w-full overflow-hidden">
        <div className="flex items-center justify-between mb-1.5 px-1">
          <span className="text-sm font-medium text-foreground">
            Sheet {sheetNum}
            {sheet.material && <span className="ml-2 text-xs text-muted-foreground">({sheet.material})</span>}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatValue(stockW, units, 0)} × {formatValue(stockH, units, 0)} {ul} — waste: {wastePercent.toFixed(1)}%
          </span>
        </div>
        <div className="overflow-auto border border-border rounded">
          <svg
            width={dispW}
            height={dispH}
            viewBox={`0 0 ${dispW} ${dispH}`}
            style={{ display: 'block', background: '#e8e0d4' }}
          >
          {/* Waste background */}
          <rect x={0} y={0} width={dispW} height={dispH} fill="#d6ccbc" />

          {/* ── Pieces ── */}
          {pieces.map((piece, pi) => {
            const x  = piece.x * scale;
            const y  = piece.y * scale;
            const w  = piece.w * scale;
            const h  = piece.h * scale;
            const cx = x + w / 2;
            const cy = y + h / 2;

            // Original (pre-rotation) dimensions
            const origW = piece.rotated ? piece.originalH : piece.originalW;
            const origH = piece.rotated ? piece.originalW : piece.originalH;

            const dimLine1 = formatValue(origW, units, 0);
            const dimLine2 = formatValue(origH, units, 0);

            const fs = Math.min(10, w / 6, h / 2.8);
            const showDim  = origW > 0 && origH > 0 && w > 32 && h > 16 && fs >= 5;
            const hasLabel = showLabels && !!piece.label;
            // stack: label above, dim below (when both fit vertically)
            const stackOffset = hasLabel && showDim && h > 30 ? fs * 1.1 : 0;

            return (
              <g key={pi}>
                <rect
                  x={x} y={y} width={w} height={h}
                  fill={piece.color} fillOpacity={0.82}
                  stroke="white" strokeWidth={1}
                />

                {/* User label */}
                {hasLabel && w > 24 && h > 12 && (
                  <text
                    x={cx} y={cy - stackOffset}
                    textAnchor="middle" dominantBaseline="middle"
                    fill="white"
                    fontSize={Math.min(10, w / 4, h / 2.5)}
                    fontWeight="600"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {piece.label.length > 14 ? piece.label.slice(0, 14) + '…' : piece.label}
                  </text>
                )}

                {/* Dimensions — always visible when piece is large enough */}
                {showDim && (
                  <text
                    x={cx} y={cy + stackOffset}
                    textAnchor="middle" dominantBaseline="middle"
                    fill="rgba(255,255,255,0.93)"
                    fontSize={fs}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {/* Use two tspan lines when there's vertical room, otherwise W×H on one line */}
                    {h > 36 ? (
                      <>
                        <tspan x={cx} dy={-fs * 0.6}>{dimLine1} {ul}</tspan>
                        <tspan x={cx} dy={fs * 1.3}>× {dimLine2} {ul}</tspan>
                      </>
                    ) : (
                      `${dimLine1}×${dimLine2} ${ul}`
                    )}
                  </text>
                )}
              </g>
            );
          })}

          {/* ── Remaining right strip ── */}
          {showRightStrip && (() => {
            const lineX   = maxX * scale;
            const stripCX = (maxX + remainRight / 2) * scale;
            const stripCY = dispH / 2;
            const fs      = Math.min(9, remainRight * scale / 8);
            const showText = fs >= 5;
            return (
              <g>
                <line
                  x1={lineX} y1={4} x2={lineX} y2={dispH - 4}
                  stroke="#8a7a6a" strokeWidth={1} strokeDasharray="4 3"
                />
                {showText && (
                  <text
                    textAnchor="middle" dominantBaseline="middle"
                    fill="#6b5e50" fontSize={fs}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    <tspan x={stripCX} y={stripCY - fs * 0.7} fontWeight="500">
                      {formatValue(remainRight, units, 0)} {ul}
                    </tspan>
                    <tspan x={stripCX} dy={fs * 1.4} fill="#8a7a6a" fontSize={fs * 0.88}>
                      × {formatValue(stockH, units, 0)} {ul}
                    </tspan>
                  </text>
                )}
              </g>
            );
          })()}

          {/* ── Remaining bottom strip ── */}
          {showBottomStrip && (() => {
            const lineY   = maxY * scale;
            // keep bottom label in remaining area, avoid right-strip text zone
            const labelMaxX = showRightStrip ? maxX * scale - 4 : dispW - 4;
            const stripCX   = labelMaxX / 2;
            const stripCY   = (maxY + remainBottom / 2) * scale;
            const fs        = Math.min(9, remainBottom * scale / 5);
            const showText  = fs >= 5 && labelMaxX > 40;
            return (
              <g>
                <line
                  x1={4} y1={lineY} x2={dispW - 4} y2={lineY}
                  stroke="#8a7a6a" strokeWidth={1} strokeDasharray="4 3"
                />
                {showText && (
                  <text
                    textAnchor="middle" dominantBaseline="middle"
                    fill="#6b5e50" fontSize={fs}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    <tspan x={stripCX} y={stripCY - fs * 0.7} fontWeight="500">
                      {formatValue(showRightStrip ? maxX : stockW, units, 0)} {ul}
                    </tspan>
                    <tspan x={stripCX} dy={fs * 1.4} fill="#8a7a6a" fontSize={fs * 0.88}>
                      × {formatValue(remainBottom, units, 0)} {ul}
                    </tspan>
                  </text>
                )}
              </g>
            );
          })()}

          {/* Sheet border */}
          <rect x={0} y={0} width={dispW} height={dispH} fill="none" stroke="#8a7a6a" strokeWidth={1.5} />

          {/* ── Cut Sequence Overlay ── */}
          {currentIndex >= 0 && cutSequence.slice(0, currentIndex + 1).map((cut, idx) => {
            const isCurrent = idx === currentIndex;
            const x1 = cut.x * scale;
            const y1 = cut.y * scale;
            const x2 = cut.x2 * scale;
            const y2 = cut.y2 * scale;
            const cx = (x1 + x2) / 2;
            const cy = (y1 + y2) / 2;

            return (
              <g key={`cut-${idx}`}>
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={isCurrent ? "hsl(var(--destructive))" : "hsl(var(--destructive) / 0.5)"}
                  strokeWidth={isCurrent ? 3 : 1.5}
                  strokeDasharray={isCurrent ? "6 4" : "4 2"}
                  className={isCurrent ? "animate-pulse" : ""}
                />
                {isCurrent && (
                  <g transform={`translate(${cx}, ${cy})`}>
                    <circle r="10" fill="hsl(var(--destructive))" />
                    <text
                      x="0" y="1"
                      textAnchor="middle" dominantBaseline="middle"
                      fill="white" fontSize="11" fontWeight="bold"
                    >
                      {cut.number}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>

    {/* Cut sequence playback */}
    {cutSequence.length > 0 && (
      <div className="w-full xl:w-80 flex-shrink-0 mt-6 xl:mt-0">
        <CutPlaybackPanel
          sequence={cutSequence}
          units={units}
          {...playback}
        />
      </div>
    )}
  </div>
  );
}

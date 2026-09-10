import { Router, type IRouter } from "express";
import { getPool, isConfigured, resolveEnv } from "../lib/iframerDb.js";

const router: IRouter = Router();

const IN_TO_MM = 25.4;
const LIMIT = 50;

function toMm(value: number, unit: string): number {
  switch (unit?.toLowerCase()) {
    case "in": return Math.round(value * IN_TO_MM);
    case "ft": return Math.round(value * 12 * IN_TO_MM);
    case "m":  return Math.round(value * 1000);
    case "cm": return Math.round(value * 10);
    default:   return Math.round(value); // mm
  }
}

function resolveEnvParam(req: any): "dev" | "beta" | "prod" {
  const e = req.query.env as string | undefined;
  if (e === "prod" || e === "beta" || e === "dev") return e;
  return resolveEnv(
    req.query.serverType as string,
    (req.query.portalUrl ?? req.query.portal) as string | undefined,
  );
}

/** "thepictureframer.dev.i-framer.com" → "thepictureframer" */
function extractSlug(portal: string): string {
  let p = portal.trim().toLowerCase();
  p = p.replace(/^https?:\/\//, "").split("/")[0];
  return p.split(".")[0];
}

/**
 * GET /api/iframer/boards/search?q=FBB&type=sheet|linear|all&env=dev
 *
 * Server-side search — returns up to 50 matching board types.
 * All dimensions are normalised to mm.
 */
router.get("/iframer/boards/search", async (req, res) => {
  const env = resolveEnvParam(req);

  if (!isConfigured(env)) {
    res.status(503).json({
      error: `i-framer ${env} database not configured`,
      hint: "Add DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT to Replit Secrets",
    });
    return;
  }

  const q = ((req.query.q as string) ?? "").trim();
  const typeFilter = (req.query.type as string | undefined) ?? "sheet";
  const like = `%${q}%`;

  try {
    const pool = getPool(env);
    const boards: any[] = [];

    // Item codes are duplicated across framers — when a portal is given,
    // scope the search to that framer's items (plus global/unowned ones)
    // and rank the framer's own rows first so dedup keeps them.
    let framerId: string | null = null;
    const portal = (req.query.portal as string | undefined)?.trim();
    if (portal) {
      const [framers] = await pool.query<any[]>(
        "SELECT ID FROM framer WHERE LOWER(Slug) = ? AND Deleted = 0 LIMIT 1",
        [extractSlug(portal)],
      );
      if (framers.length > 0) framerId = framers[0].ID;
    }
    const framerWhere = framerId ? "AND (i.FramerID = ? OR i.FramerID IS NULL)" : "";
    const framerOrder = framerId ? "(i.FramerID = ?) DESC, i.Stock DESC," : "";
    const framerParams = framerId ? [framerId, framerId] : [];

    const sheetSql = (table: string) => `
      SELECT
        i.Code          AS code,
        COALESCE(NULLIF(TRIM(i.Name),''), TRIM(i.Code)) AS name,
        b.SheetWidth    AS width_raw,
        b.SheetHeight   AS height_raw,
        b.SheetSizeUnit AS unit,
        i.Stock         AS stock
      FROM ${table} b
      JOIN item i ON i.ID = b.ID
      WHERE i.Deleted = 0
        AND (i.Discontinued IS NULL OR i.Discontinued = 0)
        AND i.Code IS NOT NULL AND TRIM(i.Code) != ''
        AND b.SheetWidth  > 0
        AND b.SheetHeight > 0
        AND (i.Code LIKE ? OR i.Name LIKE ?)
        ${framerWhere}
      ORDER BY ${framerOrder} i.Code ASC
      LIMIT ${LIMIT}`;

    if (typeFilter === "all" || typeFilter === "sheet") {
      const [mbRows] = await pool.query<any[]>(sheetSql("matboard"), [like, like, ...framerParams]);
      for (const r of mbRows) {
        const len = toMm(parseFloat(r.height_raw), r.unit);
        const wid = toMm(parseFloat(r.width_raw), r.unit);
        if (len >= 100 && wid >= 100)
          boards.push({ code: r.code.trim(), name: r.name, length: len, width: wid, stockType: "matboard", stock: r.stock != null ? Number(r.stock) : null });
      }

      const [bkRows] = await pool.query<any[]>(sheetSql("backing"), [like, like, ...framerParams]);
      for (const r of bkRows) {
        const len = toMm(parseFloat(r.height_raw), r.unit);
        const wid = toMm(parseFloat(r.width_raw), r.unit);
        if (len >= 100 && wid >= 100)
          boards.push({ code: r.code.trim(), name: r.name, length: len, width: wid, stockType: "backing", stock: r.stock != null ? Number(r.stock) : null });
      }

      // Glass / covering sheets live in the `covering` table
      const [gsRows] = await pool.query<any[]>(sheetSql("covering"), [like, like, ...framerParams]);
      for (const r of gsRows) {
        const len = toMm(parseFloat(r.height_raw), r.unit);
        const wid = toMm(parseFloat(r.width_raw), r.unit);
        if (len >= 100 && wid >= 100)
          boards.push({ code: r.code.trim(), name: r.name, length: len, width: wid, stockType: "glass", stock: r.stock != null ? Number(r.stock) : null });
      }
    }

    if (typeFilter === "all" || typeFilter === "linear") {
      // NOTE: moulding lengths + item.Stock are stored in item.Unit (m/ft/in),
      // NOT in m.WidthUnit (which describes the profile width). Many mouldings
      // have DefaultMouldingLength = 0 but still track Stock as total length
      // on hand, so we don't filter on DefaultMouldingLength.
      const [moRows] = await pool.query<any[]>(`
        SELECT
          i.Code AS code,
          COALESCE(NULLIF(TRIM(i.Name),''), TRIM(i.Code)) AS name,
          m.DefaultMouldingLength AS length_raw,
          i.Unit AS unit,
          i.Stock AS stock
        FROM moulding m
        JOIN item i ON i.ID = m.ID
        WHERE i.Deleted = 0
          AND (i.Discontinued IS NULL OR i.Discontinued = 0)
          AND i.Code IS NOT NULL AND TRIM(i.Code) != ''
          AND (i.Code LIKE ? OR i.Name LIKE ?)
          ${framerWhere}
        ORDER BY ${framerOrder} i.Code ASC
        LIMIT ${LIMIT}`, [like, like, ...framerParams]);

      for (const r of moRows) {
        const barMm = toMm(parseFloat(r.length_raw) || 0, r.unit);
        const stockRaw = r.stock != null ? Number(r.stock) : 0;
        const stockMm = stockRaw > 0 ? toMm(stockRaw, r.unit) : 0;
        // Convert total length on hand into whole bars when a bar length is known
        const barCount = barMm > 0 && stockMm > 0 ? Math.floor(stockMm / barMm) : null;
        boards.push({
          code: r.code.trim(),
          name: r.name,
          length: barMm,
          width: 0,
          stockType: "moulding",
          stock: barCount,
          stockLengthMm: stockMm > 0 ? stockMm : null,
        });
      }
    }

    // Deduplicate by stockType+code
    const seen = new Set<string>();
    const unique = boards.filter(b => {
      const key = `${b.stockType}:${b.code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json({ boards: unique, env, count: unique.length, query: q });
  } catch (err: any) {
    res.status(500).json({ error: "Database error", detail: err?.message ?? String(err) });
  }
});

/**
 * GET /api/iframer/tables?env=dev
 * Diagnostic: lists all tables (dev only).
 */
router.get("/iframer/tables", async (req, res) => {
  const env = resolveEnvParam(req);
  if (env === "prod") { res.status(403).json({ error: "Not available in production" }); return; }
  if (!isConfigured(env)) { res.status(503).json({ error: "Not configured" }); return; }
  try {
    const pool = getPool(env);
    const [rows] = await pool.query<any[]>("SHOW TABLES");
    res.json({ tables: rows.map((r: any) => Object.values(r)[0]) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

export default router;

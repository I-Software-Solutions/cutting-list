import { Router, type IRouter } from "express";
import {
  db,
  cutListsTable,
  cutListPayloadSchema,
  cutListUpdateSchema,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import type { z } from "zod/v4";
import { logger } from "../lib/logger";

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

function databaseErrorCode(error: unknown): string {
  // Drizzle wraps the driver's error in `cause`; never log the wrapper's SQL.
  let current = error;
  for (let depth = 0; depth < 5; depth++) {
    if (!current || typeof current !== "object") break;
    if (
      "code" in current &&
      typeof current.code === "string" &&
      /^[A-Z0-9]{1,16}$/.test(current.code)
    ) {
      return current.code;
    }
    current = "cause" in current ? current.cause : undefined;
  }

  return "UNKNOWN";
}

function logDatabaseError(operation: "list" | "get" | "create" | "update" | "delete", error: unknown): void {
  logger.error(
    { operation, errorCode: databaseErrorCode(error) },
    "Cut list database operation failed",
  );
}

const router: IRouter = Router();

router.get("/cut-lists", async (_req, res) => {
  try {
    const results = await db
      .select({
        id: cutListsTable.id,
        name: cutListsTable.name,
        mode: cutListsTable.mode,
        units: cutListsTable.units,
        created_at: cutListsTable.created_at,
        updated_at: cutListsTable.updated_at,
      })
      .from(cutListsTable)
      .orderBy(cutListsTable.updated_at);

    res.json(results);
  } catch (err) {
    logDatabaseError("list", err);
    res.status(500).json({ error: "Database error" });
  }
});

router.get("/cut-lists/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const results = await db
      .select()
      .from(cutListsTable)
      .where(eq(cutListsTable.id, id))
      .limit(1);

    if (results.length === 0) {
      res.status(404).json({ error: "Cut list not found" });
      return;
    }

    res.json(results[0]);
  } catch (err) {
    logDatabaseError("get", err);
    res.status(500).json({ error: "Database error" });
  }
});

router.post("/cut-lists", async (req, res) => {
  const parsed = cutListPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const { name, mode, units, pieces, stock, options } = parsed.data;

  try {
    const inserted = await db
      .insert(cutListsTable)
      .values({
        name,
        mode,
        units,
        pieces,
        stock,
        options,
      })
      .returning();

    res.status(201).json(inserted[0]);
  } catch (err) {
    logDatabaseError("create", err);
    res.status(500).json({ error: "Database error" });
  }
});

router.put("/cut-lists/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const parsed = cutListUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const { name, mode, units, pieces, stock, options } = parsed.data;

  try {
    const updated = await db
      .update(cutListsTable)
      .set({
        ...(name !== undefined && { name }),
        ...(mode !== undefined && { mode }),
        ...(units !== undefined && { units }),
        ...(pieces !== undefined && { pieces }),
        ...(stock !== undefined && { stock }),
        ...(options !== undefined && { options }),
        updated_at: new Date(),
      })
      .where(eq(cutListsTable.id, id))
      .returning();

    if (updated.length === 0) {
      res.status(404).json({ error: "Cut list not found" });
      return;
    }

    res.json(updated[0]);
  } catch (err) {
    logDatabaseError("update", err);
    res.status(500).json({ error: "Database error" });
  }
});

router.delete("/cut-lists/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const deleted = await db
      .delete(cutListsTable)
      .where(eq(cutListsTable.id, id))
      .returning({ id: cutListsTable.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Cut list not found" });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    logDatabaseError("delete", err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;

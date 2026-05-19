import { NotFoundException } from '@nestjs/common';
import { eq, type Column, type Table } from 'drizzle-orm';
import type { Database } from '../database/drizzle.types';

/**
 * Fetches a single row by primary key or throws NotFoundException.
 *
 * Replaces the recurring pattern:
 *   select().from(t).where(eq(t.id, id)).limit(1) → throw if empty.
 *
 * Does NOT cover tables with compound lookup keys (e.g. highlight scoped by
 * section) — those keep their custom findOne.
 */
export async function findByIdOrFail<TRow>(
  db: Database,
  table: Table & { id: Column },
  id: string,
  label: string,
): Promise<TRow> {
  const rows = (await db
    .select()
    .from(table)
    .where(eq(table.id, id))
    .limit(1)) as TRow[];
  if (rows.length === 0) {
    throw new NotFoundException(`${label} ${id} not found`);
  }
  return rows[0];
}

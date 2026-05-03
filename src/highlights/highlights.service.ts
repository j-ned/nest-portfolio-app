import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  highlight,
  type Highlight,
  type HighlightSection,
} from '../database/schema';
import { CreateHighlightDto } from './dto/create-highlight.dto';
import { UpdateHighlightDto } from './dto/update-highlight.dto';

@Injectable()
export class HighlightsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findAll(section: HighlightSection): Promise<Highlight[]> {
    return this.db
      .select()
      .from(highlight)
      .where(eq(highlight.section, section))
      .orderBy(asc(highlight.order));
  }

  async findOne(id: string, section: HighlightSection): Promise<Highlight> {
    const [row] = await this.db
      .select()
      .from(highlight)
      .where(and(eq(highlight.id, id), eq(highlight.section, section)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Highlight not found');
    }
    return row;
  }

  async create(
    dto: CreateHighlightDto,
    section: HighlightSection,
  ): Promise<Highlight> {
    const [created] = await this.db
      .insert(highlight)
      .values({ ...dto, section })
      .returning();
    return created;
  }

  async update(
    id: string,
    dto: UpdateHighlightDto,
    section: HighlightSection,
  ): Promise<Highlight> {
    const [updated] = await this.db
      .update(highlight)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(highlight.id, id), eq(highlight.section, section)))
      .returning();
    if (!updated) {
      throw new NotFoundException('Highlight not found');
    }
    return updated;
  }

  async remove(id: string, section: HighlightSection): Promise<void> {
    const [deleted] = await this.db
      .delete(highlight)
      .where(and(eq(highlight.id, id), eq(highlight.section, section)))
      .returning();
    if (!deleted) {
      throw new NotFoundException('Highlight not found');
    }
  }
}

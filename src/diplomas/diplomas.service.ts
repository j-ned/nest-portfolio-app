import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { diplomas, type Diploma } from '../database/schema/diplomas';
import { CreateDiplomaDto } from './dto/create-diploma.dto';
import { UpdateDiplomaDto } from './dto/update-diploma.dto';

@Injectable()
export class DiplomasService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findAll(): Promise<Diploma[]> {
    return this.db.select().from(diplomas).orderBy(asc(diplomas.createdAt));
  }

  async findById(id: string): Promise<Diploma> {
    const rows = await this.db
      .select()
      .from(diplomas)
      .where(eq(diplomas.id, id))
      .limit(1);
    if (rows.length === 0)
      throw new NotFoundException(`Diploma ${id} not found`);
    return rows[0];
  }

  async create(dto: CreateDiplomaDto): Promise<Diploma> {
    const [row] = await this.db.insert(diplomas).values(dto).returning();
    return row;
  }

  async update(id: string, dto: UpdateDiplomaDto): Promise<Diploma> {
    const [row] = await this.db
      .update(diplomas)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(diplomas.id, id))
      .returning();
    if (!row) throw new NotFoundException(`Diploma ${id} not found`);
    return row;
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db
      .delete(diplomas)
      .where(eq(diplomas.id, id))
      .returning({ id: diplomas.id });
    if (rows.length === 0)
      throw new NotFoundException(`Diploma ${id} not found`);
  }
}

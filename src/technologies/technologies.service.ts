import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { technologies, type Technology } from '../database/schema/technologies';
import { CreateTechnologyDto } from './dto/create-technology.dto';
import { UpdateTechnologyDto } from './dto/update-technology.dto';

@Injectable()
export class TechnologiesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findAll(): Promise<Technology[]> {
    return this.db.select().from(technologies).orderBy(asc(technologies.createdAt));
  }

  async findById(id: string): Promise<Technology> {
    const rows = await this.db.select().from(technologies).where(eq(technologies.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundException(`Technology ${id} not found`);
    return rows[0];
  }

  async create(dto: CreateTechnologyDto): Promise<Technology> {
    const [row] = await this.db.insert(technologies).values(dto).returning();
    return row;
  }

  async update(id: string, dto: UpdateTechnologyDto): Promise<Technology> {
    const [row] = await this.db
      .update(technologies)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(technologies.id, id))
      .returning();
    if (!row) throw new NotFoundException(`Technology ${id} not found`);
    return row;
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db
      .delete(technologies)
      .where(eq(technologies.id, id))
      .returning({ id: technologies.id });
    if (rows.length === 0) throw new NotFoundException(`Technology ${id} not found`);
  }
}

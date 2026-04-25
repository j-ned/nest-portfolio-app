import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { expertises, type Expertise, type ExpertiseType } from '../database/schema/expertises';
import { CreateExpertiseDto } from './dto/create-expertise.dto';
import { UpdateExpertiseDto } from './dto/update-expertise.dto';

@Injectable()
export class ExpertisesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findOffers(): Promise<Expertise[]> {
    return this.db.select().from(expertises).where(eq(expertises.type, 'offer')).orderBy(asc(expertises.createdAt));
  }

  findSeeks(): Promise<Expertise[]> {
    return this.db.select().from(expertises).where(eq(expertises.type, 'seek')).orderBy(asc(expertises.createdAt));
  }

  async findById(id: string): Promise<Expertise> {
    const rows = await this.db.select().from(expertises).where(eq(expertises.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundException(`Expertise ${id} not found`);
    return rows[0];
  }

  async create(type: ExpertiseType, dto: CreateExpertiseDto): Promise<Expertise> {
    const [row] = await this.db.insert(expertises).values({ ...dto, type }).returning();
    return row;
  }

  async update(id: string, dto: UpdateExpertiseDto): Promise<Expertise> {
    // Le type n'est PAS modifiable : on ne le passe jamais dans le set.
    const [row] = await this.db
      .update(expertises)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(expertises.id, id))
      .returning();
    if (!row) throw new NotFoundException(`Expertise ${id} not found`);
    return row;
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db
      .delete(expertises)
      .where(eq(expertises.id, id))
      .returning({ id: expertises.id });
    if (rows.length === 0) throw new NotFoundException(`Expertise ${id} not found`);
  }
}

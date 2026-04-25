import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { hero, type Hero } from '../database/schema/hero';
import { UpdateHeroDto } from './dto/update-hero.dto';

@Injectable()
export class HeroService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findOne(): Promise<Hero> {
    const rows = await this.db.select().from(hero).limit(1);
    if (rows.length === 0) {
      throw new InternalServerErrorException(
        'Hero singleton missing — did you run the migration?',
      );
    }
    return rows[0];
  }

  async update(dto: UpdateHeroDto): Promise<Hero> {
    const existing = await this.findOne();
    const [updated] = await this.db
      .update(hero)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(hero.id, existing.id))
      .returning();
    return updated;
  }
}

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { profile } from '../database/schema';
import { UpdateBiographyDto } from './dto/update-biography.dto';

export type Biography = {
  id: string;
  title: string;
  paragraphs: string[];
  updatedAt: Date;
};

@Injectable()
export class BiographyService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findOne(): Promise<Biography> {
    const rows = await this.db
      .select({
        id: profile.id,
        title: profile.bioTitle,
        paragraphs: profile.bioParagraphs,
        updatedAt: profile.updatedAt,
      })
      .from(profile)
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException('Biography not found');
    }
    return rows[0];
  }

  async update(dto: UpdateBiographyDto): Promise<Biography> {
    const existing = await this.findOne();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.title !== undefined) patch['bioTitle'] = dto.title;
    if (dto.paragraphs !== undefined) patch['bioParagraphs'] = dto.paragraphs;

    const [updated] = await this.db
      .update(profile)
      .set(patch)
      .where(eq(profile.id, existing.id))
      .returning({
        id: profile.id,
        title: profile.bioTitle,
        paragraphs: profile.bioParagraphs,
        updatedAt: profile.updatedAt,
      });
    return updated;
  }
}

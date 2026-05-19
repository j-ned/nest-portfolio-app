import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { socialLinks, type SocialLink } from '../database/schema/social-links';
import { findByIdOrFail } from '../common/crud-helpers';
import { CreateSocialLinkDto } from './dto/create-social-link.dto';
import { UpdateSocialLinkDto } from './dto/update-social-link.dto';

@Injectable()
export class SocialLinksService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findAll(): Promise<SocialLink[]> {
    return this.db
      .select()
      .from(socialLinks)
      .orderBy(asc(socialLinks.createdAt));
  }

  findById(id: string): Promise<SocialLink> {
    return findByIdOrFail<SocialLink>(this.db, socialLinks, id, 'SocialLink');
  }

  async create(dto: CreateSocialLinkDto): Promise<SocialLink> {
    const [row] = await this.db.insert(socialLinks).values(dto).returning();
    return row;
  }

  async update(id: string, dto: UpdateSocialLinkDto): Promise<SocialLink> {
    const [row] = await this.db
      .update(socialLinks)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(socialLinks.id, id))
      .returning();
    if (!row) throw new NotFoundException(`SocialLink ${id} not found`);
    return row;
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db
      .delete(socialLinks)
      .where(eq(socialLinks.id, id))
      .returning({ id: socialLinks.id });
    if (rows.length === 0)
      throw new NotFoundException(`SocialLink ${id} not found`);
  }
}

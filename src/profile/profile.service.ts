import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { profile, type Profile } from '../database/schema/profile';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfileService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findOne(): Promise<Profile> {
    const rows = await this.db.select().from(profile).limit(1);
    if (rows.length === 0) {
      throw new InternalServerErrorException(
        'Profile singleton missing — did you run the migration?',
      );
    }
    return rows[0];
  }

  async update(dto: UpdateProfileDto): Promise<Profile> {
    const existing = await this.findOne();
    const [updated] = await this.db
      .update(profile)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(profile.id, existing.id))
      .returning();
    return updated;
  }
}

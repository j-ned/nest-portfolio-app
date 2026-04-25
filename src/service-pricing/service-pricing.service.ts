import {
  Inject,
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  servicePricing,
  type ServicePricing,
} from '../database/schema/service-pricing';
import { CreateServicePricingDto } from './dto/create-service-pricing.dto';
import { UpdateServicePricingDto } from './dto/update-service-pricing.dto';
import { ReorderServicePricingDto } from './dto/reorder-service-pricing.dto';

@Injectable()
export class ServicePricingService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findAll(): Promise<ServicePricing[]> {
    return this.db
      .select()
      .from(servicePricing)
      .orderBy(asc(servicePricing.order));
  }

  async findById(id: string): Promise<ServicePricing> {
    const rows = await this.db
      .select()
      .from(servicePricing)
      .where(eq(servicePricing.id, id))
      .limit(1);
    if (rows.length === 0)
      throw new NotFoundException(`ServicePricing ${id} not found`);
    return rows[0];
  }

  async create(dto: CreateServicePricingDto): Promise<ServicePricing> {
    const [row] = await this.db.insert(servicePricing).values(dto).returning();
    return row;
  }

  async update(
    id: string,
    dto: UpdateServicePricingDto,
  ): Promise<ServicePricing> {
    const [row] = await this.db
      .update(servicePricing)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(servicePricing.id, id))
      .returning();
    if (!row) throw new NotFoundException(`ServicePricing ${id} not found`);
    return row;
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db
      .delete(servicePricing)
      .where(eq(servicePricing.id, id))
      .returning({ id: servicePricing.id });
    if (rows.length === 0)
      throw new NotFoundException(`ServicePricing ${id} not found`);
  }

  async reorder(dto: ReorderServicePricingDto): Promise<ServicePricing[]> {
    const { orderedIds } = dto;
    if (orderedIds.length === 0) {
      return this.findAll();
    }
    // Vérifier que tous les IDs existent
    const existing = await this.db
      .select({ id: servicePricing.id })
      .from(servicePricing)
      .where(inArray(servicePricing.id, orderedIds));
    const existingIds = new Set(existing.map((r) => r.id));
    const missing = orderedIds.filter((id) => !existingIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `ServicePricing IDs not found: ${missing.join(', ')}`,
      );
    }
    // Transaction: update each
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(servicePricing)
          .set({ order: i, updatedAt: new Date() })
          .where(eq(servicePricing.id, orderedIds[i]));
      }
    });
    return this.findAll();
  }
}

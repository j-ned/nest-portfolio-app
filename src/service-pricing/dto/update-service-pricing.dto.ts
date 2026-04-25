import { PartialType } from '@nestjs/swagger';
import { CreateServicePricingDto } from './create-service-pricing.dto';

export class UpdateServicePricingDto extends PartialType(
  CreateServicePricingDto,
) {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ServicePricingController } from './service-pricing.controller';
import { ServicePricingService } from './service-pricing.service';

@Module({
  imports: [AuthModule],
  controllers: [ServicePricingController],
  providers: [ServicePricingService],
})
export class ServicePricingModule {}

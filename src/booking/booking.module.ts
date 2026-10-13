import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { AvailabilityService } from './availability.service';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';

@Module({
  imports: [AppConfigModule],
  controllers: [BookingController],
  providers: [BookingService, AvailabilityService],
})
export class BookingModule {}

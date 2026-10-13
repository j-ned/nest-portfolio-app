import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';

@Module({
  controllers: [BookingController],
  providers: [BookingService, AvailabilityService],
})
export class BookingModule {}

import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { AvailabilityService } from './availability.service';
import { BookingAdminController } from './booking-admin.controller';
import { BookingFeedController } from './booking-feed.controller';
import { BookingFeedService } from './booking-feed.service';
import { BookingNotifier } from './booking-notifier.service';
import { BookingScheduler } from './booking-scheduler.service';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';

@Module({
  imports: [AppConfigModule],
  controllers: [
    BookingController,
    BookingAdminController,
    BookingFeedController,
  ],
  providers: [
    BookingService,
    AvailabilityService,
    BookingNotifier,
    BookingScheduler,
    BookingFeedService,
  ],
})
export class BookingModule {}

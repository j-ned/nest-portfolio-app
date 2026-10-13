import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PublicReadThrottle } from '../common/throttle';
import { BookingService, type SlotsResponse } from './booking.service';

@ApiTags('Booking')
@Controller('booking')
export class BookingController {
  constructor(private readonly booking: BookingService) {}

  @PublicReadThrottle()
  @Get('slots')
  // Créneaux recalculés à chaque lecture : une copie en cache proposerait un créneau déjà pris.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Free booking slots of the whole bookable window (public, ISO 8601 UTC)',
  })
  @ApiResponse({ status: 200 })
  getSlots(): Promise<SlotsResponse> {
    return this.booking.getSlots();
  }
}

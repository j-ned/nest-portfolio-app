import { Body, Controller, Get, Header, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BookingCreateThrottle, PublicReadThrottle } from '../common/throttle';
import {
  type BookingConfirmation,
  BookingService,
  type SlotsResponse,
} from './booking.service';
import { CreateBookingDto } from './dto/create-booking.dto';

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

  @BookingCreateThrottle()
  @Post('bookings')
  @ApiOperation({ summary: 'Book a free slot (public)' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 409, description: 'slot_taken' })
  @ApiResponse({
    status: 422,
    description: 'slot_unavailable | booking_limit_reached',
  })
  @ApiResponse({ status: 429, description: 'Too many bookings from this IP' })
  create(@Body() dto: CreateBookingDto): Promise<BookingConfirmation> {
    return this.booking.create(dto);
  }
}

import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BookingCreateThrottle, PublicReadThrottle } from '../common/throttle';
import {
  type BookingConfirmation,
  BookingService,
  type CancellationPreview,
  type SlotsResponse,
} from './booking.service';
import { CancelTokenDto } from './dto/cancel-token.dto';
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

  // Jeton dans le corps, jamais dans l'URL : pino journalise `req.url` (ADR-0026).
  @Post('bookings/cancel/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview the booking behind a cancel token (public)',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 404, description: 'booking_not_found' })
  previewCancellation(
    @Body() { token }: CancelTokenDto,
  ): Promise<CancellationPreview> {
    return this.booking.previewCancellation(token);
  }

  @Post('bookings/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a booking with its cancel token (public, idempotent)',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 404, description: 'booking_not_found' })
  @ApiResponse({ status: 409, description: 'cancel_too_late' })
  cancel(@Body() { token }: CancelTokenDto): Promise<{ status: 'cancelled' }> {
    return this.booking.cancelByVisitor(token);
  }
}

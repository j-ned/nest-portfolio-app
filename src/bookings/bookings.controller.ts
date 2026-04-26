import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { parsePagination } from '../common/pagination';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CreateDisabledDateDto } from './dto/create-disabled-date.dto';
import { ListBookingsDto } from './dto/list-bookings.dto';
import { ListSlotsDto } from './dto/list-slots.dto';

@ApiTags('Bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a booking (public, rate-limited 3/60s par IP, conflict-checked)',
  })
  @ApiResponse({ status: 201, description: 'Booking created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({
    status: 409,
    description: 'Date disabled or slot overlaps',
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  create(@Body() dto: CreateBookingDto) {
    return this.bookings.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List bookings (admin, paginated, sorted createdAt DESC)',
  })
  findAll(@Query() query: ListBookingsDto) {
    return this.bookings.findAll(parsePagination(query));
  }

  @Get('slots')
  @ApiOperation({
    summary:
      'List bookings of a month (public, frontend computes availability)',
  })
  findSlots(@Query() query: ListSlotsDto) {
    return this.bookings.findSlotsByMonth(query.month);
  }

  @Get('disabled-dates')
  @ApiOperation({
    summary: 'List disabled dates (public, ordered date ASC)',
  })
  findDisabledDates() {
    return this.bookings.findAllDisabledDates();
  }

  @UseGuards(JwtAuthGuard)
  @Post('disabled-dates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disable a date (admin)' })
  @ApiResponse({ status: 201, description: 'Date disabled' })
  @ApiResponse({ status: 409, description: 'Date already disabled' })
  createDisabledDate(@Body() dto: CreateDisabledDateDto) {
    return this.bookings.createDisabledDate(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('disabled-dates/:id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Re-enable (delete) a disabled date (admin)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  removeDisabledDate(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.removeDisabledDate(id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a booking (admin)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.remove(id);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AvailabilityClosure, AvailabilityRule } from '../database/schema';
import { AvailabilityService } from './availability.service';
import { type AdminBooking, BookingService } from './booking.service';
import { CancelBookingByOwnerDto } from './dto/cancel-booking-by-owner.dto';
import { CreateAvailabilityClosureDto } from './dto/create-availability-closure.dto';
import { DayParamDto } from './dto/day-param.dto';
import { ListBookingsQueryDto } from './dto/list-bookings-query.dto';
import { ReplaceAvailabilityRulesDto } from './dto/replace-availability-rules.dto';
import { SetDayOpenDto } from './dto/set-day-open.dto';
import type { CalendarDay } from './resolve-day';

type RuleView = Pick<AvailabilityRule, 'weekday' | 'startMinute' | 'endMinute'>;
type ClosureView = Pick<
  AvailabilityClosure,
  'id' | 'startsOn' | 'endsOn' | 'reason'
>;

/**
 * Administration des rendez-vous. Throttle : limite globale, comme les routes admin du contact.
 */
@ApiTags('Booking (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('booking')
export class BookingAdminController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly booking: BookingService,
  ) {}

  @Get('availability/rules')
  @ApiOperation({ summary: 'Weekly availability rules, Paris wall time' })
  async listRules(): Promise<{ data: RuleView[] }> {
    return { data: (await this.availability.listRules()).map(toRuleView) };
  }

  @Put('availability/rules')
  @ApiOperation({ summary: 'Replace the whole weekly availability block' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed | rules_overlap',
  })
  async replaceRules(
    @Body() { rules }: ReplaceAvailabilityRulesDto,
  ): Promise<{ data: RuleView[] }> {
    const stored = await this.availability.replaceRules(rules);
    return { data: stored.map(toRuleView) };
  }

  @Get('availability/closures')
  @ApiOperation({ summary: 'Closures not yet over (Paris dates)' })
  async listClosures(): Promise<{ data: ClosureView[] }> {
    return {
      data: (await this.availability.listClosures()).map(toClosureView),
    };
  }

  @Post('availability/closures')
  @ApiOperation({ summary: 'Close a range of Paris dates (inclusive)' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  async createClosure(
    @Body() dto: CreateAvailabilityClosureDto,
  ): Promise<ClosureView> {
    return toClosureView(await this.availability.createClosure(dto));
  }

  @Delete('availability/closures/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a closure' })
  @ApiResponse({ status: 404, description: 'Not found' })
  deleteClosure(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.availability.deleteClosure(id);
  }

  @Put('availability/days/:date')
  @ApiOperation({
    summary:
      'Set the wanted state of a Paris date (override written or removed)',
  })
  @ApiResponse({ status: 200, description: 'The day after the write' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 409, description: 'day_in_closure' })
  @ApiResponse({ status: 422, description: 'day_in_past | day_out_of_range' })
  setDayOpen(
    @Param() { date }: DayParamDto,
    @Body() { open }: SetDayOpenDto,
  ): Promise<CalendarDay> {
    return this.availability.setDayOpen(date, open);
  }

  @Get('bookings')
  @ApiOperation({
    summary: 'Upcoming (ascending) or past (descending) bookings, any status',
  })
  async listBookings(
    @Query() { scope }: ListBookingsQueryDto,
  ): Promise<{ data: AdminBooking[] }> {
    return { data: await this.booking.listBookings(scope) };
  }

  @Get('bookings/upcoming-count')
  @ApiOperation({ summary: 'Count confirmed bookings not yet over' })
  countUpcoming(): Promise<{ count: number }> {
    return this.booking.countUpcoming();
  }

  @Patch('bookings/:id/cancel')
  @ApiOperation({
    summary: 'Cancel a booking as the owner (idempotent, visitor notified)',
  })
  @ApiResponse({ status: 404, description: 'booking_not_found' })
  @ApiResponse({ status: 409, description: 'cancel_too_late' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() { reason }: CancelBookingByOwnerDto,
  ): Promise<AdminBooking> {
    return this.booking.cancelByOwner(id, reason);
  }
}

const toRuleView = ({
  weekday,
  startMinute,
  endMinute,
}: AvailabilityRule): RuleView => ({ weekday, startMinute, endMinute });

const toClosureView = ({
  id,
  startsOn,
  endsOn,
  reason,
}: AvailabilityClosure): ClosureView => ({ id, startsOn, endsOn, reason });

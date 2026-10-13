import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { BookingScope } from '../booking.service';

const BOOKING_SCOPES = [
  'upcoming',
  'past',
] as const satisfies readonly BookingScope[];

export class ListBookingsQueryDto {
  @ApiProperty({ enum: BOOKING_SCOPES })
  @IsIn(BOOKING_SCOPES)
  scope!: BookingScope;
}

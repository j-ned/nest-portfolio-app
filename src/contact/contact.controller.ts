import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Headers,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { PaginationDto, parsePagination } from '../common/pagination';
import { ContactService } from './contact.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

@ApiTags('Contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  // Un visiteur réel envoie un message ; trois par heure laissent la place à une correction.
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post('messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit a contact message (public, rate-limited 3/h par IP)',
  })
  @ApiResponse({
    status: 201,
    description: 'Message saved (or silently dropped by the honeypot)',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  create(
    @Body() dto: CreateContactMessageDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<void> {
    return this.contact.create(dto, { ip, userAgent: userAgent ?? '' });
  }

  @UseGuards(JwtAuthGuard)
  @Get('messages')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List contact messages (admin, paginated, sorted createdAt DESC)',
  })
  findAll(@Query() query: PaginationDto) {
    return this.contact.findAll(parsePagination(query));
  }

  @UseGuards(JwtAuthGuard)
  @Get('messages/unread-count')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Count unread messages (admin)' })
  unreadCount() {
    return this.contact.unreadCount();
  }

  @UseGuards(JwtAuthGuard)
  @Patch('messages/mark-all-read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark all unread messages as read (admin)' })
  markAllRead() {
    return this.contact.markAllRead();
  }

  @UseGuards(JwtAuthGuard)
  @Patch('messages/:id/read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark a message as read (admin)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.contact.markRead(id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('messages/:id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a message (admin)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.contact.remove(id);
  }
}

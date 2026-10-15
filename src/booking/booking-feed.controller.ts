import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { BookingFeedService } from './booking-feed.service';

/**
 * Flux d'agenda public (ADR-0028) : un client d'abonnement fait un `GET` nu, sans cookie ni
 * en-tête, d'où le jeton dans le chemin et l'absence de garde. Limite de débit globale.
 */
@ApiTags('Booking')
@Controller('booking')
export class BookingFeedController {
  constructor(private readonly feed: BookingFeedService) {}

  @Get('feed/:file')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @ApiOperation({ summary: 'Calendar subscription feed of bookings (public)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async getFeed(
    @Param('file') file: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const body = await this.feed.renderFeed(file);
    // Un seul refus, quel que soit le motif : rien ne distingue un jeton faux d'un lien absent.
    if (body === null) throw new NotFoundException('Not Found');
    // Posé au succès seulement : un `@Header` s'appliquerait aussi au corps JSON du 404.
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    return body;
  }
}

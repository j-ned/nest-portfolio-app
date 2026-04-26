import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
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
import { AnalyticsTrackerService } from './analytics-tracker.service';
import { AnalyticsStatsService } from './analytics-stats.service';
import { TrackEventDto } from './dto/track-event.dto';
import { DateRangeQueryDto, MetricsQueryDto } from './dto/date-range-query.dto';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly tracker: AnalyticsTrackerService,
    private readonly stats: AnalyticsStatsService,
  ) {}

  @Post('track')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 1000 } })
  @ApiOperation({
    summary: 'Track a page-view or custom event (public, fire-and-forget)',
  })
  @ApiResponse({ status: 204, description: 'Tracked (or silently filtered)' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 429, description: 'Throttle exceeded' })
  async track(
    @Body() dto: TrackEventDto,
    @Ip() ip: string,
    @Headers('user-agent') ua: string | undefined,
  ): Promise<void> {
    await this.tracker.track(dto, ip, ua ?? '');
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats/overview')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Aggregate stats over a date range (admin)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  overview(@Query() query: DateRangeQueryDto) {
    return this.stats.overview(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats/chart')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Daily time-series (admin)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  chart(@Query() query: DateRangeQueryDto) {
    return this.stats.chart(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats/metrics')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Top N values for url|referrer|browser|country|os (admin)',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  metrics(@Query() query: MetricsQueryDto) {
    return this.stats.metrics(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats/active')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Active sessions in last 5 minutes (admin)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  active() {
    return this.stats.active();
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats/projects')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Top clicked projects (admin)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  projects(@Query() query: DateRangeQueryDto) {
    return this.stats.projects(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats/articles')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Top viewed articles (admin)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  articles(@Query() query: DateRangeQueryDto) {
    return this.stats.articles(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats/cv-downloads')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'CV download total + 30d timeline (admin)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  cvDownloads(@Query() query: DateRangeQueryDto) {
    return this.stats.cvDownloads(query);
  }
}

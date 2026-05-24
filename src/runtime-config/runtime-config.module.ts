import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { RuntimeConfigController } from './runtime-config.controller';

@Module({
  imports: [AppConfigModule],
  controllers: [RuntimeConfigController],
})
export class RuntimeConfigModule {}

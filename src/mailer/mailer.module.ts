import {
  Global,
  Inject,
  Module,
  OnModuleDestroy,
  type Provider,
} from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { MAIL_TRANSPORTER } from './mailer.constants';
import { MailerService } from './mailer.service';

const transporterProvider: Provider = {
  provide: MAIL_TRANSPORTER,
  inject: [AppConfigService],
  useFactory: (cfg: AppConfigService): Transporter =>
    createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      secure: cfg.smtpSecure,
      auth: {
        user: cfg.smtpUser,
        pass: cfg.smtpPass,
      },
    }),
};

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [transporterProvider, MailerService],
  exports: [MailerService],
})
export class MailerModule implements OnModuleDestroy {
  constructor(
    @Inject(MAIL_TRANSPORTER) private readonly transporter: Transporter,
  ) {}

  onModuleDestroy(): void {
    this.transporter.close();
  }
}

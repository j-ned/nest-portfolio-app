import { resolve } from 'node:path';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  contactMessages,
  type ContactMessage,
} from '../database/schema';
import { MailerService } from '../mailer/mailer.service';
import { loadTemplate, renderTemplate } from '../mailer/mailer.utils';
import {
  type PaginatedResult,
  type PaginationParams,
} from '../common/pagination';
import { fireAndForget } from '../common/utils';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

const CONTACT_RECIPIENT = 'contact@nedellec-julien.fr';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);
  private static readonly TEMPLATES_DIR = resolve(__dirname, 'mail-templates');

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly mailer: MailerService,
  ) {}

  async create(dto: CreateContactMessageDto): Promise<ContactMessage> {
    const [row] = await this.db.insert(contactMessages).values(dto).returning();
    // Fire-and-forget : DB write garanti, mails best-effort (SMTP down → admin panel).
    fireAndForget(
      this.sendNotificationMails(row),
      this.logger,
      `Failed to send contact mails for ${row.id}`,
    );
    return row;
  }

  async findAll(
    params: PaginationParams,
  ): Promise<PaginatedResult<ContactMessage>> {
    const [totalRow, data] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(contactMessages),
      this.db
        .select()
        .from(contactMessages)
        .orderBy(desc(contactMessages.createdAt))
        .limit(params.limit)
        .offset(params.offset),
    ]);
    return {
      data,
      total: totalRow[0]?.count ?? 0,
      page: params.page,
      limit: params.limit,
    };
  }

  async unreadCount(): Promise<{ count: number }> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(contactMessages)
      .where(eq(contactMessages.read, false));
    return { count: row?.count ?? 0 };
  }

  async markRead(id: string): Promise<ContactMessage> {
    const [row] = await this.db
      .update(contactMessages)
      .set({ read: true })
      .where(eq(contactMessages.id, id))
      .returning();
    if (!row) throw new NotFoundException(`Contact message ${id} not found`);
    return row;
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db
      .delete(contactMessages)
      .where(eq(contactMessages.id, id))
      .returning({ id: contactMessages.id });
    if (rows.length === 0)
      throw new NotFoundException(`Contact message ${id} not found`);
  }

  // Helper privé non-bloquant. Les erreurs sont catch chez l'appelant.
  private async sendNotificationMails(msg: ContactMessage): Promise<void> {
    const adminTpl = loadTemplate(
      resolve(ContactService.TEMPLATES_DIR, 'contact-notification.html'),
    );
    const visitorTpl = loadTemplate(
      resolve(ContactService.TEMPLATES_DIR, 'contact-confirmation.html'),
    );
    const variables = {
      name: msg.name,
      email: msg.email,
      subject: msg.subject,
      message: msg.message,
    };
    await Promise.all([
      this.mailer.sendMail({
        to: CONTACT_RECIPIENT,
        subject: `Nouveau message de contact: ${msg.subject}`,
        html: renderTemplate(adminTpl, variables),
      }),
      this.mailer.sendMail({
        to: msg.email,
        subject: 'Confirmation de votre message',
        html: renderTemplate(visitorTpl, variables),
      }),
    ]);
  }
}

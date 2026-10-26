import { createHash, createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { AppConfigService } from '../config/app-config.service';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { contactMessages, type ContactMessage } from '../database/schema';
import { OWNER_EMAIL } from '../mailer/mailer.constants';
import { MailerService } from '../mailer/mailer.service';
import { loadTemplate, renderTemplate } from '../mailer/mailer.utils';
import {
  type PaginatedResult,
  type PaginationParams,
} from '../common/pagination';
import { fireAndForget } from '../common/utils';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

const USER_AGENT_MAX_LENGTH = 300;

export type ContactSender = { ip: string; userAgent: string };

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);
  private static readonly TEMPLATES_DIR = resolve(__dirname, 'mail-templates');

  /**
   * Clé de l'empreinte d'expéditeur, dérivée du secret JWT et distincte de celle de l'analytics.
   * Sans jour dans l'empreinte : deux messages d'une même IP restent reliés d'un jour à l'autre.
   */
  private readonly senderHashKey: Buffer;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly mailer: MailerService,
    cfg: AppConfigService,
  ) {
    this.senderHashKey = createHash('sha256')
      .update(`contact|${cfg.jwtSecret}`)
      .digest();
  }

  /** Ne renvoie rien : un robot ne distingue pas un message enregistré d'un message écarté. */
  async create(
    dto: CreateContactMessageDto,
    sender: ContactSender,
  ): Promise<void> {
    if (dto.website) {
      // Champ piège rempli : même réponse qu'un envoi, rien d'écrit ni d'envoyé.
      this.logger.warn('Contact honeypot filled: message dropped');
      return;
    }

    const [row] = await this.db
      .insert(contactMessages)
      .values({
        name: dto.name,
        email: dto.email,
        subject: dto.subject,
        message: dto.message,
        senderHash: createHmac('sha256', this.senderHashKey)
          .update(sender.ip)
          .digest('hex'),
        userAgent: sender.userAgent.slice(0, USER_AGENT_MAX_LENGTH) || null,
      })
      .returning();
    // Fire-and-forget : DB write garanti, mail best-effort (SMTP down → admin panel).
    fireAndForget(
      this.sendNotificationMail(row),
      this.logger,
      `Failed to send contact mail for ${row.id}`,
    );
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

  async markAllRead(): Promise<{ count: number }> {
    const rows = await this.db
      .update(contactMessages)
      .set({ read: true })
      .where(eq(contactMessages.read, false))
      .returning({ id: contactMessages.id });
    return { count: rows.length };
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db
      .delete(contactMessages)
      .where(eq(contactMessages.id, id))
      .returning({ id: contactMessages.id });
    if (rows.length === 0)
      throw new NotFoundException(`Contact message ${id} not found`);
  }

  /**
   * Seul le propriétaire est notifié. Pas d'accusé de réception à l'adresse saisie : n'importe
   * qui pourrait y mettre celle d'un tiers et faire envoyer, signé SPF/DKIM du domaine, un mail
   * reprenant un nom ou un sujet piégé (une URL en texte brut reste cliquable chez le client).
   */
  private async sendNotificationMail(msg: ContactMessage): Promise<void> {
    const template = loadTemplate(
      resolve(ContactService.TEMPLATES_DIR, 'contact-notification.html'),
    );
    await this.mailer.sendMail({
      to: OWNER_EMAIL,
      subject: `Nouveau message de contact: ${msg.subject}`,
      html: renderTemplate(template, {
        name: msg.name,
        email: msg.email,
        subject: msg.subject,
        message: msg.message,
        year: String(new Date().getFullYear()),
      }),
    });
  }
}

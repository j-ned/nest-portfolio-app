import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Database } from '../database/drizzle.types';
import {
  PROFILE_ROW_ID,
  profileContent,
  type ProfileContentRow,
} from '../database/schema/profile-content';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { ProfileContent, ProfileDocument } from './profile-content';

/** Transaction Drizzle : même API de requête que la base. */
export type ProfileTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

/** La ligne du parcours ; absente (base sans la migration de seed) ⇒ 404. */
export async function findProfileRow(db: Database): Promise<ProfileContentRow> {
  const [row] = await db
    .select()
    .from(profileContent)
    .where(eq(profileContent.id, PROFILE_ROW_ID))
    .limit(1);
  return foundOr404(row);
}

/**
 * La ligne du parcours, verrouillée (`FOR UPDATE`) jusqu'à la fin de la transaction : toute autre
 * opération portrait attend, puis lit l'état laissé par la première.
 */
export async function lockProfileRow(
  tx: ProfileTransaction,
): Promise<ProfileContentRow> {
  const [row] = await tx
    .select()
    .from(profileContent)
    .where(eq(profileContent.id, PROFILE_ROW_ID))
    .for('update')
    .limit(1);
  return foundOr404(row);
}

function foundOr404(row: ProfileContentRow | undefined): ProfileContentRow {
  if (!row) throw new NotFoundException('Profile content not found');
  return row;
}

/** Bucket des médias du site (même bucket que projets et articles). */
export const PROFILE_BUCKET = 'portfolio-storage';

/**
 * Ligne ⇒ réponse publique : contenu à plat, version, date, URL du portrait courant (`null` =
 * portrait par défaut du front). La clé précédente, gardée pour les pages déjà servies, n'est jamais exposée.
 */
export function toProfileDocument(
  row: ProfileContentRow,
  toUrl: (key: string) => string,
): ProfileDocument {
  return {
    ...row.content,
    version: row.version,
    updatedAt: row.updatedAt,
    portrait: row.portraitKey ? toUrl(row.portraitKey) : null,
  };
}

/**
 * Corps validé ⇒ contenu stocké : objets simples recopiés champ par champ (ni `version`, ni
 * instance de DTO dans le `jsonb`, ordre des clés canonique).
 */
export function toProfileContent(dto: UpdateProfileDto): ProfileContent {
  const { biography, motivation } = dto;
  return {
    biography: {
      title: biography.title,
      summary: biography.summary,
      leadEmphasis: biography.leadEmphasis,
      paragraphs: [...biography.paragraphs],
    },
    highlights: dto.highlights.map(({ id, title, description }) => ({
      id,
      title,
      description,
    })),
    workSummary: dto.workSummary,
    whatIDo: dto.whatIDo.map(({ id, title, description }) => ({
      id,
      title,
      description,
    })),
    technologies: dto.technologies.map(({ id, name, category, icon }) => ({
      id,
      name,
      category,
      icon,
    })),
    diplomasSummary: dto.diplomasSummary,
    diplomas: dto.diplomas.map(
      ({ id, title, provider, level, shortDescription, skills }) => ({
        id,
        title,
        provider,
        level,
        shortDescription,
        skills: [...skills],
      }),
    ),
    motivation: {
      title: motivation.title,
      statement: motivation.statement,
      description: motivation.description,
    },
  };
}

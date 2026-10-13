import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class CancelTokenDto {
  @ApiProperty({
    pattern: '^[A-Za-z0-9_-]{43}$',
    description: 'Jeton d’annulation reçu par email (fragment du lien)',
  })
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Length,
  Matches,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

// Custom validator: exactement un des deux champs (code OU backupCode) doit être fourni
function IsExactlyOneOf(fields: string[], options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'IsExactlyOneOf',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const obj = args.object as Record<string, unknown>;
          const provided = fields.filter(
            (f) => obj[f] !== undefined && obj[f] !== null && obj[f] !== '',
          );
          return provided.length === 1;
        },
        defaultMessage(args: ValidationArguments) {
          return `Exactly one of [${fields.join(', ')}] must be provided (got: ${
            fields.filter(
              (f) => (args.object as Record<string, unknown>)[f] !== undefined,
            ).length
          })`;
        },
      },
    });
  };
}

export class TwoFactorVerifyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  challengeToken!: string;

  @ApiPropertyOptional({
    example: '123456',
    description: 'TOTP 6-digit code (mutually exclusive with backupCode)',
  })
  @IsOptional()
  @IsString()
  @Length(6, 6)
  @IsExactlyOneOf(['code', 'backupCode'])
  code?: string;

  @ApiPropertyOptional({
    example: 'a1b2-c3d4',
    description:
      'Backup code in xxxx-xxxx format (mutually exclusive with code)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]{4}-[a-z0-9]{4}$/)
  backupCode?: string;
}

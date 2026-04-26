import { ApiProperty } from '@nestjs/swagger';

export class UploadCvResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  fileKey!: string;

  @ApiProperty()
  fileSize!: number;

  @ApiProperty({ default: 'application/pdf' })
  mimeType!: string;

  @ApiProperty({ format: 'date-time' })
  uploadedAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

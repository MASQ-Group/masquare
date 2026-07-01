import { IsArray, IsUUID } from 'class-validator';

export class SetParticipantsDto {
  /** Companies that have this module enabled (and, for shareable modules, co-own its
   *  records). Replaces the current participant set. */
  @IsArray()
  @IsUUID('all', { each: true })
  companyIds!: string[];
}

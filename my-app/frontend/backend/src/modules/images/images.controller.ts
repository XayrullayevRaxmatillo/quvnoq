import { Body, Controller, Get, Inject, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import type { GuestSessionDoc } from '../../models/GuestSession';
import { Guest } from '../../common/decorators/guest.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ActionLimit } from '../../common/rate-limit/rate-limit.decorator';
import { ImagesService } from './images.service';

const uploadSchema = z.object({ data: z.string().max(760_000) }).strict();

@Controller('images')
export class ImagesController {
  constructor(@Inject(ImagesService) private readonly images: ImagesService) {}

  @Post()
  @ActionLimit(60, 60 * 60_000)
  upload(@Guest() guest: GuestSessionDoc, @Body(new ZodValidationPipe(uploadSchema)) body: z.output<typeof uploadSchema>) {
    return this.images.upload(guest, body.data);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const img = await this.images.get(id);
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The frontend may live on another origin (e.g. Vercel), so images must be embeddable cross-origin.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(img.data);
  }
}

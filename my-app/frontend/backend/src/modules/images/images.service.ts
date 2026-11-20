import { Injectable } from '@nestjs/common';
import { Image } from '../../models/misc';
import type { GuestSessionDoc } from '../../models/GuestSession';
import { badRequest, notFound, requireObjectId } from '../../utils/http';

const MAX_BYTES = 512 * 1024;

/** Detect the real file type from magic bytes — never trust the client-declared type. */
function sniff(buf: Buffer): 'image/webp' | 'image/png' | 'image/jpeg' | null {
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

@Injectable()
export class ImagesService {
  /**
   * Upload: the client resizes to ≤1200px and re-encodes as WebP via canvas (which drops EXIF),
   * then sends a base64 data URL. The server verifies type and size.
   */
  async upload(guest: GuestSessionDoc, data: string): Promise<{ url: string }> {
    const match = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(data);
    if (!match) throw badRequest('IMAGE_INVALID');
    const buf = Buffer.from(match[2], 'base64');
    if (buf.length === 0 || buf.length > MAX_BYTES) throw badRequest('IMAGE_INVALID');
    const mime = sniff(buf);
    if (!mime) throw badRequest('IMAGE_INVALID');
    const img = await Image.create({ data: buf, mime, size: buf.length, owner: guest._id });
    return { url: `/api/v1/images/${img._id.toString()}` };
  }

  async get(id: string): Promise<{ mime: string; data: Buffer }> {
    const imageId = requireObjectId(id);
    const img = await Image.findById(imageId).lean();
    if (!img) throw notFound();
    return { mime: img.mime, data: Buffer.from(img.data as unknown as Buffer) };
  }
}

import { PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';
import { parse } from '../../utils/http';

/**
 * Validates a request part with a Zod schema (shared with the frontend).
 * Usage: @Body(new ZodValidationPipe(schema)) body: z.output<typeof schema>
 */
export class ZodValidationPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    // Express 5 leaves req.body undefined when a request has no JSON body.
    return parse(this.schema, value ?? {});
  }
}

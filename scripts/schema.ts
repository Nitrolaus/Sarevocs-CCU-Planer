import fs from 'node:fs';
import { z } from 'zod';
import { documentSchema } from '../src/domain/model';
fs.writeFileSync('docs/inventory-v1.schema.json', JSON.stringify(z.toJSONSchema(documentSchema), null, 2) + '\n');

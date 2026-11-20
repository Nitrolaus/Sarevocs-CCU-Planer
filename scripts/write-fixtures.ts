import fs from 'node:fs';
import { demoDocument, foreignDocument } from '../tests/fixtures';
fs.mkdirSync('tests/fixtures', { recursive: true });
fs.writeFileSync('tests/fixtures/demo-inventory.json', JSON.stringify(demoDocument(), null, 2) + '\n');
fs.writeFileSync('tests/fixtures/hangarlink-v2-synthetic.json', JSON.stringify(foreignDocument(), null, 2) + '\n');

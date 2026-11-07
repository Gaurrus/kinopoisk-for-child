import { cpSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const source = resolve('src/renderer');
const target = resolve('dist/renderer');

cpSync(source, target, {
  recursive: true,
  filter: (entry) => {
    if (statSync(entry).isDirectory()) return true;
    return /\.(html|css)$/i.test(entry);
  },
});

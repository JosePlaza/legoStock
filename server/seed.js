import fs from 'node:fs';
import path from 'node:path';
import * as repo from './db.js';

const file = process.argv[2] || path.join(repo.ROOT, 'data', 'catalog.json');
const r = repo.importCatalog(JSON.parse(fs.readFileSync(file, 'utf8')));
console.log(`Catálogo importado (${file}): ${r.designs} piezas, ${r.elements} variantes, ${r.colors} colores. El stock no se ha tocado.`);

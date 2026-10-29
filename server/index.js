// Arranque local: API + web compilada (npm start) y el catálogo de Supabase cada 15 min.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { app, handleErrors } from './app.js';
import { ROOT } from './db.js';
import { watchSupabaseCatalog } from './lego-sync.js';

const PORT = process.env.PORT || 3001;
const DIST = path.join(ROOT, 'web', 'dist');

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}
app.use(handleErrors);

app.listen(PORT, () => {
  console.log(`LegoStock API en http://localhost:${PORT}`);
  watchSupabaseCatalog();
});

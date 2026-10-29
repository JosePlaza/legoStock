// Función de Vercel: toda la API (/api/*) la atiende la app Express de server/app.js.
import { app, handleErrors } from '../server/app.js';

app.use(handleErrors);
export default app;

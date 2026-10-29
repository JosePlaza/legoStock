# LegoStock

Registro personal de stock de piezas LEGO, con el catálogo de **LEGO Pick a Brick**
(imagen, nombre, ID, colores y precio) y un **comparador de listas de Rebrickable**
que te dice qué piezas tienes y cuáles te faltan.

## Arrancar

Requisitos: Node 18.18 o superior y un proyecto de [Supabase](https://supabase.com) (gratis).

### 1. Supabase (una sola vez)
1. **SQL Editor → New query**: pega `supabase/schema.sql` entero y pulsa *Run*.
   Crea las tablas de stock, movimientos, proyectos y archivos, con seguridad por usuario (RLS),
   las funciones `adjust_stock` y el bucket privado `project-files` para los PDF/imágenes.
2. **Authentication → Sign In / Providers → Email**: desactiva **Confirm email**
   (el registro no se verifica por correo).
3. Copia `.env.example` a `.env` y pon `SUPABASE_URL` y `SUPABASE_ANON_KEY`
   (Project Settings → API; la clave *anon* / *publishable*, nunca la *service_role*).

### 2. App
```bash
npm install
npm run dev        # API en :3001 + web en http://localhost:5173
```
Crea tu cuenta en la pantalla de registro y entra.

### 3. Importar los datos de antes (solo la primera vez)
Al entrar verás el aviso **«Tienes datos guardados en este ordenador…»** → **Importar a mi cuenta**.
Sube a tu cuenta el stock, el historial de movimientos, los proyectos y sus archivos, y comprueba
lote a lote que todo el stock está en la nube. Se puede repetir sin duplicar nada y **no borra la copia local**
(`data/legostock.db`). Hay además una copia de seguridad en `data/backups/` (base de datos, CSV del stock y JSON).

## Qué hace

- **Catálogo**: todas las piezas de Pick a Brick con búsqueda (nombre, ID de diseño o nº de elemento),
  filtros por categoría/subcategoría/color/disponibilidad y orden. Insignia verde = unidades que tienes.
- **Ficha de pieza**: eliges color (cambia imagen, nº de elemento y precio) y sumas / restas / escribes la cantidad.
- **Mi stock**: solo lo que tienes. En la cabecera, total de piezas, lotes y valor según precios LEGO.
- **Proyectos**: cada CSV de Rebrickable (export de set o lista `Part,Color,Quantity`, o `inventory_parts.csv`)
  se guarda como proyecto. La lista muestra % completado con tu stock actual y el coste de lo que falta.
  En el detalle: tabla pieza a pieza (tengo / parcial / falta / agotada en LEGO), exportar CSV de lo que falta,
  sumar todo el set a tu stock, notas y **adjuntos** (PDF de instrucciones o imágenes, con visor integrado).
  Si el nombre del CSV lleva el nº de set (`10294-1`) se usa la foto del set de Rebrickable.

- **Wishlist**: sets que quieres comprar. Al poner el número rellena nombre, tema, año, piezas e imagen (Rebrickable),
  guarda su inventario para decirte **qué % de piezas ya tienes** (y con otros colores), tu **PVP** y tu **precio objetivo**,
  y el mejor precio de **BrickLink** nuevo/usado con envío estimado. Avisa si alguno baja de tu objetivo y puedes convertir el set en proyecto.
- **Buscar**: sets y piezas por nombre o número (Rebrickable) con la guía de precios de BrickLink:
  nuevo/usado × vendedores de tu país / UE / mundo, lote más barato que envía, media, nº de lotes, vendidos en 6 meses
  y total con el envío estimado (⚙ Ajustes: país, divisa y envío por región). Las respuestas se guardan 12 h en caché.

### Claves de APIs externas (en `.env`)
- `REBRICKABLE_API_KEY` (gratis): rebrickable.com → tu perfil → Settings → API → *Generate new API key*.
- `BRICKOWL_API_KEY`: brickowl.com → My Account → API Keys. Para listar las tiendas que venden cada set/pieza
  BrickOwl debe aprobar la clave para el catálogo (*catalog approval*).
- `BRICKLINK_CONSUMER_KEY/SECRET`, `BRICKLINK_TOKEN_VALUE/SECRET`: con sesión iniciada en BrickLink abre
  `https://www.bricklink.com/v2/api/register_consumer.page`, registra el *consumer* y crea un *access token* con IP `0.0.0.0`.
- Tras añadirlas, reinicia `npm run dev`. Después de actualizar, vuelve a ejecutar `supabase/schema.sql` (añade `wishlist` y `user_settings`).

### Colores de Rebrickable
Rebrickable numera los colores distinto que LEGO. `server/rebrickable-colors.js` trae la correspondencia
de los colores habituales; si aparece uno sin asignar, la app te deja elegir el color LEGO y lo recuerda
(tabla `rb_color_map`). Los números de pieza con sufijo (`3069b`) se buscan también sin él (`3069`).

## Actualizar el catálogo (precios, agotados, piezas nuevas)

Botón **↻ Catálogo** → **Actualizar ahora**: la API descarga Pick a Brick desde tu ordenador (~1–2 min),
actualiza precios y disponibilidad sin tocar tu stock y te enseña qué ha cambiado
(agotadas, vuelven a estar, cambios de precio, nuevas, retiradas), marcando las que tienes.

El catálogo es **compartido** por todas las cuentas y vive en Supabase con su historial de cambios
(`catalog_snapshot`, `catalog_syncs`, `catalog_changes`). Solo lo escribe la Edge Function `sync-catalog`:
la descarga diaria, «Actualizar ahora» y «Importar archivo» pasan por ella, y para eso la API necesita
`CATALOG_CRON_SECRET` en `.env`. «Actualizar ahora» e «Importar archivo» solo aparecen a los correos
de `ADMIN_EMAILS` (si está vacío: en local, a todos; en Vercel, a nadie).

Además **Supabase lo actualiza solo cada día** a las 03:00 UTC, aunque la API no esté arrancada:
`pg_cron` → Edge Function `sync-catalog` → tablas `catalog_snapshot` (el catálogo) y `catalog_sync_runs`
(fecha, resultado y error de cada intento). La API local se trae el catálogo de Supabase al arrancar, cada 15 min
y al volver a la pestaña si hay uno más nuevo. De paso, el cron mantiene activo el proyecto de Supabase.

Puesta en marcha (una vez):

```bash
supabase login                                     # con la cuenta dueña del proyecto
SECRET=$(openssl rand -hex 24)
supabase secrets set CATALOG_CRON_SECRET=$SECRET --project-ref <ref>
supabase functions deploy sync-catalog --no-verify-jwt --project-ref <ref>
```

Si la creas desde el panel de Supabase (Edge Functions → *Create new function*, llamada `sync-catalog`):
pega `index.ts` y añade con **Add File** `pick-a-brick.js` y `catalog-diff.js` (los tres de
`supabase/functions/sync-catalog/`). En la configuración de la función desactiva **Verify JWT**.

En el SQL Editor: `select vault.create_secret('https://<ref>.supabase.co', 'project_url');`,
`select vault.create_secret('<$SECRET>', 'catalog_cron_secret');` y después los bloques **v5** y **v6** de `supabase/schema.sql`.
Para probarlo sin esperar: `select public.catalog_sync_kick('manual');` y mira `catalog_sync_runs`.

Si LEGO bloquease la descarga desde Node, alternativa manual: abre Pick a Brick en Chrome, pega
`scripts/extract-catalog.js` en la consola → descarga `legostock-catalog.json` → **↻ Catálogo → Importar archivo**.

## Publicar en Vercel

La web se sirve como estática (`web/dist`) y la API como una función (`api/index.js` → `server/app.js`).
La configuración está en `vercel.json`; `.vercelignore` deja fuera la base local y sus copias.

1. Importa el proyecto en Vercel (desde Git o con `npx vercel` en esta carpeta). No hace falta tocar
   el *framework*, el comando de build ni la carpeta de salida: los fija `vercel.json`.
2. **Settings → Environment Variables**: las mismas que en `.env` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `REBRICKABLE_API_KEY`, las de BrickLink y BrickOwl, `CATALOG_CRON_SECRET` y `ADMIN_EMAILS`).
3. En Supabase, **Authentication → URL Configuration**: pon la URL de Vercel en *Site URL* y en *Redirect URLs*.
4. En **Settings → Functions**, elige la región más cercana a tu proyecto de Supabase.

Diferencias con la versión local:
- La base SQLite vive en `/tmp` y se vacía cuando Vercel apaga la función. Al arrancar se carga
  `data/catalog.json` (va en el despliegue) y en la primera petición se trae el catálogo de Supabase si es más nuevo.
  No se pierde nada: el catálogo y su historial están en Supabase.
- **Actualizar ahora** no descarga desde Vercel: lanza la descarga en la Edge Function `sync-catalog` y espera a que termine.
- Los archivos de proyecto (PDF, imágenes) se suben desde el navegador directamente a Supabase Storage,
  así que el límite es el de Supabase (50 MB por archivo en el plan gratuito), no los 4,5 MB de Vercel.
- La importación de los datos antiguos (`data/legostock.db`) solo tiene sentido en local.

## Estructura

```
server/db.js                 base local SQLite: catálogo, stock_cache y datos antiguos
server/rebrickable.js        lectura de CSV y comparación
server/rebrickable-colors.js mapa de colores Rebrickable → LEGO
server/lego-sync.js          descarga del catálogo desde lego.com
server/projects.js           proyectos y adjuntos (Supabase)
server/supabase.js           conexión y autenticación
server/userdata.js           stock y colores del usuario (Supabase)
server/migrate.js            importación de los datos locales anteriores
supabase/schema.sql          tablas, RLS, funciones y bucket
server/app.js                API Express (rutas)
server/index.js              arranque local (API + web compilada)
api/index.js                 la misma API como función de Vercel
web/                         frontend Vue 3 + Vite
web/public/                  favicon, iconos de app y manifest
web/src/components/LogoMark.vue, BrickSpinner.vue   logo y spinner de carga
data/catalog.json            catálogo extraído de Pick a Brick
data/legostock.db            catálogo + datos antiguos (no se sube a git)
data/backups/                copias de seguridad
data/projects/               PDFs e imágenes adjuntos
```

Tablas: `colors`, `categories`, `subcategories`, `designs` (pieza), `elements` (pieza+color, con precio e imagen),
`stock` (design_id + color_id → cantidad), `movements` (historial), `rb_color_map`,
`projects`, `project_files`. En Supabase, además: `catalog_snapshot`, `catalog_sync_runs`,
`catalog_syncs` / `catalog_changes` (historial de actualizaciones del catálogo).

### Dónde está cada cosa
- **Supabase** (por usuario, con RLS): `stock`, `movements`, `rb_color_map`, `projects`, `project_files` + Storage `project-files/<user_id>/<proyecto>/…`.
- **Local** (`data/legostock.db`): el catálogo de LEGO (público, se regenera) y `stock_cache`, una copia temporal del stock
  del usuario para filtrar y ordenar con SQL. Las tablas antiguas (`stock`, `projects`…) se conservan solo como origen de la importación.
- La API (Express) verifica el token de Supabase de cada petición y habla con Supabase *como el usuario*, así que las políticas RLS se aplican siempre.

## Notas
- Las imágenes se cargan desde el CDN de LEGO en tu navegador; los precios son los de Pick a Brick en la fecha de extracción.
- Pick a Brick solo incluye piezas que LEGO vende ahora; las de una lista Rebrickable que no estén aparecen como "No está en Pick a Brick".
- Datos, imágenes y precios © LEGO. Uso personal.
# legoStock

# Gastos del viaje

App web para dividir los gastos de un viaje entre dos amigos. Se usa desde el celular (se puede instalar como app) o la compu, y guarda todo en Supabase.

## Qué hace

- **Subís la foto de un ticket o el PDF de una factura** y la app lee el total, la fecha, la moneda, el comercio y **los últimos 4 dígitos de la tarjeta**. Si esa terminación está registrada, sabe solo quién pagó.
- **Verificación por tarjeta** en cada gasto: ✓ la tarjeta es de quien figura como pagador, ⚠ es de la otra persona, ? terminación no registrada (un toque para asignarla).
- **Carga manual** para lo que no tiene ticket (efectivo, propinas, transporte).
- Cada comprobante queda **pendiente** hasta que lo revisás; los pendientes no cuentan en el balance.
- **División por gasto**: 50/50, todo de uno, o el porcentaje/monto que quieran.
- **Multimoneda**: cotización por moneda para todo el viaje, o una propia por gasto (la del resumen de la tarjeta, por ejemplo).
- **Resumen**: quién le debe a quién, tabla comparativa (quién puso más plata y la diferencia), y totales por categoría, por día, por moneda y por tarjeta. Presupuesto con lo que queda por día.
- **Saldar**: registrás los pagos entre ustedes (en cualquier moneda) y el saldo se actualiza.
- **Facturas**: galería de todos los comprobantes con visor y búsqueda (también en el texto leído).
- **Exportar** a CSV (Excel/Sheets) y backup JSON. Si uno carga algo, al otro le aparece solo.
- **Wallet de pases y reservas**: subís los PDFs o capturas de tarjetas de embarque, reservas de hotel, tickets de tren o entradas y quedan como tarjetas tipo Apple Wallet, **ordenadas por día y por persona**, con el QR/Aztec/PDF417 listo para escanear. Si un PDF trae los pases de los dos, **se divide solo**: cada uno queda con un PDF con sus páginas. Funciona **sin conexión** (lo último que abriste queda guardado en el teléfono).

## Puesta en marcha

### 1. Supabase

1. Creá un proyecto en [supabase.com](https://supabase.com) (o usá uno existente).
2. Abrí **SQL Editor**, pegá el contenido de `supabase/migrations/20261031000000_gastos_viaje.sql` y ejecutalo. Crea las tablas, la seguridad (RLS) y el bucket privado `receipts`. Se puede volver a correr sin problema.
   - Con la CLI: `npx supabase link --project-ref <ref>` y `npx supabase db push`.
   - Para la **Wallet** corré también `supabase/migrations/20261113000000_documentos.sql` (agrega la tabla de pases y reservas; usa el mismo bucket).
3. **Authentication → Sign In / Providers → Email**: dejalo habilitado. Si no querés depender del mail de confirmación, desactivá "Confirm email" (o creá los dos usuarios desde **Authentication → Users → Add user** con "Auto confirm").
4. **Authentication → URL Configuration**: poné como Site URL la dirección donde publiques la app (y `http://localhost:5173` para probar).

### 2. La app

```bash
cp .env.example .env.local   # completá URL y publishable key (Project Settings → API Keys)
npm install
npm run dev                   # http://localhost:5173 (con --host también desde el celu en la misma red)
```

### 3. Primer uso

1. Creá tu cuenta y el viaje: nombre, moneda base (en la que se calculan los saldos), fechas y **el email de tu amigo**.
2. Tu amigo crea su cuenta **con ese mismo email** y ve el mismo viaje.
3. En **Config → Personas** completen el **nombre en pasajes** (apellido y nombre como en el pasaporte, ej. `PEREZ SANTIAGO`): con eso la Wallet reconoce de quién es cada pase aunque en la app usen un apodo.
4. En **Config → Tarjetas** carguen los últimos 4 dígitos de las tarjetas de cada uno. Si pagan con Apple Pay o Google Pay, el ticket muestra el número virtual del celular (Wallet → la tarjeta → "Número de cuenta del dispositivo"): cárguenlo también.
5. Si van a gastar en otra moneda, cargá la cotización en **Config → Cotizaciones** (o al guardar el primer gasto en esa moneda).

### 4. Publicarla (para usarla en el viaje)

Cualquier hosting estático sirve. Con Vercel: importá el repo (o `npx vercel`), build `npm run build`, carpeta `dist`, y las variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Agregá esa URL en Supabase → Authentication → URL Configuration.

En el celular, abrila y usá "Agregar a pantalla de inicio" para tenerla como app. El botón **📷 Ticket** abre la cámara desde cualquier pantalla.

## Wallet: cómo divide y ordena

- Cada página se renderiza y se buscan códigos QR, Aztec, PDF417 y Data Matrix. Las tarjetas de embarque traen en el código (estándar IATA) el nombre del pasajero, vuelo, origen, destino, fecha, asiento y código de reserva: con eso se sabe de quién es y se completa el pase.
- Un código = un pase. Las páginas sin código se suman al documento anterior, salvo que sean de otra persona o de otra reserva. Una reserva de hotel con los dos nombres queda como **Ambos**.
- Antes de guardar ves la propuesta y podés cambiar la persona, la fecha, unir o separar páginas, o descartar algo.
- El código se guarda recortado (blanco y negro) junto con los datos, así se ve sin internet; tocándolo se agranda a pantalla completa (los PDF417 se giran para usar todo el alto). Subí el brillo para escanearlo.
- **Apodos**: si en la app usan apodos y en los pasajes figura el nombre real, la Wallet muestra **"¿Quién es quién?"** con los nombres que no reconoce; elegís de quién es cada uno, queda guardado como "nombre en pasajes" y se reasignan sus documentos. También aprende cuando cambiás a mano la persona de un pase.
- Lee **ciudades y estaciones**: debajo de los códigos de aeropuerto muestra la ciudad, en trenes y buses origen y destino (y llegada, coche, asiento), y en hoteles la ciudad.
- **Volver a leer** (arriba en la Wallet, o en cada pase) relee los documentos ya guardados con la versión actual, sin volver a subirlos. Lo que corregiste a mano no se pisa.
- **PDF de Juli / PDF de Santi** arma un solo PDF con todos los pases y reservas de esa persona.
- Al pie de cada pase o reserva está el **documento original**: las páginas de ese pase a la vista (con Abrir y Descargar) y, si venía en un PDF compartido, el **archivo completo** tal como se subió. Los documentos quedan guardados en el teléfono, así que también se abren sin conexión.

## Lectura con IA (opcional)

Sin configurar nada, los tickets se leen con OCR en el propio dispositivo (Tesseract, gratis; los PDFs digitales se leen directo). Funciona bien con tickets impresos nítidos. Para fotos difíciles (arrugadas, torcidas, con poca luz) conviene la lectura con Claude:

```bash
npx supabase functions deploy extract-receipt --project-ref <ref>
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref <ref>
```

En modo "Automático" (Config → Lectura de tickets) la app usa la IA si la función responde y si no vuelve al OCR local. La función:

- descarga el archivo con el usuario logueado, así que respeta los permisos del viaje;
- usa `claude-opus-5-5` con esfuerzo bajo y salida estructurada (JSON schema); se puede cambiar el modelo con el secret `ANTHROPIC_MODEL`;
- tiene activado el *fallback* del servidor (`fallbacks: "default"`): si un filtro de seguridad rechazara una imagen, la reintenta otro modelo en vez de fallar.

Cada lectura cuesta del orden de 1-2 centavos de dólar (una imagen de ticket y una respuesta corta).

## Seguridad

- Solo ven y editan un viaje quien lo creó y las personas cuyo email figura en el viaje (políticas RLS en todas las tablas).
- Los comprobantes están en un bucket **privado**; se muestran con URLs firmadas que vencen en 1 hora.
- La publishable key es pública por diseño: la protección la dan las políticas.

## Cómo se calcula el saldo

Para cada persona: **pagó − le corresponde + pagos que envió − pagos que recibió**. Si da positivo, el otro le debe eso. "Le corresponde" es su parte de cada gasto según la división. Los pendientes y los gastos sin cotización no entran (la app avisa cuántos hay).

## Desarrollo

```bash
npm test          # tests del lector de tickets y de pases, del cálculo de saldos y de formatos
npm run build     # chequeo de tipos + build de producción
```

- `src/lib/receiptParser.ts`: heurísticas para sacar total, fecha, moneda y terminación de tarjeta del texto.
- `src/lib/calc.ts`: conversión de monedas, verificación por tarjeta, saldos y resúmenes.
- `src/lib/receipts.ts`: flujo subir → leer (IA u OCR) → borrador.
- `src/lib/travelParser.ts`: código de tarjeta de embarque, de quién es cada pase, tipo de documento y cómo dividir un archivo.
- `src/lib/travelDocs.ts`: render de páginas, lectura de códigos, recorte y PDF por persona.
- `src/components/`: pantallas (Resumen, Wallet, Gastos, Cargar, Facturas, Saldar, Config) y los editores.
- `public/sw.js`: guarda la app en el teléfono para abrirla sin conexión.
- `supabase/migrations/`: esquema, RLS y storage. `supabase/functions/extract-receipt/`: lectura con IA.

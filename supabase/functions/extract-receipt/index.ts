// Lee un ticket/factura del bucket "receipts" con Claude y devuelve los datos estructurados.
// Opcional: si no está desplegada, la app usa OCR en el dispositivo.
//
// Deploy:  npx supabase functions deploy extract-receipt --project-ref <ref>
// Secret:  npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref <ref>
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { betaJSONSchemaOutputFormat } from 'npm:@anthropic-ai/sdk@1.3.0/helpers/beta/json-schema';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-5-5';
// Modelos que aceptan `fallbacks: "default"` (si un filtro de seguridad rechaza el pedido, lo reintenta otro modelo).
const SERVER_FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

const text = (description: string) => ({ anyOf: [{ type: 'string', description }, { type: 'null' }] }) as const;

const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    merchant: text('Trade name of the business as printed (prefer it over the legal company name).'),
    date: text('Transaction date as YYYY-MM-DD.'),
    total: {
      anyOf: [
        {
          type: 'number',
          description:
            'Final amount charged, as a plain number (e.g. 68500.5). Includes tip if a total with tip is printed.',
        },
        { type: 'null' },
      ],
    },
    currency: text('ISO 4217 code of the total, e.g. ARS, USD, EUR, BRL.'),
    card_last4: text(
      'Last 4 digits of the payment card, exactly as printed after the masked part ("XXXX XXXX XXXX 1234", "****1234", "ending in 1234").',
    ),
    card_brand: text('Card brand or wallet, e.g. Visa, Mastercard, Amex, Apple Pay.'),
    payment_method: {
      anyOf: [{ type: 'string', enum: ['card', 'cash', 'transfer', 'other'] }, { type: 'null' }],
    },
    category: {
      anyOf: [
        {
          type: 'string',
          enum: [
            'Alojamiento',
            'Transporte',
            'Comida',
            'Supermercado',
            'Actividades',
            'Compras',
            'Combustible',
            'Salud',
            'Comisiones',
            'Otros',
          ],
        },
        { type: 'null' },
      ],
    },
    description: text(
      'What was bought, in Spanish, max 60 characters (e.g. "Cena para dos", "Nafta", "Entradas al museo").',
    ),
    notes: text(
      'Anything the user should double-check, in Spanish (illegible total, two cards, partial payment, amounts in two currencies). null if nothing.',
    ),
  },
  required: [
    'merchant',
    'date',
    'total',
    'currency',
    'card_last4',
    'card_brand',
    'payment_method',
    'category',
    'description',
    'notes',
  ],
  additionalProperties: false,
} as const;

const SYSTEM = `You extract data from photos and PDFs of receipts, card vouchers and invoices for two friends who split travel expenses.
Report only what is printed on the document; when a field is not visible or not legible, return null instead of guessing.
The card's last 4 digits decide who paid, so take them only from the masked card number (never the first digits/BIN, an authorization code or a terminal number).
For the total, use the amount actually charged: not the subtotal, not tax lines, not the cash handed over or the change.`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function mediaTypeOf(path: string, blobType: string): string {
  if (blobType && blobType !== 'application/octet-stream') return blobType;
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return `image/${ext}`;
}

interface RequestBody {
  path?: string;
  currencies?: string[];
  tripStart?: string | null;
  tripEnd?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  if (!Deno.env.get('ANTHROPIC_API_KEY')) {
    return json({ error: 'Falta el secret ANTHROPIC_API_KEY en Supabase' }, 503);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  if (!body.path) return json({ error: 'Falta "path"' }, 400);

  // Se descarga con el token de quien llama: las políticas de Storage deciden si puede leerlo.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: file, error: downloadError } = await supabase.storage.from('receipts').download(body.path);
  if (downloadError || !file) return json({ error: 'No se pudo leer el archivo (¿sin permiso o no existe?)' }, 403);

  const mediaType = mediaTypeOf(body.path, file.type);
  const data = encodeBase64(new Uint8Array(await file.arrayBuffer()));
  let document: Anthropic.Beta.BetaImageBlockParam | Anthropic.Beta.BetaRequestDocumentBlock;
  if (mediaType === 'application/pdf') {
    document = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  } else if ((IMAGE_TYPES as readonly string[]).includes(mediaType)) {
    document = { type: 'image', source: { type: 'base64', media_type: mediaType as ImageType, data } };
  } else {
    return json({ error: `Formato no soportado: ${mediaType}` }, 415);
  }

  const hints = [
    'Extract the data of this receipt.',
    body.currencies?.length
      ? `Currencies used on this trip: ${body.currencies.join(', ')}. If only "$" is printed, infer the currency from the country of the business (an Argentine CUIT means ARS).`
      : '',
    body.tripStart || body.tripEnd
      ? `The trip runs from ${body.tripStart ?? '?'} to ${body.tripEnd ?? '?'}: use it to tell day/month order apart.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const anthropic = new Anthropic();
  try {
    const message = await anthropic.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      ...(SERVER_FALLBACK_MODELS.has(MODEL)
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {}),
      output_config: { effort: 'low', format: betaJSONSchemaOutputFormat(RECEIPT_SCHEMA) },
      system: SYSTEM,
      messages: [{ role: 'user', content: [document, { type: 'text', text: hints }] }],
    });
    if (message.stop_reason === 'refusal') return json({ error: 'El modelo no procesó este archivo' }, 422);
    if (!message.parsed_output) return json({ error: 'La respuesta no trajo datos' }, 502);
    return json({ ...message.parsed_output, model: message.model });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return json({ error: 'La ANTHROPIC_API_KEY no es válida' }, 503);
    if (err instanceof Anthropic.RateLimitError)
      return json({ error: 'Límite de uso de la API: probá en un rato' }, 429);
    if (err instanceof Anthropic.BadRequestError) return json({ error: `Pedido rechazado: ${err.message}` }, 400);
    if (err instanceof Anthropic.APIError) return json({ error: `Error de la API de Anthropic (${err.status})` }, 502);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Lee un pase, ticket o reserva del bucket "receipts" con Claude y lo divide por viajero.
// Opcional: si no está desplegada, la app usa la lectura básica en el dispositivo.
//
// Deploy:  npx supabase functions deploy read-travel-doc --project-ref <ref>
// Secret:  npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref <ref>
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import { analyzeTravelFile, type DocumentFile, type TravelContext } from './analyze.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function mediaTypeOf(path: string, blobType: string): string {
  if (blobType && blobType !== 'application/octet-stream') return blobType;
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return `image/${ext}`;
}

type RequestBody = Partial<TravelContext> & { path?: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'Falta el secret ANTHROPIC_API_KEY en Supabase' }, 503);

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
  const { data: blob, error } = await supabase.storage.from('receipts').download(body.path);
  if (error || !blob) return json({ error: 'No se pudo leer el archivo (¿sin permiso o no existe?)' }, 403);

  const mediaType = mediaTypeOf(body.path, blob.type);
  if (mediaType !== 'application/pdf' && !IMAGE_TYPES.includes(mediaType)) {
    return json({ error: `Formato no soportado: ${mediaType}` }, 415);
  }
  const file = { mediaType, data: encodeBase64(new Uint8Array(await blob.arrayBuffer())) } as DocumentFile;
  const ctx: TravelContext = {
    fileName: body.fileName ?? body.path.split('/').pop() ?? 'documento',
    travelers: (body.travelers ?? []).slice(0, 2),
    tripStart: body.tripStart ?? null,
    tripEnd: body.tripEnd ?? null,
    codes: (body.codes ?? []).slice(0, 40),
  };

  try {
    const result = await analyzeTravelFile(new Anthropic(), file, ctx);
    if (result.refused) return json({ error: 'El modelo no procesó este archivo' }, 422);
    return json({ documents: result.documents, model: result.model });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return json({ error: 'La ANTHROPIC_API_KEY no es válida' }, 503);
    if (err instanceof Anthropic.RateLimitError) return json({ error: 'Límite de uso de la API: probá en un rato' }, 429);
    if (err instanceof Anthropic.BadRequestError) return json({ error: `Pedido rechazado: ${err.message}` }, 400);
    if (err instanceof Anthropic.APIError) return json({ error: `Error de la API de Anthropic (${err.status})` }, 502);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

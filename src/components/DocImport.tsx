import { useState } from 'react';
import { errorMessage } from '../lib/receipts';
import type { ProcessedFile } from '../lib/travelDocs';
import * as api from '../lib/api';
import { fieldsFromDraft, matchPerson, titleFor, withDocName, type DocDraft } from '../lib/travelParser';
import type { DocFields } from '../lib/types';
import { useTrip } from '../state';
import { Modal } from './ui';
import { DocFieldsForm, KIND_META } from './DocFields';

interface Item {
  key: number;
  fileIndex: number;
  draft: DocDraft;
  fields: Partial<DocFields>;
  include: boolean;
}

let nextKey = 0;

export function DocImport({ onClose }: { onClose: () => void }) {
  const { ctx, reload, notify } = useTrip();
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const busy = Boolean(status);

  async function add(list: FileList | null) {
    const chosen = Array.from(list ?? []);
    if (!chosen.length) return;
    const travel = await import('../lib/travelDocs');
    const travelCtx = { people: ctx.people, tripStart: ctx.trip.start_date, tripEnd: ctx.trip.end_date };
    const newFiles: ProcessedFile[] = [];
    const newItems: Item[] = [];
    for (const file of chosen) {
      try {
        setStatus(`${file.name}: preparando…`);
        const processed = await travel.processFile(file, (label) => setStatus(`${file.name}: ${label}`));
        const fileIndex = files.length + newFiles.length;
        newFiles.push(processed);
        for (const draft of travel.draftsFor(processed, travelCtx)) {
          newItems.push({ key: nextKey++, fileIndex, draft, fields: fieldsFromDraft(draft), include: true });
        }
      } catch (err) {
        setErrors((e) => [...e, `${file.name}: ${errorMessage(err)}`]);
      }
    }
    setFiles((f) => [...f, ...newFiles]);
    setItems((i) => [...i, ...newItems]);
    setStatus(null);
  }

  const update = (key: number, patch: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  /** Junta un documento con el anterior del mismo archivo (si el corte automático partió algo que va junto). */
  function mergeUp(key: number) {
    setItems((list) => {
      const at = list.findIndex((i) => i.key === key);
      const prev = list[at - 1];
      const cur = list[at];
      if (!prev || prev.fileIndex !== cur.fileIndex) return list;
      const pages = [...new Set([...prev.draft.pages, ...cur.draft.pages])].sort((a, b) => a - b);
      const merged: Item = { ...prev, draft: { ...prev.draft, pages, code: prev.draft.code ?? cur.draft.code } };
      return [...list.slice(0, at - 1), merged, ...list.slice(at + 1)];
    });
  }

  /** Separa un documento de varias páginas en uno por página. */
  function splitPages(key: number) {
    setItems((list) =>
      list.flatMap((i) =>
        i.key === key && i.draft.pages.length > 1
          ? i.draft.pages.map((page, n) => ({
              ...i,
              key: nextKey++,
              draft: { ...i.draft, pages: [page], code: n === 0 || i.draft.code?.page === page ? i.draft.code : null },
            }))
          : [i],
      ),
    );
  }

  async function saveAll() {
    const chosen = items.filter((i) => i.include);
    if (!chosen.length) return;
    setSaving(true);
    const travel = await import('../lib/travelDocs');
    const failed: Item[] = [];
    // El PDF completo se guarda una vez por archivo, solo si se dividió (si no, el documento ya es el original).
    const sources = new Map<number, Promise<string>>();
    const sourceFor = (item: Item) => {
      const file = files[item.fileIndex];
      if (file.type !== 'pdf' || item.draft.pages.length === file.pages.length) return Promise.resolve(null);
      if (!sources.has(item.fileIndex)) sources.set(item.fileIndex, travel.uploadSource(ctx.trip.id, file));
      return sources.get(item.fileIndex)!;
    };
    // Si se eligió a mano de quién es un pase, su nombre real queda aprendido para los próximos.
    const learned = new Map<string, string[]>();
    for (const [n, item] of chosen.entries()) {
      setStatus(`Guardando ${n + 1} de ${chosen.length}…`);
      try {
        const f = item.fields;
        const title =
          f.title?.trim() ||
          titleFor({
            kind: f.kind ?? 'other',
            number: f.number ?? null,
            origin: f.origin ?? null,
            destination: f.destination ?? null,
            provider: f.provider ?? null,
          });
        const personName = ctx.people.find((p) => p.id === f.person_id)?.name ?? null;
        const sourcePath = await sourceFor(item);
        const initial = fieldsFromDraft(item.draft);
        const edited = (Object.keys(f) as (keyof DocFields)[]).some(
          (k) => k !== 'details' && (f[k] ?? null) !== (initial[k] ?? null),
        );
        const details = { ...(f.details ?? {}), ...(edited ? { edited: '1' } : {}) };
        await travel.saveDraft(
          ctx.trip.id,
          files[item.fileIndex],
          item.draft,
          { ...f, title, details },
          personName,
          sourcePath,
        );
        // Solo si la persona la eligieron a mano (no lo que propuso la app).
        const passenger = item.draft.passenger;
        const personId = f.person_id;
        if (
          personId &&
          personId !== item.draft.personId &&
          passenger &&
          matchPerson(passenger, ctx.people)?.id !== personId
        ) {
          learned.set(personId, [...(learned.get(personId) ?? []), passenger]);
        }
      } catch (err) {
        failed.push(item);
        setErrors((e) => [...e, `${item.fields.title || 'Documento'}: ${errorMessage(err)}`]);
      }
    }
    for (const [personId, names] of learned) {
      const person = ctx.people.find((p) => p.id === personId);
      if (!person) continue;
      const docName = names.reduce<string | null>((acc, name) => withDocName(acc, name), person.doc_name ?? null);
      await api.updatePerson(personId, { doc_name: docName }).catch(() => undefined);
    }
    await reload();
    setStatus(null);
    setSaving(false);
    if (failed.length) {
      setItems(failed);
      notify(`Se guardaron ${chosen.length - failed.length}; ${failed.length} fallaron`, 'error');
    } else {
      notify(`${chosen.length} guardado${chosen.length === 1 ? '' : 's'} en la Wallet`);
      onClose();
    }
  }

  const included = items.filter((i) => i.include);
  const perPerson = ctx.people.map((p) => `${p.name} ${included.filter((i) => i.fields.person_id === p.id).length}`);
  const shared = included.filter((i) => !i.fields.person_id).length;

  return (
    <Modal title="Agregar pases y reservas" onClose={onClose} wide dismissable={false}>
      <div className="stack">
        <div className="dropzone">
          <label className={`btn primary${busy ? ' disabled' : ''}`}>
            Elegir PDFs o capturas
            <input
              className="visually-hidden"
              type="file"
              accept="application/pdf,image/*"
              multiple
              disabled={busy}
              onChange={(e) => {
                void add(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          <span className="hint">
            Tarjetas de embarque, reservas de hotel, tickets de tren o entradas. Se leen los códigos (QR, Aztec, PDF417)
            y el texto para saber de quién es cada uno.
          </span>
        </div>

        {status && <div className="notice">{status}</div>}
        {errors.map((e, i) => (
          <div key={i} className="notice critical">
            {e}
          </div>
        ))}

        {files.map((file, fileIndex) => {
          const fileItems = items.filter((i) => i.fileIndex === fileIndex);
          if (!fileItems.length) return null;
          return (
            <section key={fileIndex} className="stack-sm">
              <h3>
                {file.name}{' '}
                <span className="hint">
                  · {file.pages.length} pág. → {fileItems.length} documento{fileItems.length === 1 ? '' : 's'}
                </span>
              </h3>
              {fileItems.map((item, n) => {
                const pages = item.draft.pages.map((p) => file.pages.find((x) => x.index === p)).filter(Boolean);
                const code = item.draft.code
                  ? file.pages
                      .find((p) => p.index === item.draft.code!.page)
                      ?.codes.find((c) => c.text === item.draft.code!.text)
                  : null;
                return (
                  <div key={item.key} className={`review-card${item.include ? '' : ' excluded'}`}>
                    <div className="review-media">
                      {code ? (
                        <img className="review-code" src={code.image} alt={code.format} />
                      ) : (
                        pages[0] && <img className="review-thumb" src={pages[0].thumb} alt="" />
                      )}
                      <span className="hint">
                        {KIND_META[item.fields.kind ?? 'other'].icon} pág.{' '}
                        {item.draft.pages.map((p) => p + 1).join(', ')}
                        {code ? ` · ${code.format}` : ' · sin código'}
                      </span>
                    </div>
                    <div className="stack-sm">
                      {item.draft.warnings.map((w) => (
                        <span key={w} className="badge warning">
                          ⚠ {w}
                        </span>
                      ))}
                      <DocFieldsForm
                        compact
                        value={item.fields}
                        onChange={(patch) => update(item.key, { fields: { ...item.fields, ...patch } })}
                      />
                      <div className="row">
                        <label className="check hint">
                          <input
                            type="checkbox"
                            checked={item.include}
                            onChange={(e) => update(item.key, { include: e.target.checked })}
                          />
                          Guardar
                        </label>
                        {n > 0 && (
                          <button type="button" className="small" onClick={() => mergeUp(item.key)}>
                            Unir con el anterior
                          </button>
                        )}
                        {item.draft.pages.length > 1 && (
                          <button type="button" className="small" onClick={() => splitPages(item.key)}>
                            Separar páginas
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}

        {items.length > 0 && (
          <div className="actions">
            <button className="primary" onClick={saveAll} disabled={saving || busy || !included.length}>
              Guardar {included.length}
            </button>
            <span className="hint">
              {perPerson.join(' · ')}
              {shared ? ` · Ambos ${shared}` : ''}
            </span>
            <span className="right">
              <button onClick={onClose} disabled={saving}>
                Cancelar
              </button>
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}

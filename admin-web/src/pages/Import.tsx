import { useState } from 'react';
import readXlsxFile from 'read-excel-file';
import { api, errorText } from '../api';
import { Banner, PageHead } from '../ui';
import { useApi } from '../useApi';

type Kind = 'routes' | 'crew' | 'vehicles';

interface ImportResult {
  kind: Kind;
  total: number;
  ok: boolean;
  saved: boolean;
  summary: string;
  rows: { row: number; label: string; errors: string[] }[];
  created?: Record<string, string | number>[];
}

const STEPS: { kind: Kind; title: string; help: string }[] = [
  { kind: 'routes', title: '1. Routes and fares', help: 'One row per stop, in order along the route. App fare empty = the same as the cash fare.' },
  { kind: 'crew', title: '2. Drivers, conductors and stage marshals', help: 'Role: driver, conductor or marshal. Leave Password empty and one is made for each person; a password you type needs at least 8 characters, with a capital letter, a small letter and a number.' },
  { kind: 'vehicles', title: '3. Vehicles and owners', help: 'Route by its name; driver and conductor by their phone number. Paid by: M-Pesa or Bank (then bank name, paybill and account).' },
];

/** Reads a .csv or .xlsx file into rows keyed by the first row's headings. */
async function readRows(file: File): Promise<Record<string, string>[]> {
  let table: string[][];
  if (/\.xlsx$/i.test(file.name)) {
    table = (await readXlsxFile(file)).map((r) => r.map((c) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c))));
  } else if (/\.csv$/i.test(file.name)) {
    table = parseCsv(await file.text());
  } else {
    throw new Error('Choose an Excel file (.xlsx) or a CSV file (.csv).');
  }
  const [headings = [], ...body] = table.filter((r) => r.some((c) => c.trim() !== ''));
  return body.map((r) => Object.fromEntries(headings.map((h, i) => [h, r[i] ?? ''])));
}

/** A CSV file (Excel's "Save as CSV", commas or semicolons, quoted cells) as rows of cells. */
function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const sep = (clean.split('\n')[0].match(/;/g)?.length ?? 0) > (clean.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) rows.push([...row, cell]);
  return rows;
}

/** Saves text as a file the browser downloads. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
const csvLine = (cells: (string | number)[]) => cells.map((c) => (/[",;\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',');

/** Load many routes, crew or vehicles at once from a spreadsheet: checked row by row, saved only when all are right. */
export function Import() {
  const templates = useApi<Record<Kind, string[]>>('/admin/import/templates');
  return (
    <>
      <PageHead title="Import from Excel" subtitle="Add hundreds of routes, crew and vehicles at once. Do them in this order: vehicles need their routes and crew first." />
      {STEPS.map((s) => (
        <ImportStep key={s.kind} kind={s.kind} title={s.title} help={s.help} headings={templates.data?.[s.kind]} />
      ))}
    </>
  );
}

function ImportStep({ kind, title, help, headings }: { kind: Kind; title: string; help: string; headings?: string[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (theRows: Record<string, string>[], commit: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api<ImportResult>(`/admin/import/${kind}`, { method: 'POST', body: { rows: theRows, commit } }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const choose = async (f: File | null) => {
    setFile(f);
    setRows(null);
    setResult(null);
    setError(null);
    if (!f) return;
    try {
      const read = await readRows(f);
      setRows(read);
      await send(read, false); // check every row first
    } catch (err) {
      setError(errorText(err));
    }
  };

  const problems = result?.rows.filter((r) => r.errors.length) ?? [];
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <p className="muted">{help}</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="secondary" disabled={!headings} onClick={() => headings && download(`FarePay ${kind} template.csv`, `${csvLine(headings)}\n`)}>
          Download template
        </button>
        <input type="file" accept=".xlsx,.csv" aria-label={`${title}: choose file`} onChange={(e) => void choose(e.target.files?.[0] ?? null)} />
      </div>
      {error && <Banner tone="danger">{error}</Banner>}
      {busy && <p className="muted">Checking…</p>}

      {result && !result.saved && (
        <>
          {result.ok ? (
            <Banner tone="success">
              All {result.total} rows are right: {result.summary}. Nothing is saved until you press Import.
            </Banner>
          ) : (
            <Banner tone="danger">
              {problems.length} of {result.total} rows need fixing. Correct them in the file and choose it again; nothing has been saved.
            </Banner>
          )}
          {problems.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>What</th>
                    <th>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.slice(0, 200).map((r) => (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>{r.label}</td>
                      <td>{r.errors.join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.ok && rows && (
            <button style={{ marginTop: 12 }} disabled={busy} onClick={() => void send(rows, true)}>
              Import {result.summary}
            </button>
          )}
        </>
      )}

      {result?.saved && (
        <>
          <Banner tone="success">
            Imported {result.summary} from {file?.name}.
          </Banner>
          {kind === 'crew' && result.created && (
            <>
              <p className="muted">
                Give each person their password; they can change it after signing in. Download the list now: the passwords are not shown again.
              </p>
              <button
                className="secondary"
                onClick={() =>
                  download(
                    'FarePay crew passwords.csv',
                    [csvLine(['Name', 'Phone', 'Role', 'Password']), ...result.created!.map((p) => csvLine([p.name, p.phone, p.role, p.password]))].join('\n') + '\n',
                  )
                }
              >
                Download passwords
              </button>
            </>
          )}
          {kind === 'vehicles' && (
            <p className="muted">
              Each vehicle has its QR sticker: <a href="/office/vehicles/stickers">print all stickers</a>.
            </p>
          )}
        </>
      )}
    </div>
  );
}

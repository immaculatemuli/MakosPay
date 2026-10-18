import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from './api';
import { useApi } from './useApi';

export interface AttentionItem {
  key: string;
  severity: 'high' | 'medium' | 'low';
  count: number;
  title: string;
  detail: string;
  link: string | null;
}

/** Where an attention item or search result opens on the dashboard (the server's short link → a page here). */
export function officePath(link: string | null): string | null {
  if (!link) return null;
  const at = link.indexOf(':');
  const kind = at === -1 ? link : link.slice(0, at);
  const value = at === -1 ? '' : link.slice(at + 1);
  const pages: Record<string, string> = {
    'money-check': '/money-check',
    payouts: '/payouts',
    withdrawals: '/withdrawals',
    reports: '/reports',
    queues: '/trips',
    parcels: '/parcels',
    staff: '/staff',
  };
  if (pages[kind]) return pages[kind];
  if (kind === 'parcel') return `/parcels/${value}`;
  if (kind === 'vehicles') return value ? `/vehicles?filter=${encodeURIComponent(value)}` : '/vehicles';
  if (kind === 'vehicle') return `/vehicles/${value}`;
  if (kind === 'owner') return `/owners/${value}`;
  if (kind === 'passenger') return `/passengers?q=${encodeURIComponent(value)}`;
  if (kind === 'crew') return `/crew?role=${encodeURIComponent(value)}`;
  if (kind === 'payments') return `/payments?date=${encodeURIComponent(value)}`;
  return null;
}

/** The office's to-do list, most urgent first; empty = nothing to do. */
export function NeedsAttention() {
  const { data, error, reload } = useApi<{ items: AttentionItem[] }>('/admin/attention');
  if (error) {
    return (
      <div className="banner danger">
        Could not load what needs attention. <button className="link" onClick={() => void reload()}>Try again</button>
      </div>
    );
  }
  if (!data) return null;
  if (data.items.length === 0) return <div className="banner success">Nothing needs attention right now.</div>;
  return (
    <div className="attention">
      <h2>Needs attention ({data.items.length})</h2>
      {data.items.map((i) => {
        const to = officePath(i.link);
        const body = (
          <>
            <strong>{i.title}{i.count > 1 && !/^\d/.test(i.title) ? ` (${i.count})` : ''}</strong>
            {i.detail && <span>{i.detail}</span>}
          </>
        );
        return to ? (
          <Link key={i.key} to={to} className={`attention-item ${i.severity}`}>
            {body}
          </Link>
        ) : (
          <div key={i.key} className={`attention-item ${i.severity}`}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

interface SearchResult {
  kind: string;
  id: number;
  title: string;
  subtitle: string;
  link: string | null;
}

/** One search box for everything, in the sidebar: results drop down as you type. */
export function OfficeSearch() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) return setResults([]);
    let gone = false;
    const t = setTimeout(() => {
      api<SearchResult[]>(`/admin/search?q=${encodeURIComponent(q)}`)
        .then((r) => !gone && setResults(r))
        .catch(() => !gone && setResults([]));
    }, 300);
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [text]);

  const open = (r: SearchResult) => {
    const to = officePath(r.link);
    if (!to) return;
    setText('');
    setResults([]);
    navigate(to);
  };

  return (
    <div className="office-search">
      <input
        type="search"
        placeholder="Search plate, name, phone, ticket…"
        aria-label="Search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && results[0] && open(results[0])}
      />
      {text.trim().length >= 2 && (
        <div className="office-search-results" role="listbox">
          {results.length === 0 ? (
            <div className="muted">Nothing found.</div>
          ) : (
            results.map((r) => (
              <button key={`${r.kind}-${r.id}`} type="button" role="option" aria-selected="false" onClick={() => open(r)}>
                <strong>{r.title}</strong>
                <span>{r.subtitle}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

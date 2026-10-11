import { Button, Empty, ErrorBox, List, ListRow, Loading, Muted, Screen } from '@/components/ui';
import { auditLabel } from '@/lib/auditText';
import { dateTime } from '@/lib/format';
import { ROLE_LABEL, type AuditEntry, type Role } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';

/** A short, readable summary of what was sent (amounts, reasons, names), without ids already shown. */
function summarise(details: AuditEntry['details']) {
  if (!details) return '';
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
    .slice(0, 4)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`)
    .join(' · ');
}

/** Everything office, platform and crew accounts changed, and what the system did. Cannot be edited. */
export default function AuditLog() {
  const log = usePaged<AuditEntry>('/admin/audit', 50);
  if (log.loading) return <Loading />;

  return (
    <Screen refreshing={log.refreshing} onRefresh={log.refresh}>
      <Muted>Every change made by office, platform and crew accounts is recorded here. Entries can never be edited or deleted.</Muted>
      {log.error && <ErrorBox message={log.error} onRetry={log.reload} />}
      {log.items.length === 0 && !log.error && <Empty text="Nothing recorded yet." />}
      {log.items.length > 0 && (
        <List>
          {log.items.map((e) => {
            const who = e.actor_name ? `${e.actor_name} (${ROLE_LABEL[e.actor_role as Role] ?? e.actor_role})` : 'System';
            const extra = summarise(e.details);
            return (
              <ListRow
                key={e.id}
                icon={e.actor_name ? 'person-circle-outline' : 'cog-outline'}
                title={`${auditLabel(e.action)}${e.entity_id ? ` #${e.entity_id}` : ''}`}
                subtitle={`${who} · ${dateTime(e.created_at)}${extra ? `\n${extra}` : ''}`}
              />
            );
          })}
        </List>
      )}
      {log.hasMore && <Button title="Load more" variant="secondary" onPress={log.loadMore} loading={log.loadingMore} />}
    </Screen>
  );
}

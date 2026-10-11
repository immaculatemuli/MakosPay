import type { Payout } from '@/lib/types';
import { Badge } from './ui';

const LOOK: Record<Payout['status'], { text: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  processing: { text: 'Sending', tone: 'warning' },
  manual: { text: 'Send manually', tone: 'warning' },
  completed: { text: 'Paid', tone: 'success' },
  failed: { text: 'Failed', tone: 'danger' },
};

export function PayoutBadge({ status }: { status: Payout['status'] }) {
  return <Badge text={LOOK[status].text} tone={LOOK[status].tone} />;
}

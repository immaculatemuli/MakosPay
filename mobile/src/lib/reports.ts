import type { ProblemReport } from './types';

/** How each report status is shown. */
export const REPORT_STATUS_BADGE: Record<ProblemReport['status'], { text: string; tone: 'warning' | 'success' }> = {
  open: { text: 'Sent', tone: 'warning' },
  in_progress: { text: 'Being looked at', tone: 'warning' },
  resolved: { text: 'Resolved', tone: 'success' },
};

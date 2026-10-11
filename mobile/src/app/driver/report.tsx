import { ReportForm } from '@/components/reports/ReportForm';

export default function Report() {
  return <ReportForm endpoint="/crew/reports" listHref="/driver/reports" />;
}

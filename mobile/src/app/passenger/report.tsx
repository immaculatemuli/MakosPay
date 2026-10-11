import { ReportForm } from '@/components/reports/ReportForm';

export default function Report() {
  return <ReportForm endpoint="/passenger/reports" listHref="/passenger/reports" />;
}

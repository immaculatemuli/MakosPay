import { ReportList } from '@/components/reports/ReportList';

export default function Reports() {
  return <ReportList endpoint="/crew/reports" newHref="/conductor/report" />;
}

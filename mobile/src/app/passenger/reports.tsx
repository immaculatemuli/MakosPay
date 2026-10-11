import { ReportList } from '@/components/reports/ReportList';

export default function Reports() {
  return <ReportList endpoint="/passenger/reports" newHref="/passenger/report" />;
}

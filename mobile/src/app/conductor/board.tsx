import { BoardScanner } from '@/components/BoardScanner';

/** Boarding: scan each booked passenger's QR (only passengers put on this car). */
export default function CrewBoard() {
  return <BoardScanner endpoint="/crew/seats/board-code" />;
}

import { BoardScanner } from '@/components/BoardScanner';

/** Boarding at the stage: scan each passenger's booking QR (any car on the marshal's routes). */
export default function MarshalBoard() {
  return <BoardScanner endpoint="/marshal/seats/board-code" />;
}

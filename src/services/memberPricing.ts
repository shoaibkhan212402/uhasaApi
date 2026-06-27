export const MEMBER_FREE_SEAT_INTERVAL = 4;

export function qualifiesForMemberFreeSeats(role: string): boolean {
  return role === 'corporate' || role === 'bank';
}

/** 1-based enrollment position within a member's workshop roster. */
export function isMemberFreeSeatPosition(position: number): boolean {
  return position > 0 && position % MEMBER_FREE_SEAT_INTERVAL === 0;
}

export function participantPriceAtPosition(
  unitPrice: number,
  position: number,
  role: string
): number {
  if (role === 'cto' || role === 'cma') return 0;
  if (qualifiesForMemberFreeSeats(role) && isMemberFreeSeatPosition(position)) return 0;
  return unitPrice;
}

export function calculateEnrollmentSubtotal(
  unitPrice: number,
  existingCount: number,
  newCount: number,
  role: string
): number {
  if (role === 'cto' || role === 'cma' || newCount <= 0) return 0;

  let subtotal = 0;
  for (let i = 1; i <= newCount; i++) {
    subtotal += participantPriceAtPosition(unitPrice, existingCount + i, role);
  }
  return subtotal;
}

export function countComplimentarySeats(totalCount: number, role: string): number {
  if (!qualifiesForMemberFreeSeats(role) || totalCount <= 0) return 0;
  return Math.floor(totalCount / MEMBER_FREE_SEAT_INTERVAL);
}

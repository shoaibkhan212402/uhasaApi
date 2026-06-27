export type CoursePricingInput = {
  price: number | string | null | undefined;
  enrollment_type?: string | null;
};

/** Detect UASA member from email domain or explicit flag. */
export function resolveUasaMember(email: string, explicit?: boolean): boolean {
  if (explicit === true) return true;
  if (explicit === false) return false;
  const domain = email.split('@')[1]?.toLowerCase().trim();
  return domain === 'uasa.ae';
}

export async function getUserUasaMember(
  queryOne: <T>(sql: string, params: unknown[]) => Promise<T | null>,
  userId: number
): Promise<boolean> {
  const row = await queryOne<{ is_uasa_member: number }>(
    `SELECT is_uasa_member FROM users WHERE id = ?`,
    [userId]
  );
  return row?.is_uasa_member === 1;
}

export function getListPrice(course: CoursePricingInput): number {
  return Math.max(0, Number(course.price) || 0);
}

export function getEffectivePrice(course: CoursePricingInput, isUasaMember: boolean): number {
  if (isUasaMember) return 0;
  return getListPrice(course);
}

export function courseRequiresPayment(course: CoursePricingInput, isUasaMember: boolean): boolean {
  if (isUasaMember) return false;
  const price = getListPrice(course);
  if (price <= 0) return false;
  const type = course.enrollment_type || 'open';
  if (type === 'open') return false;
  return type === 'paid' || type === 'both';
}

export function withCoursePricing<T extends CoursePricingInput>(
  course: T,
  isUasaMember: boolean
): T & { list_price: number; effective_price: number; requires_payment: boolean; free_for_uasa_members: boolean } {
  const listPrice = getListPrice(course);
  return {
    ...course,
    list_price: listPrice,
    effective_price: getEffectivePrice(course, isUasaMember),
    requires_payment: courseRequiresPayment(course, isUasaMember),
    free_for_uasa_members: listPrice > 0,
  };
}

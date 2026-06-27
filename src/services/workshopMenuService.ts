import { pool, queryOne } from '../db/pool.js';

const YEARS_KEY = 'workshop_menu_years';
const MONTHS_KEY = 'workshop_menu_months';

export type WorkshopMenuData = {
  years: number[];
  months: Record<string, string[]>;
};

async function getSetting(key: string): Promise<string | null> {
  const row = await queryOne<{ setting_value: string }>(
    `SELECT setting_value FROM site_settings WHERE setting_key = ?`,
    [key]
  );
  return row?.setting_value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await pool.execute(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, value]
  );
}

function parseYears(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((year) => parseInt(String(year), 10))
      .filter((year) => !Number.isNaN(year));
  } catch {
    return [];
  }
}

function parseMonths(raw: string | null): Record<string, string[]> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, string[]> = {};
    for (const [year, months] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(months)) continue;
      result[year] = months.map((month) => String(month)).filter(Boolean);
    }
    return result;
  } catch {
    return {};
  }
}

export async function getWorkshopMenu(): Promise<WorkshopMenuData> {
  const [yearsRaw, monthsRaw] = await Promise.all([
    getSetting(YEARS_KEY),
    getSetting(MONTHS_KEY),
  ]);
  return {
    years: parseYears(yearsRaw),
    months: parseMonths(monthsRaw),
  };
}

export async function addWorkshopMenuYear(year: number): Promise<WorkshopMenuData> {
  const menu = await getWorkshopMenu();
  const years = new Set(menu.years);
  years.add(year);
  const nextYears = Array.from(years).sort((a, b) => a - b);
  await setSetting(YEARS_KEY, JSON.stringify(nextYears));
  return { years: nextYears, months: menu.months };
}

export async function addWorkshopMenuMonth(year: number, month: string): Promise<WorkshopMenuData> {
  const menu = await getWorkshopMenu();
  const yearKey = String(year);
  const monthsForYear = new Set(menu.months[yearKey] || []);
  monthsForYear.add(month);
  const nextMonths = {
    ...menu.months,
    [yearKey]: Array.from(monthsForYear).sort((a, b) => {
      const dateA = new Date(`1 ${a}`);
      const dateB = new Date(`1 ${b}`);
      if (Number.isNaN(dateA.getTime()) || Number.isNaN(dateB.getTime())) return a.localeCompare(b);
      return dateA.getTime() - dateB.getTime();
    }),
  };

  const years = new Set(menu.years);
  years.add(year);
  const nextYears = Array.from(years).sort((a, b) => a - b);

  await Promise.all([
    setSetting(YEARS_KEY, JSON.stringify(nextYears)),
    setSetting(MONTHS_KEY, JSON.stringify(nextMonths)),
  ]);

  return { years: nextYears, months: nextMonths };
}

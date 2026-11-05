/*
 * Money helpers. All amounts are whole cents (integers), so sums never pick
 * up rounding errors like 0.1 + 0.2 = 0.30000000000000004. Dollars appear
 * only when reading from the note or showing on screen.
 *
 * No Obsidian imports here, so the automated tests can run this file directly.
 */

/** Largest amount accepted: $1,000,000,000.00. */
export const MAX_CENTS = 100_000_000_000;

/** Optional whole dollars (commas allowed in groups of three), then up to 2 decimals. */
const MONEY_TEXT = /^(\d{1,3}(?:,\d{3})+|\d+)?(\.\d{0,2})?$/;

/**
 * Reads an amount of dollars and returns whole cents, or null if it isn't a
 * valid amount. Accepts numbers (512.5) and text ("$1,234.56", "512.50", ".5").
 * Rejects negative amounts, more than 2 decimals, and amounts over MAX_CENTS.
 */
export function parseMoney(input: unknown): number | null {
	let text: string;
	if (typeof input === 'number') {
		if (!Number.isFinite(input) || input < 0) {
			return null;
		}
		// String() gives the shortest exact form, e.g. 512.5 -> "512.5", 0.29 -> "0.29".
		text = String(input);
	} else if (typeof input === 'string') {
		text = input.trim().replace(/^\$\s*/, '');
	} else {
		return null;
	}
	if (text === '' || text === '.') {
		return null;
	}
	const match = MONEY_TEXT.exec(text);
	if (!match) {
		return null;
	}
	const dollars = (match[1] ?? '').replace(/,/g, '');
	const fraction = (match[2] ?? '').slice(1).padEnd(2, '0');
	const cents = Number(dollars || '0') * 100 + Number(fraction);
	if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) {
		return null;
	}
	return cents;
}

function splitCents(cents: number): { sign: string; dollars: string; rest: string } {
	const abs = Math.abs(cents);
	return {
		sign: cents < 0 ? '-' : '',
		dollars: String(Math.floor(abs / 100)),
		rest: String(abs % 100).padStart(2, '0'),
	};
}

/** For the screen: 123456 -> "$1,234.56", -500 -> "-$5.00". */
export function formatMoney(cents: number): string {
	const { sign, dollars, rest } = splitCents(cents);
	const withCommas = dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return `${sign}$${withCommas}.${rest}`;
}

/** For the note and the number box: 123456 -> "1234.56" (always 2 decimals, no commas). */
export function centsToPlain(cents: number): string {
	const { sign, dollars, rest } = splitCents(cents);
	return `${sign}${dollars}.${rest}`;
}

/** Share of a total, for display only: (145000, 400000) -> "36.3%". Total 0 -> "–". */
export function percentText(partCents: number, totalCents: number): string {
	if (totalCents <= 0) {
		return '–';
	}
	const tenths = Math.round((partCents * 1000) / totalCents);
	return `${(tenths / 10).toFixed(1)}%`;
}

/** The "Left to allocate" text: positive -> "$1,587.50", negative -> "Over by $100.00". */
export function leftText(leftCents: number): string {
	return leftCents < 0 ? `Over by ${formatMoney(-leftCents)}` : formatMoney(leftCents);
}

/*
 * Starting points for a new budget note.
 *
 * No Obsidian imports here, so the automated tests can run this file directly.
 */

import { BLOCK_LANGUAGE } from './blocks';
import { type Budget, type Category, type Group, GROUPS, GUIDELINE_PERCENT, serializeBudget } from './budget';

export type PresetId = 'starter' | 'blank';

export const PRESETS: { id: PresetId; label: string }[] = [
	{ id: 'starter', label: '50/30/20 starter' },
	{ id: 'blank', label: 'Blank' },
];

/** Default categories for the 50/30/20 starter (from the project spec). */
export const STARTER_CATEGORIES: Record<Group, string[]> = {
	needs: [
		'Rent or mortgage',
		'Utilities',
		'Groceries',
		'Gas',
		'Car insurance and maintenance',
		'Phone and internet',
		'Health insurance and medical',
		'Minimum debt payments',
	],
	wants: [
		'Dining out',
		'Outings and entertainment',
		'Subscriptions',
		'Shopping and clothing',
		'Hobbies',
		'Personal care',
		'Gifts',
	],
	savings: ['Emergency fund', 'Retirement', 'Sinking funds'],
};

/**
 * Splits an amount over `count` categories so the parts add up exactly.
 * Whole dollars where possible (first ones get the extra dollars),
 * leftover cents go to the first category.
 */
export function splitEvenly(cents: number, count: number): number[] {
	if (count <= 0) {
		return [];
	}
	const dollars = Math.floor(cents / 100);
	const base = Math.floor(dollars / count);
	const extra = dollars % count;
	const parts = Array.from({ length: count }, (_, i) => (base + (i < extra ? 1 : 0)) * 100);
	parts[0] = (parts[0] ?? 0) + (cents % 100);
	return parts;
}

/** Splits the total 50/30/20 over the groups; the three parts add up exactly. */
export function splitByGuideline(totalCents: number): Record<Group, number> {
	const needs = Math.round((totalCents * GUIDELINE_PERCENT.needs) / 100);
	const wants = Math.round((totalCents * GUIDELINE_PERCENT.wants) / 100);
	return { needs, wants, savings: totalCents - needs - wants };
}

/** Builds the starting budget for a preset. */
export function makeBudget(preset: PresetId, name: string, month: string, totalCents: number): Budget {
	const categories: Category[] = [];
	if (preset === 'starter') {
		const groupCents = splitByGuideline(totalCents);
		for (const group of GROUPS) {
			const names = STARTER_CATEGORIES[group];
			const amounts = splitEvenly(groupCents[group], names.length);
			names.forEach((categoryName, i) => {
				categories.push({ name: categoryName, group, amountCents: amounts[i] ?? 0, locked: false });
			});
		}
	}
	return { name, month, totalCents, currency: 'USD', categories };
}

/** The text of a new budget note: just the budget block. */
export function budgetNoteText(budget: Budget): string {
	return `\`\`\`${BLOCK_LANGUAGE}\n${serializeBudget(budget)}\n\`\`\`\n`;
}

/** The current month as "YYYY-MM" (local time). */
export function currentMonth(now: Date): string {
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Characters that can't be used in a note name (file system or Obsidian links). */
const BAD_NAME_CHARS = /[\\/:*?"<>|#^[\]]/;

/** Checks a budget name (also used as the note name). Undefined = fine. */
export function budgetNameProblem(name: string): string | undefined {
	const trimmed = name.trim();
	if (trimmed === '') {
		return 'Enter a name, for example "Household 2026-11".';
	}
	if (BAD_NAME_CHARS.test(trimmed)) {
		return 'The name can\'t contain any of these: \\ / : * ? " < > | # ^ [ ]';
	}
	if (trimmed.startsWith('.')) {
		return 'The name can\'t start with a dot.';
	}
	if (trimmed.length > 100) {
		return 'The name is too long (100 characters at most).';
	}
	return undefined;
}

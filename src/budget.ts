/*
 * The budget data: checking what was read from a ```budget-notes block, and
 * writing it back as YAML with the keys always in the same order.
 *
 * No Obsidian imports here, so the automated tests can run this file directly.
 * The YAML reader is passed in (Obsidian's parseYaml in the plugin).
 */

import { centsToPlain, parseMoney } from './money';

export const GROUPS = ['needs', 'wants', 'savings'] as const;
export type Group = (typeof GROUPS)[number];

export const GROUP_LABELS: Record<Group, string> = {
	needs: 'Needs',
	wants: 'Wants',
	savings: 'Savings',
};

/** The 50/30/20 guideline, in percent of the total. */
export const GUIDELINE_PERCENT: Record<Group, number> = {
	needs: 50,
	wants: 30,
	savings: 20,
};

export interface Category {
	name: string;
	group: Group;
	amountCents: number;
	locked: boolean;
}

export interface Budget {
	/** Empty string = not set (the line is left out when saving). */
	name: string;
	/** "YYYY-MM", or empty string = not set. */
	month: string;
	totalCents: number;
	currency: 'USD';
	categories: Category[];
}

/** Keys in the order they are always written. */
const BUDGET_KEYS = ['name', 'month', 'total', 'currency', 'categories'];
const CATEGORY_KEYS = ['name', 'group', 'amount', 'locked'];

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** True for a "YYYY-MM" month like 2026-11. */
export function isValidMonth(text: string): boolean {
	return MONTH.test(text);
}

export type ReadResult =
	| {
			ok: true;
			budget: Budget;
			/** Reasons editing must stay off (saving would lose something). Empty = editable. */
			readOnlyReasons: string[];
	  }
	| { ok: false; problems: string[] };

/** Reads a budget block's text. Never throws: problems come back as messages. */
export function readBudget(source: string, parseYaml: (text: string) => unknown): ReadResult {
	if (source.trim() === '') {
		return {
			ok: false,
			problems: ['The budget block is empty. It needs at least a "total:" line, for example "total: 4000".'],
		};
	}
	let data: unknown;
	try {
		data = parseYaml(source);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			problems: [`This budget block can't be read because its YAML is broken: ${detail}`],
		};
	}
	const result = checkBudget(data);
	if (result.ok) {
		const commentLines = findCommentLines(source);
		if (commentLines.length > 0) {
			result.readOnlyReasons.push(
				`Line ${commentLines.join(', ')} of the budget block has a comment (#). Saving would remove it, so editing is off. Move the comment outside the block.`,
			);
		}
	}
	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function unknownKeysMessage(where: string, keys: string[]): string {
	const list = keys.map((key) => `"${key}"`).join(', ');
	return `${where} has ${keys.length === 1 ? 'an unknown setting' : 'unknown settings'}: ${list}. Saving would remove ${keys.length === 1 ? 'it' : 'them'}, so editing is off. Fix the spelling or remove ${keys.length === 1 ? 'it' : 'them'}.`;
}

const AMOUNT_HELP = 'an amount like 512.50 (no minus sign, at most 2 decimals)';

/** Checks data that came out of the YAML reader and turns it into a Budget. */
export function checkBudget(data: unknown): ReadResult {
	if (!isRecord(data)) {
		return {
			ok: false,
			problems: ['The budget block should be "key: value" lines, for example "total: 4000" and "categories:".'],
		};
	}
	const problems: string[] = [];
	const readOnlyReasons: string[] = [];

	const unknownKeys = Object.keys(data).filter((key) => !BUDGET_KEYS.includes(key));
	if (unknownKeys.length > 0) {
		readOnlyReasons.push(unknownKeysMessage('The budget', unknownKeys));
	}

	let name = '';
	if (data.name !== undefined && data.name !== null) {
		if (typeof data.name === 'string' || typeof data.name === 'number') {
			name = String(data.name).trim();
		} else {
			problems.push('"name" should be text, for example "name: Household".');
		}
	}

	let month = '';
	if (data.month !== undefined && data.month !== null) {
		if (typeof data.month === 'string' && MONTH.test(data.month.trim())) {
			month = data.month.trim();
		} else {
			problems.push('"month" should be a year and month, for example "month: 2026-11".');
		}
	}

	if (data.currency !== undefined && data.currency !== null) {
		if (typeof data.currency !== 'string' || data.currency.trim().toUpperCase() !== 'USD') {
			problems.push('"currency" can only be USD in this version.');
		}
	}

	let totalCents = 0;
	if (data.total === undefined || data.total === null) {
		problems.push('"total" is missing. Add a line like "total: 4000".');
	} else {
		const cents = parseMoney(data.total);
		if (cents === null) {
			problems.push(`"total" should be ${AMOUNT_HELP}.`);
		} else {
			totalCents = cents;
		}
	}

	const categories: Category[] = [];
	const rawCategories = data.categories ?? [];
	if (!Array.isArray(rawCategories)) {
		problems.push('"categories" should be a list, with each category starting with "- name:".');
	} else {
		rawCategories.forEach((raw: unknown, index) => {
			const category = checkCategory(raw, index + 1, problems, readOnlyReasons);
			if (category) {
				categories.push(category);
			}
		});
	}

	if (problems.length > 0) {
		return { ok: false, problems };
	}
	return {
		ok: true,
		budget: { name, month, totalCents, currency: 'USD', categories },
		readOnlyReasons,
	};
}

function checkCategory(
	raw: unknown,
	position: number,
	problems: string[],
	readOnlyReasons: string[],
): Category | null {
	if (!isRecord(raw)) {
		problems.push(`Category ${position} should have "name:", "group:" and "amount:" lines.`);
		return null;
	}
	const rawName = raw.name;
	const name = typeof rawName === 'string' || typeof rawName === 'number' ? String(rawName).trim() : '';
	const label = name === '' ? `Category ${position}` : `Category ${position} ("${name}")`;
	const before = problems.length;

	if (name === '') {
		problems.push(`${label} needs a name, for example "- name: Groceries".`);
	}

	const unknownKeys = Object.keys(raw).filter((key) => !CATEGORY_KEYS.includes(key));
	if (unknownKeys.length > 0) {
		readOnlyReasons.push(unknownKeysMessage(label, unknownKeys));
	}

	const rawGroup = typeof raw.group === 'string' ? raw.group.trim().toLowerCase() : '';
	const group = GROUPS.find((g) => g === rawGroup);
	if (!group) {
		problems.push(`${label}: "group" should be needs, wants or savings.`);
	}

	let amountCents = 0;
	if (raw.amount !== undefined && raw.amount !== null) {
		const cents = parseMoney(raw.amount);
		if (cents === null) {
			problems.push(`${label}: "amount" should be ${AMOUNT_HELP}.`);
		} else {
			amountCents = cents;
		}
	}

	let locked = false;
	if (raw.locked !== undefined && raw.locked !== null) {
		if (typeof raw.locked === 'boolean') {
			locked = raw.locked;
		} else {
			problems.push(`${label}: "locked" should be true or false.`);
		}
	}

	if (problems.length > before || !group) {
		return null;
	}
	return { name, group, amountCents, locked };
}

/** Text that is safe to write without quotes; anything else gets double quotes. */
const PLAIN_SAFE = /^[A-Za-z][A-Za-z0-9 ,.&()'/+-]*$/;
const YAML_WORDS = /^(true|false|yes|no|on|off|null|y|n)$/i;

/** Writes a text value for YAML, adding quotes only when needed. */
export function yamlText(text: string): string {
	if (PLAIN_SAFE.test(text) && !text.endsWith(' ') && !YAML_WORDS.test(text)) {
		return text;
	}
	return JSON.stringify(text);
}

/** Writes a budget as YAML. Keys always in the same order; amounts with 2 decimals. */
export function serializeBudget(budget: Budget): string {
	const lines: string[] = [];
	if (budget.name !== '') {
		lines.push(`name: ${yamlText(budget.name)}`);
	}
	if (budget.month !== '') {
		lines.push(`month: ${budget.month}`);
	}
	lines.push(`total: ${centsToPlain(budget.totalCents)}`);
	lines.push(`currency: ${budget.currency}`);
	if (budget.categories.length === 0) {
		lines.push('categories: []');
	} else {
		lines.push('categories:');
		for (const category of budget.categories) {
			lines.push(
				`  - name: ${yamlText(category.name)}`,
				`    group: ${category.group}`,
				`    amount: ${centsToPlain(category.amountCents)}`,
				`    locked: ${category.locked ? 'true' : 'false'}`,
			);
		}
	}
	return lines.join('\n');
}

/**
 * Finds lines with a YAML comment (# after a space, or at the start).
 * Text inside quotes is skipped. Errs on the side of reporting a comment.
 */
export function findCommentLines(source: string): number[] {
	const found: number[] = [];
	source.split('\n').forEach((line, index) => {
		const outsideQuotes = line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'/g, '""');
		if (/(^|\s)#/.test(outsideQuotes)) {
			found.push(index + 1);
		}
	});
	return found;
}

/**
 * The next category in the same group, going up (step -1) or down (step 1).
 * Categories of different groups can be mixed in the list. Returns -1 if none.
 */
export function neighbourIndex(categories: Category[], index: number, step: -1 | 1): number {
	const group = categories[index]?.group;
	for (let i = index + step; i >= 0 && i < categories.length; i += step) {
		if (categories[i]?.group === group) {
			return i;
		}
	}
	return -1;
}

/** Moves a category up or down within its group. Returns false if it can't move. */
export function moveCategory(categories: Category[], index: number, step: -1 | 1): boolean {
	const other = neighbourIndex(categories, index, step);
	const a = categories[index];
	const b = categories[other];
	if (other < 0 || !a || !b) {
		return false;
	}
	categories[index] = b;
	categories[other] = a;
	return true;
}

/** Adds a $0.00 category at the end of its group. Returns its position in the list. */
export function addCategory(categories: Category[], group: Group, name: string): number {
	let at = categories.length;
	for (let i = categories.length - 1; i >= 0; i--) {
		if (categories[i]?.group === group) {
			at = i + 1;
			break;
		}
	}
	categories.splice(at, 0, { name, group, amountCents: 0, locked: false });
	return at;
}

/** "New category", or "New category 2", 3 … if that name is taken. */
export function uniqueCategoryName(categories: Category[], base = 'New category'): string {
	const taken = new Set(categories.map((category) => category.name.toLowerCase()));
	if (!taken.has(base.toLowerCase())) {
		return base;
	}
	let n = 2;
	while (taken.has(`${base} ${n}`.toLowerCase())) {
		n++;
	}
	return `${base} ${n}`;
}

const MONTH_NAMES = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-11" -> "November 2026". Anything else is returned unchanged. */
export function monthLabel(month: string): string {
	const match = MONTH.exec(month);
	const name = match ? MONTH_NAMES[Number(month.slice(5, 7)) - 1] : undefined;
	return name ? `${name} ${month.slice(0, 4)}` : month;
}

export interface Summary {
	allocatedCents: number;
	/** Total minus all categories. Negative = over budget. */
	leftCents: number;
	groupCents: Record<Group, number>;
}

/** Adds up the categories (in cents). */
export function summarize(budget: Budget): Summary {
	const groupCents: Record<Group, number> = { needs: 0, wants: 0, savings: 0 };
	let allocatedCents = 0;
	for (const category of budget.categories) {
		allocatedCents += category.amountCents;
		groupCents[category.group] += category.amountCents;
	}
	return { allocatedCents, leftCents: budget.totalCents - allocatedCents, groupCents };
}

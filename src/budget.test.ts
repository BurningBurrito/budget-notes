// Automated tests for src/budget.ts. Run with: npm test
// Fake numbers only (the example from the spec).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import {
	type Budget,
	type Category,
	addCategory,
	checkBudget,
	monthLabel,
	moveCategory,
	neighbourIndex,
	readBudget,
	serializeBudget,
	summarize,
	uniqueCategoryName,
	yamlText,
} from './budget';
import { formatMoney, leftText, percentText } from './money';

const parseYaml = (text: string): unknown => parse(text);

const EXAMPLE = `name: Household
month: 2026-11
total: 4000
currency: USD
categories:
  - name: Rent
    group: needs
    amount: 1450
    locked: true
  - name: Groceries
    group: needs
    amount: 512.50
    locked: false
  - name: Dining out
    group: wants
    amount: 150
    locked: false
  - name: Emergency fund
    group: savings
    amount: 300
    locked: false`;

const EXAMPLE_BUDGET: Budget = {
	name: 'Household',
	month: '2026-11',
	totalCents: 400000,
	currency: 'USD',
	categories: [
		{ name: 'Rent', group: 'needs', amountCents: 145000, locked: true },
		{ name: 'Groceries', group: 'needs', amountCents: 51250, locked: false },
		{ name: 'Dining out', group: 'wants', amountCents: 15000, locked: false },
		{ name: 'Emergency fund', group: 'savings', amountCents: 30000, locked: false },
	],
};

/** Reads YAML and fails the test unless it worked; returns the result. */
function readOk(source: string) {
	const result = readBudget(source, parseYaml);
	if (!result.ok) {
		assert.fail(`expected ok, got problems: ${result.problems.join(' | ')}`);
	}
	return result;
}

/** Reads YAML and fails the test unless it was rejected; returns the problems. */
function readProblems(source: string): string[] {
	const result = readBudget(source, parseYaml);
	if (result.ok) {
		assert.fail('expected problems, but it was read fine');
	}
	return result.problems;
}

void test('reads the spec example', () => {
	const result = readOk(EXAMPLE);
	assert.deepEqual(result.budget, EXAMPLE_BUDGET);
	assert.deepEqual(result.readOnlyReasons, []);
});

void test('adds up the spec example correctly', () => {
	const summary = summarize(EXAMPLE_BUDGET);
	assert.equal(summary.allocatedCents, 241250); // 1450 + 512.50 + 150 + 300
	assert.equal(summary.leftCents, 158750); // 4000 - 2412.50
	assert.equal(leftText(summary.leftCents), '$1,587.50');
	assert.deepEqual(summary.groupCents, { needs: 196250, wants: 15000, savings: 30000 });
	assert.equal(percentText(summary.groupCents.needs, 400000), '49.1%'); // 49.0625%
	assert.equal(percentText(summary.groupCents.wants, 400000), '3.8%'); // 3.75%
	assert.equal(percentText(summary.groupCents.savings, 400000), '7.5%');
	assert.equal(formatMoney(summary.allocatedCents), '$2,412.50');
});

void test('over budget shows "Over by"', () => {
	const budget = readOk(`total: 1000
categories:
  - name: A
    group: needs
    amount: 600
  - name: B
    group: wants
    amount: 500`).budget;
	assert.equal(leftText(summarize(budget).leftCents), 'Over by $100.00');
});

void test('0.10 + 0.20 from a note adds up to exactly 0.30', () => {
	const budget = readOk(`total: 1
categories:
  - name: A
    group: needs
    amount: 0.10
  - name: B
    group: needs
    amount: 0.20`).budget;
	assert.equal(summarize(budget).allocatedCents, 30);
	assert.equal(formatMoney(summarize(budget).allocatedCents), '$0.30');
});

void test('writes YAML with fixed key order and 2 decimals', () => {
	assert.equal(
		serializeBudget(EXAMPLE_BUDGET),
		`name: Household
month: 2026-11
total: 4000.00
currency: USD
categories:
  - name: Rent
    group: needs
    amount: 1450.00
    locked: true
  - name: Groceries
    group: needs
    amount: 512.50
    locked: false
  - name: Dining out
    group: wants
    amount: 150.00
    locked: false
  - name: Emergency fund
    group: savings
    amount: 300.00
    locked: false`,
	);
});

void test('what it writes reads back exactly the same (round trip)', () => {
	const tricky: Budget = {
		name: 'Trip: Spain #2',
		month: '',
		totalCents: 123456,
		currency: 'USD',
		categories: [
			'Rent: main', "Kid's #1 toys", 'true', 'yes', '2024', 'Café ☕', '- dash', '"quoted"',
			'back\\slash', '#hashtag', 'Sinking funds (car, holidays)', 'Car insurance and maintenance',
		].map((name, i) => ({
			name,
			group: (['needs', 'wants', 'savings'] as const)[i % 3] ?? 'needs',
			amountCents: i * 1001,
			locked: i % 2 === 0,
		})),
	};
	for (const budget of [EXAMPLE_BUDGET, tricky, { ...EXAMPLE_BUDGET, name: '', categories: [] }]) {
		const text = serializeBudget(budget);
		const back = readOk(text);
		assert.deepEqual(back.budget, budget, text);
		assert.deepEqual(back.readOnlyReasons, [], text);
	}
});

void test('quotes text only when needed', () => {
	assert.equal(yamlText('Dining out'), 'Dining out');
	assert.equal(yamlText('Sinking funds (car, holidays)'), 'Sinking funds (car, holidays)');
	assert.equal(yamlText('Rent: main'), '"Rent: main"');
	assert.equal(yamlText('yes'), '"yes"');
	assert.equal(yamlText('2024'), '"2024"');
	assert.equal(yamlText('A #1'), '"A #1"');
});

void test('fills in defaults for missing optional lines', () => {
	const budget = readOk(`total: 100
categories:
  - name: Pets
    group: Wants`).budget;
	assert.deepEqual(budget, {
		name: '',
		month: '',
		totalCents: 10000,
		currency: 'USD',
		categories: [{ name: 'Pets', group: 'wants', amountCents: 0, locked: false }],
	});
	assert.deepEqual(readOk('total: 5').budget.categories, []);
});

void test('broken data gives clear messages instead of crashing', () => {
	assert.match(readProblems('')[0] ?? '', /empty/);
	assert.match(readProblems('   \n  ')[0] ?? '', /empty/);
	assert.match(readProblems('total: [4000')[0] ?? '', /YAML is broken/);
	assert.match(readProblems('- just\n- a list')[0] ?? '', /key: value/);
	assert.match(readProblems('categories: []')[0] ?? '', /"total" is missing/);
	assert.match(readProblems('total: abc')[0] ?? '', /"total" should be an amount/);
	assert.match(readProblems('total: -5')[0] ?? '', /"total" should be an amount/);
	assert.match(readProblems('total: 1\nmonth: 2026-13')[0] ?? '', /"month"/);
	assert.match(readProblems('total: 1\nmonth: November')[0] ?? '', /"month"/);
	assert.match(readProblems('total: 1\ncurrency: EUR')[0] ?? '', /only be USD/);
	assert.match(readProblems('total: 1\ncategories: oops')[0] ?? '', /should be a list/);
	assert.match(readProblems('total: 1\ncategories:\n  - just text')[0] ?? '', /Category 1 should have/);
	assert.match(readProblems('total: 1\ncategories:\n  - group: needs')[0] ?? '', /Category 1 needs a name/);
	const cat = (line: string) => `total: 1\ncategories:\n  - name: Rent\n    group: needs\n    ${line}`;
	assert.match(readProblems(cat('group: fun').replace('group: needs\n    ', ''))[0] ?? '', /Category 1 \("Rent"\): "group"/);
	assert.match(readProblems(cat('amount: 12.345'))[0] ?? '', /"amount" should be an amount/);
	assert.match(readProblems(cat('amount: -1'))[0] ?? '', /"amount"/);
	assert.match(readProblems(cat('locked: maybe'))[0] ?? '', /"locked" should be true or false/);
});

void test('collects every problem at once', () => {
	const problems = readProblems('month: soon\ncategories:\n  - name: Rent\n    group: fun');
	assert.equal(problems.length, 3, problems.join(' | ')); // month, total missing, group
});

void test('a YAML reader that throws something odd still gives a message', () => {
	const result = readBudget('total: 1', () => {
		// eslint-disable-next-line @typescript-eslint/only-throw-error -- on purpose: tests a reader that throws a non-Error
		throw 'boom';
	});
	assert.equal(result.ok, false);
	assert.equal(checkBudget(undefined).ok, false);
	assert.equal(checkBudget(new Date()).ok, false);
});

void test('unknown settings turn editing off but still show the budget', () => {
	const top = readOk('total: 1\nnotes: hello');
	assert.equal(top.readOnlyReasons.length, 1);
	assert.match(top.readOnlyReasons[0] ?? '', /"notes"/);
	const inCategory = readOk('total: 1\ncategories:\n  - name: Rent\n    group: needs\n    spent: 10');
	assert.match(inCategory.readOnlyReasons[0] ?? '', /Category 1 \("Rent"\).*"spent"/);
});

/** A small mixed list: needs and wants interleaved, like a hand-edited note. */
function mixed(): Category[] {
	return [
		{ name: 'A', group: 'needs', amountCents: 100, locked: false },
		{ name: 'B', group: 'wants', amountCents: 200, locked: false },
		{ name: 'C', group: 'needs', amountCents: 300, locked: true },
	];
}
const names = (categories: Category[]): string => categories.map((c) => c.name).join(',');

void test('moving categories stays inside the group', () => {
	assert.equal(neighbourIndex(mixed(), 2, -1), 0); // C's previous "needs" is A
	assert.equal(neighbourIndex(mixed(), 0, -1), -1);
	assert.equal(neighbourIndex(mixed(), 1, 1), -1); // B is the only "wants"
	const list = mixed();
	assert.equal(moveCategory(list, 2, -1), true);
	assert.equal(names(list), 'C,B,A');
	assert.equal(moveCategory(list, 0, -1), false); // already first
	assert.equal(moveCategory(list, 1, 1), false); // only one in its group
	assert.equal(names(list), 'C,B,A');
	assert.equal(list[0]?.locked, true); // the category moves with its settings
});

void test('adding a category puts it at the end of its group with $0.00', () => {
	const list = mixed();
	assert.equal(addCategory(list, 'needs', 'D'), 3);
	assert.equal(names(list), 'A,B,C,D');
	assert.equal(addCategory(list, 'wants', 'E'), 2);
	assert.equal(names(list), 'A,B,E,C,D');
	assert.equal(addCategory(list, 'savings', 'F'), 5); // empty group: at the end
	assert.deepEqual(list[5], { name: 'F', group: 'savings', amountCents: 0, locked: false });
	assert.equal(addCategory([], 'wants', 'G'), 0);
});

void test('new category names never clash', () => {
	assert.equal(uniqueCategoryName(mixed()), 'New category');
	const list = mixed();
	addCategory(list, 'needs', 'New category');
	assert.equal(uniqueCategoryName(list), 'New category 2');
	addCategory(list, 'needs', 'new category 2');
	assert.equal(uniqueCategoryName(list), 'New category 3');
});

void test('monthLabel names the month', () => {
	assert.equal(monthLabel('2026-11'), 'November 2026');
	assert.equal(monthLabel('2027-01'), 'January 2027');
	assert.equal(monthLabel('2026-12'), 'December 2026');
	assert.equal(monthLabel(''), '');
	assert.equal(monthLabel('2026-13'), '2026-13');
});

void test('comments turn editing off (saving would remove them)', () => {
	const withComment = readOk('total: 4000 # monthly\ncategories: []');
	assert.match(withComment.readOnlyReasons[0] ?? '', /Line 1 /);
	const fullLine = readOk('# my budget\ntotal: 4000');
	assert.match(fullLine.readOnlyReasons[0] ?? '', /Line 1 /);
	const hashInQuotes = readOk('name: "A #1"\ntotal: 4000');
	assert.deepEqual(hashInQuotes.readOnlyReasons, []);
});

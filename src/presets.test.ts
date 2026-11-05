// Automated tests for src/presets.ts. Run with: npm test
// Fake numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { GROUPS, readBudget, summarize } from './budget';
import {
	STARTER_CATEGORIES,
	budgetNameProblem,
	budgetNoteText,
	currentMonth,
	makeBudget,
	splitByGuideline,
	splitEvenly,
} from './presets';

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

void test('splitEvenly uses whole dollars and adds up exactly', () => {
	assert.deepEqual(splitEvenly(200000, 8), Array(8).fill(25000)); // $2,000 / 8 = $250
	assert.deepEqual(splitEvenly(120000, 7), [17200, 17200, 17200, 17100, 17100, 17100, 17100]); // $1,200 / 7
	assert.deepEqual(splitEvenly(80000, 3), [26700, 26700, 26600]); // $800 / 3
	assert.deepEqual(splitEvenly(1001, 3), [401, 300, 300]); // $10.01 / 3: $4 + 1¢, $3, $3
	assert.deepEqual(splitEvenly(5, 3), [5, 0, 0]);
	assert.deepEqual(splitEvenly(0, 3), [0, 0, 0]);
	assert.deepEqual(splitEvenly(100, 0), []);
	for (const cents of [0, 1, 99, 100, 12345, 400000, 123456, 9999999]) {
		for (const count of [1, 3, 7, 8]) {
			assert.equal(sum(splitEvenly(cents, count)), cents, `${cents} / ${count}`);
		}
	}
});

void test('splitByGuideline gives 50/30/20 and adds up exactly', () => {
	assert.deepEqual(splitByGuideline(400000), { needs: 200000, wants: 120000, savings: 80000 });
	assert.deepEqual(splitByGuideline(123456), { needs: 61728, wants: 37037, savings: 24691 });
	assert.deepEqual(splitByGuideline(7), { needs: 4, wants: 2, savings: 1 });
	for (const cents of [0, 1, 7, 99, 123456, 400000, 9999999]) {
		const parts = splitByGuideline(cents);
		assert.equal(parts.needs + parts.wants + parts.savings, cents, String(cents));
	}
});

void test('50/30/20 starter with $4,000: 18 categories, exact split', () => {
	const budget = makeBudget('starter', 'Household', '2026-11', 400000);
	assert.equal(budget.categories.length, 18);
	assert.deepEqual(
		budget.categories.map((c) => c.name),
		[...STARTER_CATEGORIES.needs, ...STARTER_CATEGORIES.wants, ...STARTER_CATEGORIES.savings],
	);
	const summary = summarize(budget);
	assert.deepEqual(summary.groupCents, { needs: 200000, wants: 120000, savings: 80000 });
	assert.equal(summary.leftCents, 0);
	assert.ok(budget.categories.every((c) => !c.locked));
	assert.equal(budget.categories.find((c) => c.name === 'Groceries')?.amountCents, 25000);
	assert.equal(budget.categories.find((c) => c.name === 'Dining out')?.amountCents, 17200);
	assert.equal(budget.categories.find((c) => c.name === 'Gifts')?.amountCents, 17100);
	assert.equal(budget.categories.find((c) => c.name === 'Sinking funds')?.amountCents, 26600);
});

void test('starter split always leaves exactly $0.00 to allocate', () => {
	for (const cents of [0, 1, 7, 99, 150050, 123456, 400000, 9999999]) {
		const budget = makeBudget('starter', 'X', '', cents);
		assert.equal(summarize(budget).leftCents, 0, String(cents));
		for (const group of GROUPS) {
			assert.equal(summarize(budget).groupCents[group], splitByGuideline(cents)[group]);
		}
	}
});

void test('blank preset has no categories', () => {
	assert.deepEqual(makeBudget('blank', 'Trip', '2026-12', 150000), {
		name: 'Trip',
		month: '2026-12',
		totalCents: 150000,
		currency: 'USD',
		categories: [],
	});
});

void test('the new note text reads back as the same budget', () => {
	for (const budget of [makeBudget('starter', 'Household', '2026-11', 400000), makeBudget('blank', 'Trip: Spain', '', 0)]) {
		const text = budgetNoteText(budget);
		assert.ok(text.startsWith('```budget-notes\n'));
		assert.ok(text.endsWith('\n```\n'));
		const inner = text.slice('```budget-notes\n'.length, -'\n```\n'.length);
		const result = readBudget(inner, (t) => parse(t));
		assert.ok(result.ok);
		assert.deepEqual(result.budget, budget);
	}
});

void test('currentMonth uses local year and month', () => {
	assert.equal(currentMonth(new Date(2026, 10, 5)), '2026-11');
	assert.equal(currentMonth(new Date(2027, 0, 1)), '2027-01');
	assert.equal(currentMonth(new Date(2026, 11, 31, 23, 59)), '2026-12');
});

void test('budget names: allowed and not allowed', () => {
	assert.equal(budgetNameProblem('Household November 2026'), undefined);
	assert.equal(budgetNameProblem('Trip – Spain (2027)'), undefined);
	assert.match(budgetNameProblem('') ?? '', /Enter a name/);
	assert.match(budgetNameProblem('   ') ?? '', /Enter a name/);
	for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a#b', 'a^b', 'a[b', 'a]b']) {
		assert.match(budgetNameProblem(bad) ?? '', /can't contain/, bad);
	}
	assert.match(budgetNameProblem('.hidden') ?? '', /dot/);
	assert.match(budgetNameProblem('x'.repeat(101)) ?? '', /too long/);
});

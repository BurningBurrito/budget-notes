// Automated tests for src/blocks.ts. Run with: npm test
// Fake numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { findBudgetBlocks, replaceBudgetBlock } from './blocks';
import { readBudget, serializeBudget } from './budget';

const OLD = 'total: 100\ncategories: []';
const NEW = 'total: 200.00\ncurrency: USD\ncategories: []';

function replaced(note: string, oldSource: string, newSource: string, hint?: number): string {
	const result = replaceBudgetBlock(note, oldSource, newSource, hint);
	if (!result.ok) {
		assert.fail(`expected ok, got: ${result.reason}`);
	}
	return result.text;
}

void test('replaces only the budget block; the rest of the note stays exactly the same', () => {
	const note = '# My note\n\nSome text.\n\n```budget-notes\ntotal: 100\ncategories: []\n```\n\nMore text after.\n';
	assert.equal(
		replaced(note, OLD, NEW),
		'# My note\n\nSome text.\n\n```budget-notes\ntotal: 200.00\ncurrency: USD\ncategories: []\n```\n\nMore text after.\n',
	);
});

void test('picks the right block when a note has two different budgets', () => {
	const note = '```budget-notes\ntotal: 1\n```\ntext\n```budget-notes\ntotal: 100\ncategories: []\n```\n';
	assert.equal(replaced(note, OLD, 'total: 5.00'), '```budget-notes\ntotal: 1\n```\ntext\n```budget-notes\ntotal: 5.00\n```\n');
});

void test('identical blocks: uses the line hint, refuses without one', () => {
	const note = '```budget-notes\ntotal: 100\ncategories: []\n```\n\n```budget-notes\ntotal: 100\ncategories: []\n```';
	assert.equal(
		replaced(note, OLD, 'total: 9.00', 5),
		'```budget-notes\ntotal: 100\ncategories: []\n```\n\n```budget-notes\ntotal: 9.00\n```',
	);
	const result = replaceBudgetBlock(note, OLD, 'total: 9.00');
	assert.equal(result.ok, false);
	assert.match(result.ok ? '' : result.reason, /several identical budget blocks/);
});

void test('never overwrites a block that was changed somewhere else', () => {
	const note = '```budget-notes\ntotal: 150\ncategories: []\n```\n';
	const result = replaceBudgetBlock(note, OLD, NEW);
	assert.equal(result.ok, false);
	assert.match(result.ok ? '' : result.reason, /changed somewhere else/);
});

void test('keeps Windows line endings (CRLF)', () => {
	const note = 'Intro\r\n```budget-notes\r\ntotal: 100\r\ncategories: []\r\n```\r\nEnd\r\n';
	assert.equal(replaced(note, OLD, 'total: 7.00'), 'Intro\r\n```budget-notes\r\ntotal: 7.00\r\n```\r\nEnd\r\n');
});

void test('keeps the indent of a block inside a list', () => {
	const note = '- item\n    ```budget-notes\n    total: 100\n    categories: []\n    ```\n- next';
	assert.equal(
		replaced(note, OLD, 'total: 1.00\ncategories: []'),
		'- item\n    ```budget-notes\n    total: 1.00\n    categories: []\n    ```\n- next',
	);
});

void test('understands ~~~ fences, longer fences and "``` budget-notes" with a space', () => {
	assert.equal(replaced('~~~budget-notes\ntotal: 100\ncategories: []\n~~~', OLD, 'total: 2.00'), '~~~budget-notes\ntotal: 2.00\n~~~');
	assert.equal(
		replaced('````budget-notes\ntotal: 100\ncategories: []\n````', OLD, 'total: 2.00'),
		'````budget-notes\ntotal: 2.00\n````',
	);
	assert.equal(replaced('``` budget-notes\ntotal: 100\ncategories: []\n```', OLD, 'total: 2.00'), '``` budget-notes\ntotal: 2.00\n```');
});

void test('ignores a budget example inside another code block', () => {
	const note = '````markdown\n```budget-notes\ntotal: 100\ncategories: []\n```\n````\n';
	assert.equal(findBudgetBlocks(note.split('\n')).length, 0);
	assert.equal(replaceBudgetBlock(note, OLD, NEW).ok, false);
});

void test('only ```budget-notes blocks count, not plain ```budget (another plugin uses that)', () => {
	const note = '```budget\ntotal: 100\ncategories: []\n```\n\n```budget-notes\ntotal: 100\ncategories: []\n```\n';
	const blocks = findBudgetBlocks(note.split('\n'));
	assert.equal(blocks.length, 1);
	assert.equal(blocks[0]?.openLine, 5);
	assert.equal(
		replaced(note, OLD, 'total: 8.00'),
		'```budget\ntotal: 100\ncategories: []\n```\n\n```budget-notes\ntotal: 8.00\n```\n',
	);
});

void test('handles a block that is never closed and a note with no final newline', () => {
	assert.equal(replaced('```budget-notes\ntotal: 100\ncategories: []', OLD, 'total: 3.00'), '```budget-notes\ntotal: 3.00');
	assert.equal(replaced('```budget-notes\ntotal: 100\ncategories: []\n```', OLD, 'total: 3.00'), '```budget-notes\ntotal: 3.00\n```');
});

void test('matches even with trailing spaces or a trailing newline in the source', () => {
	const note = '```budget-notes\ntotal: 100   \ncategories: []\n```';
	assert.equal(replaced(note, 'total: 100\ncategories: []\n', 'total: 4.00'), '```budget-notes\ntotal: 4.00\n```');
});

void test('full save: change one amount, write it back, read it again', () => {
	const note = [
		'# Household',
		'',
		'```budget-notes',
		'name: Household',
		'month: 2026-11',
		'total: 4000',
		'categories:',
		'  - name: Rent',
		'    group: needs',
		'    amount: 1450',
		'    locked: true',
		'  - name: Groceries',
		'    group: needs',
		'    amount: 512.50',
		'```',
		'',
		'Notes below the budget stay.',
	].join('\n');
	const oldSource = findBudgetBlocks(note.split('\n'))[0]?.content ?? '';
	const result = readBudget(oldSource, (text) => parse(text));
	assert.ok(result.ok);
	const budget = result.budget;
	const groceries = budget.categories[1];
	assert.ok(groceries);
	groceries.amountCents = 60025; // $600.25
	const saved = replaced(note, oldSource, serializeBudget(budget));
	assert.equal(
		saved,
		[
			'# Household',
			'',
			'```budget-notes',
			'name: Household',
			'month: 2026-11',
			'total: 4000.00',
			'currency: USD',
			'categories:',
			'  - name: Rent',
			'    group: needs',
			'    amount: 1450.00',
			'    locked: true',
			'  - name: Groceries',
			'    group: needs',
			'    amount: 600.25',
			'    locked: false',
			'```',
			'',
			'Notes below the budget stay.',
		].join('\n'),
	);
	const again = readBudget(findBudgetBlocks(saved.split('\n'))[0]?.content ?? '', (text) => parse(text));
	assert.ok(again.ok);
	assert.equal(again.budget.categories[1]?.amountCents, 60025);
});

// Automated tests for src/money.ts. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centsToPlain, formatMoney, leftText, parseMoney, percentText } from './money';

void test('parseMoney reads valid amounts as whole cents', () => {
	const cases: [unknown, number][] = [
		['1,234.56', 123456],
		['$1,234.56', 123456],
		['$ 12', 1200],
		['512.5', 51250],
		['512.50', 51250],
		[512.5, 51250],
		[4000, 400000],
		['0', 0],
		[0, 0],
		['.5', 50],
		['5.', 500],
		[' 42 ', 4200],
		[0.29, 29],
		[0.1, 10],
		['1000000000', 100000000000],
	];
	for (const [input, expected] of cases) {
		assert.equal(parseMoney(input), expected, `input ${JSON.stringify(input)}`);
	}
});

void test('parseMoney rejects invalid amounts', () => {
	const bad: unknown[] = [
		'12.345', 12.345, '-5', -5, 'abc', '', '.', '1,23', '1,2345', '1e5', 1e21,
		Number.NaN, Number.POSITIVE_INFINITY, null, undefined, true, '1000000000.01',
	];
	for (const input of bad) {
		assert.equal(parseMoney(input), null, `input ${String(input)}`);
	}
});

void test('0.1 + 0.2 is exactly 0.30 when done in cents', () => {
	const sum = (parseMoney(0.1) ?? -1) + (parseMoney(0.2) ?? -1);
	assert.equal(sum, 30);
	assert.equal(centsToPlain(sum), '0.30');
});

void test('formatMoney shows dollars with commas and cents', () => {
	assert.equal(formatMoney(123456), '$1,234.56');
	assert.equal(formatMoney(0), '$0.00');
	assert.equal(formatMoney(5), '$0.05');
	assert.equal(formatMoney(100), '$1.00');
	assert.equal(formatMoney(99999), '$999.99');
	assert.equal(formatMoney(100000), '$1,000.00');
	assert.equal(formatMoney(100000000), '$1,000,000.00');
	assert.equal(formatMoney(-12345), '-$123.45');
});

void test('centsToPlain always writes 2 decimals, no commas', () => {
	assert.equal(centsToPlain(51250), '512.50');
	assert.equal(centsToPlain(400000), '4000.00');
	assert.equal(centsToPlain(5), '0.05');
	assert.equal(centsToPlain(0), '0.00');
});

void test('percentText rounds to one decimal', () => {
	assert.equal(percentText(145000, 400000), '36.3%'); // 36.25%
	assert.equal(percentText(0, 400000), '0.0%');
	assert.equal(percentText(400000, 400000), '100.0%');
	assert.equal(percentText(100, 300), '33.3%');
	assert.equal(percentText(200, 300), '66.7%');
	assert.equal(percentText(500, 0), '–');
});

void test('leftText says "Over by" when negative', () => {
	assert.equal(leftText(158750), '$1,587.50');
	assert.equal(leftText(0), '$0.00');
	assert.equal(leftText(-10000), 'Over by $100.00');
});

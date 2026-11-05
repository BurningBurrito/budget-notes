/*
 * Finding a ```budget-notes block inside a note's text and replacing it.
 *
 * Safety rule: a block is only replaced if its current text is exactly what
 * the screen was drawn from. If the note was changed somewhere else in the
 * meantime, nothing is overwritten.
 *
 * No Obsidian imports here, so the automated tests can run this file directly.
 */

export interface BudgetBlock {
	/** Line number (0-based) of the opening ```budget-notes fence. */
	openLine: number;
	/** Line number of the closing fence, or null if the block is never closed. */
	closeLine: number | null;
	/** Spaces/tabs in front of the opening fence (e.g. inside a list). */
	indent: string;
	/** The text between the fences, with the indent removed. */
	content: string;
}

/**
 * The code block name this plugin draws: ```budget-notes.
 * (Not plain "budget": another published plugin already uses that.)
 */
export const BLOCK_LANGUAGE = 'budget-notes';

const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})(.*)$/;

/** Finds every ```budget-notes block. Fences inside other code blocks are skipped. */
export function findBudgetBlocks(lines: string[]): BudgetBlock[] {
	const blocks: BudgetBlock[] = [];
	let i = 0;
	while (i < lines.length) {
		const open = FENCE_OPEN.exec(lines[i] ?? '');
		if (!open) {
			i++;
			continue;
		}
		const indent = open[1] ?? '';
		const fence = open[2] ?? '';
		const info = (open[3] ?? '').trim();
		// A backtick fence's info text can't contain backticks (Markdown rule).
		if (fence.startsWith('`') && info.includes('`')) {
			i++;
			continue;
		}
		const fenceChar = fence.charAt(0);
		let close: number | null = null;
		for (let j = i + 1; j < lines.length; j++) {
			const line = (lines[j] ?? '').trim();
			if (line.length >= fence.length && line === fenceChar.repeat(line.length)) {
				close = j;
				break;
			}
		}
		if (info === BLOCK_LANGUAGE) {
			const end = close ?? lines.length;
			const content = lines
				.slice(i + 1, end)
				.map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line.trimStart()))
				.join('\n');
			blocks.push({ openLine: i, closeLine: close, indent, content });
		}
		i = (close ?? lines.length) + 1;
	}
	return blocks;
}

/** Makes texts comparable: ignores line-ending style and spaces at line ends. */
export function normalizeBlockText(text: string): string {
	return text
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.join('\n')
		.trim();
}

export type ReplaceResult = { ok: true; text: string } | { ok: false; reason: string };

/**
 * Replaces the budget block whose text is `oldSource` with `newSource`.
 * `lineHint` (the block's opening line, if known) picks between identical blocks.
 * Returns the whole new note text, or a reason why nothing was changed.
 */
export function replaceBudgetBlock(
	noteText: string,
	oldSource: string,
	newSource: string,
	lineHint?: number,
): ReplaceResult {
	const eol = noteText.includes('\r\n') ? '\r\n' : '\n';
	const lines = noteText.split(/\r?\n/);
	const wanted = normalizeBlockText(oldSource);
	const matches = findBudgetBlocks(lines).filter((block) => normalizeBlockText(block.content) === wanted);

	let target: BudgetBlock | undefined;
	if (matches.length === 1) {
		target = matches[0];
	} else if (matches.length > 1) {
		target = matches.find((block) => block.openLine === lineHint);
	}

	if (matches.length === 0) {
		return {
			ok: false,
			reason: 'The budget block in the note was changed somewhere else (or it is inside a callout or quote, which can\'t be saved yet), so nothing was overwritten. Close and reopen the note to see the current version.',
		};
	}
	if (!target) {
		return {
			ok: false,
			reason: 'This note has several identical budget blocks and the plugin could not tell which one you changed. Give each budget a different name.',
		};
	}

	const newLines = newSource.split('\n').map((line) => (line === '' ? '' : target.indent + line));
	const before = lines.slice(0, target.openLine + 1);
	const after = target.closeLine === null ? [] : lines.slice(target.closeLine);
	return { ok: true, text: [...before, ...newLines, ...after].join(eol) };
}

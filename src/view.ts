/*
 * The slider screen drawn in place of a ```budget-notes block.
 *
 * Slider mode: everything reacts live. Changes are written back into the note
 * half a second after you let go of a slider, leave a box (or press Enter),
 * or flip a lock. Touching anything again pushes the save back.
 *
 * Edit mode ("Edit categories"): rename, reorder, add and delete categories.
 * These changes are saved together when you click "Done" (or close the note),
 * because every save redraws the block and would throw you out of edit mode.
 */

import {
	type App,
	Component,
	ConfirmationModal,
	ExtraButtonComponent,
	MarkdownRenderChild,
	Notice,
	ToggleComponent,
	type MarkdownPostProcessorContext,
} from 'obsidian';
import { normalizeBlockText, replaceBudgetBlock } from './blocks';
import {
	type Budget,
	type Category,
	type Group,
	GROUPS,
	GROUP_LABELS,
	GUIDELINE_PERCENT,
	addCategory,
	monthLabel,
	moveCategory,
	neighbourIndex,
	readBudget,
	serializeBudget,
	summarize,
	uniqueCategoryName,
} from './budget';
import { centsToPlain, formatMoney, leftText, parseMoney, percentText } from './money';

/** How long to wait after the last change before writing to the note. */
const SAVE_DELAY_MS = 500;

/** Draws one budget block. Never throws: any failure becomes a message in the note. */
export function renderBudgetBlock(
	app: App,
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	parseYaml: (text: string) => unknown,
): void {
	try {
		const result = readBudget(source, parseYaml);
		if (!result.ok) {
			renderProblems(el, result.problems);
			return;
		}
		ctx.addChild(new BudgetView(el, result.budget, result.readOnlyReasons, { app, ctx, source }));
	} catch (error) {
		el.empty();
		renderProblems(el, [`Something went wrong while drawing this budget: ${String(error)}`]);
	}
}

/** The message shown instead of the sliders when the block can't be read. */
export function renderProblems(el: HTMLElement, problems: string[]): void {
	const box = el.createDiv({ cls: ['budget-notes', 'budget-notes-error'] });
	box.createDiv({ cls: 'budget-notes-error-title', text: 'This budget block has a problem' });
	const list = box.createEl('ul');
	for (const problem of problems) {
		list.createEl('li', { text: problem });
	}
	box.createDiv({
		cls: 'budget-notes-error-help',
		text: 'Nothing in the note was changed. Fix the text inside the budget block and this message updates.',
	});
}

interface Row {
	category: Category;
	rowEl: HTMLElement;
	slider: HTMLInputElement;
	box: HTMLInputElement;
	percentEl: HTMLElement;
}

/** What the view needs to write back into the note. */
interface SaveTarget {
	app: App;
	ctx: MarkdownPostProcessorContext;
	/** The block's text as it was when the screen was drawn. */
	source: string;
}

export class BudgetView extends MarkdownRenderChild {
	private readonly budget: Budget;
	private readonly readOnlyReasons: string[];
	private readonly editable: boolean;
	private readonly target: SaveTarget;

	/** True while "Edit categories" is on. */
	private editMode = false;
	/** Owns the event listeners of the current drawing; replaced on every redraw. */
	private ui: Component | null = null;
	private rows: Row[] = [];
	private groupSumEls = new Map<Group, HTMLElement>();
	private leftRowEl: HTMLElement | null = null;
	private leftAmountEl: HTMLElement | null = null;
	/** A just-added category whose name box should get the cursor after redrawing. */
	private focusCategory: Category | null = null;

	/** The block's text as last read from or written to the note. */
	private lastSource: string;
	/** True when the screen has changes that aren't in the note yet. */
	private dirty = false;
	private saveTimer: number | null = null;
	/** Saves run one after another, never at the same time. */
	private saveChain: Promise<void> = Promise.resolve();

	constructor(containerEl: HTMLElement, budget: Budget, readOnlyReasons: string[], target: SaveTarget) {
		super(containerEl);
		this.budget = budget;
		this.readOnlyReasons = readOnlyReasons;
		this.editable = readOnlyReasons.length === 0;
		this.target = target;
		this.lastSource = target.source;
	}

	onload(): void {
		this.redraw();
	}

	/** Note closed, view switched or plugin turned off: save right away if needed. */
	onunload(): void {
		this.cancelSaveTimer();
		if (this.dirty) {
			this.queueSave();
		}
	}

	// ----- Saving -----------------------------------------------------------

	/** Something on screen changed, but the user is still busy (dragging/typing). */
	private changing(): void {
		this.dirty = true;
		this.cancelSaveTimer();
	}

	/** The user finished a change: save after a short pause (in edit mode: on "Done"). */
	private changed(): void {
		this.dirty = true;
		this.cancelSaveTimer();
		if (this.editMode) {
			return;
		}
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			this.queueSave();
		}, SAVE_DELAY_MS);
	}

	private cancelSaveTimer(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
	}

	private queueSave(): void {
		this.saveChain = this.saveChain
			.then(() => this.save())
			.catch((error) => {
				new Notice(`Budget not saved: ${String(error)}`, 10000);
			});
	}

	/** Writes the budget into the note, replacing only this block. Never throws. */
	private async save(): Promise<void> {
		if (!this.dirty || !this.editable) {
			return;
		}
		this.dirty = false;
		const newSource = serializeBudget(this.budget);
		if (normalizeBlockText(newSource) === normalizeBlockText(this.lastSource)) {
			return;
		}
		const { app, ctx } = this.target;
		const file = app.vault.getFileByPath(ctx.sourcePath);
		if (!file) {
			new Notice(`Budget not saved: the note "${ctx.sourcePath}" could not be found.`, 10000);
			return;
		}
		const lineHint = ctx.getSectionInfo(this.containerEl)?.lineStart;
		const outcome = { failure: '' };
		try {
			await app.vault.process(file, (data) => {
				const result = replaceBudgetBlock(data, this.lastSource, newSource, lineHint);
				if (!result.ok) {
					outcome.failure = result.reason;
					return data;
				}
				return result.text;
			});
		} catch (error) {
			outcome.failure = `The note could not be written: ${String(error)}`;
		}
		if (outcome.failure) {
			new Notice(`Budget not saved. ${outcome.failure}`, 10000);
			return;
		}
		this.lastSource = newSource;
	}

	// ----- Drawing ----------------------------------------------------------

	/** Draws the whole screen again (used when switching modes or changing the list). */
	private redraw(): void {
		if (this.ui) {
			this.removeChild(this.ui);
		}
		this.ui = this.addChild(new Component());
		this.rows = [];
		this.groupSumEls = new Map();
		this.leftRowEl = null;
		this.leftAmountEl = null;
		this.containerEl.empty();
		try {
			this.render(this.ui);
		} catch (error) {
			this.containerEl.empty();
			renderProblems(this.containerEl, [`Something went wrong while drawing this budget: ${String(error)}`]);
		}
	}

	private render(ui: Component): void {
		const root = this.containerEl.createDiv({ cls: 'budget-notes' });
		root.toggleClass('is-editing', this.editMode);

		const header = root.createDiv({ cls: 'budget-notes-header' });
		header.createSpan({ cls: 'budget-notes-title', text: this.budget.name || 'Budget' });
		if (this.budget.month) {
			header.createSpan({ cls: 'budget-notes-month', text: monthLabel(this.budget.month) });
		}
		if (this.editable) {
			const toggle = header.createEl('button', {
				cls: 'budget-notes-edit-toggle',
				text: this.editMode ? 'Done' : 'Edit categories',
			});
			toggle.toggleClass('mod-cta', this.editMode);
			ui.registerDomEvent(toggle, 'click', () => this.setEditMode(!this.editMode));
		}

		if (!this.editable) {
			const notice = root.createDiv({ cls: 'budget-notes-notice' });
			notice.createDiv({ text: 'Editing is off for this budget:' });
			const list = notice.createEl('ul');
			for (const reason of this.readOnlyReasons) {
				list.createEl('li', { text: reason });
			}
		}
		if (this.editMode) {
			root.createDiv({
				cls: 'budget-notes-edit-help',
				text: 'Rename, reorder, add or delete categories. Changes are saved when you click "Done".',
			});
		}

		const totalRow = root.createDiv({ cls: 'budget-notes-total' });
		totalRow.createSpan({ cls: 'budget-notes-total-label', text: 'Total monthly budget' });
		const totalAmount = totalRow.createDiv({ cls: 'budget-notes-amount' });
		this.moneyBox(
			ui,
			totalAmount,
			'Total monthly budget in dollars',
			() => this.budget.totalCents,
			(cents) => {
				this.budget.totalCents = cents;
				this.refresh();
			},
		);

		for (const group of GROUPS) {
			const section = root.createDiv({ cls: 'budget-notes-group' });
			const head = section.createDiv({ cls: 'budget-notes-group-head' });
			head.createSpan({ cls: 'budget-notes-group-name', text: GROUP_LABELS[group] });
			this.groupSumEls.set(group, head.createSpan({ cls: 'budget-notes-group-sum' }));
			const members = this.budget.categories.filter((category) => category.group === group);
			if (members.length === 0) {
				section.createDiv({ cls: 'budget-notes-empty', text: 'No categories in this group.' });
			}
			for (const category of members) {
				if (this.editMode) {
					this.renderEditRow(ui, section, category);
				} else {
					this.renderRow(ui, section, category);
				}
			}
			if (this.editMode) {
				const add = section.createEl('button', { cls: 'budget-notes-add', text: 'Add category' });
				ui.registerDomEvent(add, 'click', () => this.addTo(group));
			}
		}

		this.leftRowEl = root.createDiv({ cls: 'budget-notes-left' });
		this.leftRowEl.createSpan({ text: 'Left to allocate' });
		this.leftAmountEl = this.leftRowEl.createSpan({ cls: 'budget-notes-left-amount' });

		this.refresh();
	}

	/** One category in slider mode: name | slider | $ box | percent | lock. */
	private renderRow(ui: Component, parent: HTMLElement, category: Category): void {
		const rowEl = parent.createDiv({ cls: 'budget-notes-row' });
		rowEl.createDiv({ cls: 'budget-notes-name', text: category.name });

		const slider = rowEl.createEl('input', {
			type: 'range',
			cls: ['slider', 'budget-notes-slider'],
			attr: { min: '0', step: '1', 'aria-label': `${category.name}: slider` },
		});

		const amountEl = rowEl.createDiv({ cls: 'budget-notes-amount' });
		const box = this.moneyBox(
			ui,
			amountEl,
			`${category.name}: amount in dollars`,
			() => category.amountCents,
			(cents) => {
				category.amountCents = cents;
				this.refresh();
			},
		);

		const percentEl = rowEl.createDiv({ cls: 'budget-notes-percent' });
		const row: Row = { category, rowEl, slider, box, percentEl };

		const lockEl = rowEl.createDiv({ cls: 'budget-notes-lock' });
		new ToggleComponent(lockEl)
			.setValue(category.locked)
			.setTooltip('Lock this amount')
			.setDisabled(!this.editable)
			.onChange((locked) => {
				category.locked = locked;
				this.applyLock(row);
				this.changed();
			});

		// Dragging moves in whole dollars and updates everything live.
		ui.registerDomEvent(slider, 'input', () => {
			category.amountCents = Number(slider.value) * 100;
			box.value = centsToPlain(category.amountCents);
			box.removeClass('is-invalid');
			box.removeAttribute('aria-invalid');
			this.refresh();
			this.changing();
		});
		// Fires when the slider is let go (or after an arrow-key step).
		ui.registerDomEvent(slider, 'change', () => this.changed());

		this.rows.push(row);
		this.applyLock(row);
	}

	/** One category in edit mode: name box | amount | up | down | delete. */
	private renderEditRow(ui: Component, parent: HTMLElement, category: Category): void {
		const rowEl = parent.createDiv({ cls: ['budget-notes-row', 'budget-notes-edit-row'] });
		const index = this.budget.categories.indexOf(category);

		const nameBox = rowEl.createEl('input', {
			type: 'text',
			cls: 'budget-notes-name-box',
			attr: { maxlength: '100', autocomplete: 'off', 'aria-label': `Name of ${category.name}` },
		});
		nameBox.value = category.name;
		ui.registerDomEvent(nameBox, 'input', () => {
			const name = nameBox.value.trim();
			nameBox.toggleClass('is-invalid', name === '');
			if (name === '') {
				nameBox.setAttribute('aria-invalid', 'true');
			} else {
				nameBox.removeAttribute('aria-invalid');
				category.name = name;
				this.changed();
			}
		});
		ui.registerDomEvent(nameBox, 'keydown', (event) => {
			if (event.key === 'Enter') {
				nameBox.blur();
			}
		});
		ui.registerDomEvent(nameBox, 'blur', () => {
			// An empty name isn't allowed: go back to the last good one.
			nameBox.value = category.name;
			nameBox.removeClass('is-invalid');
			nameBox.removeAttribute('aria-invalid');
		});
		if (this.focusCategory === category) {
			this.focusCategory = null;
			window.setTimeout(() => {
				nameBox.focus();
				nameBox.select();
			}, 0);
		}

		rowEl.createDiv({ cls: 'budget-notes-edit-amount', text: formatMoney(category.amountCents) });

		const controls = rowEl.createDiv({ cls: 'budget-notes-edit-controls' });
		iconButton(controls, 'arrow-up', '↑', 'Move up', neighbourIndex(this.budget.categories, index, -1) < 0, () =>
			this.move(category, -1),
		);
		iconButton(controls, 'arrow-down', '↓', 'Move down', neighbourIndex(this.budget.categories, index, 1) < 0, () =>
			this.move(category, 1),
		);
		iconButton(controls, 'trash-2', '✕', 'Delete', false, () => this.confirmDelete(category));
	}

	/**
	 * A "$ [ 512.50 ]" box. Typing a valid amount updates everything live;
	 * an invalid one is marked red and ignored. Leaving the box (or Enter)
	 * tidies the text and saves.
	 */
	private moneyBox(
		ui: Component,
		parent: HTMLElement,
		label: string,
		get: () => number,
		set: (cents: number) => void,
	): HTMLInputElement {
		parent.createSpan({ cls: 'budget-notes-currency', text: '$' });
		const box = parent.createEl('input', {
			type: 'text',
			cls: 'budget-notes-box',
			attr: { inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'aria-label': label },
		});
		box.value = centsToPlain(get());
		box.disabled = !this.editable;
		ui.registerDomEvent(box, 'input', () => {
			const cents = parseMoney(box.value);
			box.toggleClass('is-invalid', cents === null);
			if (cents === null) {
				box.setAttribute('aria-invalid', 'true');
			} else {
				box.removeAttribute('aria-invalid');
				set(cents);
			}
			this.changing();
		});
		ui.registerDomEvent(box, 'keydown', (event) => {
			if (event.key === 'Enter') {
				box.blur();
			}
		});
		ui.registerDomEvent(box, 'blur', () => {
			box.value = centsToPlain(get());
			box.removeClass('is-invalid');
			box.removeAttribute('aria-invalid');
			if (this.dirty) {
				this.changed();
			}
		});
		return box;
	}

	private applyLock(row: Row): void {
		const frozen = row.category.locked || !this.editable;
		row.slider.disabled = frozen;
		row.box.disabled = frozen;
		row.rowEl.toggleClass('is-locked', row.category.locked);
	}

	/** Recomputes every number on screen from the budget (all math in cents). */
	private refresh(): void {
		const { totalCents } = this.budget;
		const summary = summarize(this.budget);
		const sliderMax = String(Math.ceil(totalCents / 100));
		for (const row of this.rows) {
			// Set the maximum before the value, so the value isn't cut off.
			row.slider.max = sliderMax;
			row.slider.value = String(Math.round(row.category.amountCents / 100));
			row.percentEl.setText(percentText(row.category.amountCents, totalCents));
		}
		for (const group of GROUPS) {
			const cents = summary.groupCents[group];
			this.groupSumEls
				.get(group)
				?.setText(`${formatMoney(cents)} · ${percentText(cents, totalCents)} (guideline ${GUIDELINE_PERCENT[group]}%)`);
		}
		this.leftAmountEl?.setText(leftText(summary.leftCents));
		this.leftRowEl?.toggleClass('is-over', summary.leftCents < 0);
	}

	// ----- Editing categories ----------------------------------------------

	private setEditMode(on: boolean): void {
		this.editMode = on;
		this.cancelSaveTimer();
		this.redraw();
		if (!on && this.dirty) {
			this.queueSave();
		}
	}

	private addTo(group: Group): void {
		const index = addCategory(this.budget.categories, group, uniqueCategoryName(this.budget.categories));
		this.focusCategory = this.budget.categories[index] ?? null;
		this.changed();
		this.redraw();
	}

	private move(category: Category, step: -1 | 1): void {
		if (moveCategory(this.budget.categories, this.budget.categories.indexOf(category), step)) {
			this.changed();
			this.redraw();
		}
	}

	private confirmDelete(category: Category): void {
		new ConfirmationModal(this.target.app)
			.setTitle('Delete category?')
			.setContent(
				`Delete "${category.name}" (${formatMoney(category.amountCents)})? Its amount goes back to "Left to allocate".`,
			)
			.addButton((button) =>
				button
					.setButtonText('Delete')
					.setDestructive()
					.setCta()
					.onClick(() => {
						const index = this.budget.categories.indexOf(category);
						if (index >= 0) {
							this.budget.categories.splice(index, 1);
							this.changed();
							this.redraw();
						}
					}),
			)
			.addCancelButton()
			.open();
	}
}

/** A small icon button; shows `fallback` text if the icon isn't available. */
function iconButton(
	parent: HTMLElement,
	icon: string,
	fallback: string,
	label: string,
	disabled: boolean,
	onClick: () => void,
): ExtraButtonComponent {
	const button = new ExtraButtonComponent(parent).setIcon(icon).setTooltip(label).setDisabled(disabled).onClick(onClick);
	if (!button.extraSettingsEl.querySelector('svg')) {
		button.extraSettingsEl.setText(fallback);
	}
	button.extraSettingsEl.setAttribute('aria-label', label);
	return button;
}

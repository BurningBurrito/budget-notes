/*
 * The "New budget" window: asks for a name, starting total, month and preset,
 * then creates the note in the budget folder. Never overwrites an existing note.
 */

import { type App, Modal, Notice, Setting, normalizePath } from 'obsidian';
import { isValidMonth } from './budget';
import { ensureFolder, cleanFolderPath } from './folder';
import { parseMoney } from './money';
import { type PresetId, PRESETS, budgetNameProblem, budgetNoteText, currentMonth, makeBudget } from './presets';

export class NewBudgetModal extends Modal {
	private readonly getFolder: () => string;
	private name = '';
	private totalText = '';
	private month = currentMonth(new Date());
	private preset: PresetId = 'starter';
	private errorEl: HTMLElement | null = null;
	private busy = false;

	constructor(app: App, getFolder: () => string) {
		super(app);
		this.getFolder = getFolder;
	}

	onOpen(): void {
		this.setTitle('New budget');
		const { contentEl } = this;

		new Setting(contentEl)
			.setName('Name')
			.setDesc('Also used as the note name.')
			.addText((text) => {
				text.setPlaceholder('Household 2026-11').onChange((value) => {
					this.name = value;
				});
				window.setTimeout(() => text.inputEl.focus(), 0);
			});

		new Setting(contentEl)
			.setName('Starting total')
			.setDesc('In dollars, for example 4000 or 4000.00. You can change it later.')
			.addText((text) => {
				text.inputEl.inputMode = 'decimal';
				text.setPlaceholder('4000').onChange((value) => {
					this.totalText = value;
				});
			});

		new Setting(contentEl)
			.setName('Month')
			.setDesc('Year and month, for example 2026-11.')
			.addText((text) => {
				text.setValue(this.month).onChange((value) => {
					this.month = value.trim();
				});
			});

		new Setting(contentEl)
			.setName('Starting preset')
			.setDesc('50/30/20 starter: 18 common categories, total split 50% needs, 30% wants, 20% savings. Blank: no categories.')
			.addDropdown((dropdown) => {
				for (const preset of PRESETS) {
					dropdown.addOption(preset.id, preset.label);
				}
				dropdown.setValue(this.preset).onChange((value) => {
					this.preset = value === 'blank' ? 'blank' : 'starter';
				});
			});

		this.errorEl = contentEl.createDiv({ cls: 'budget-notes-modal-error' });

		new Setting(contentEl)
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText('Create')
					.setCta()
					.onClick(() => void this.create()),
			);

		// Enter in a text field creates the budget (Enter on a button still clicks that button).
		this.scope.register([], 'Enter', (event) => {
			if (!(event.target instanceof HTMLInputElement)) {
				return true;
			}
			void this.create();
			return false;
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private showError(message: string): void {
		this.errorEl?.setText(message);
	}

	private async create(): Promise<void> {
		if (this.busy) {
			return;
		}
		const name = this.name.trim();
		const nameProblem = budgetNameProblem(name);
		if (nameProblem) {
			this.showError(nameProblem);
			return;
		}
		const totalCents = parseMoney(this.totalText);
		if (totalCents === null) {
			this.showError('Enter a starting total in dollars, for example 4000 (no minus sign, at most 2 decimals).');
			return;
		}
		if (!isValidMonth(this.month)) {
			this.showError('Enter the month as year-month, for example 2026-11.');
			return;
		}

		this.busy = true;
		try {
			const folder = cleanFolderPath(this.getFolder());
			if (!(await ensureFolder(this.app, folder))) {
				this.showError('The budget folder setting has a problem (see the message in the corner). Fix it in Settings → Budget Notes.');
				return;
			}
			const path = normalizePath(`${folder}/${name}.md`);
			if (this.app.vault.getAbstractFileByPath(path)) {
				this.showError(`A note called "${name}" already exists in "${folder}". Choose another name – nothing was changed.`);
				return;
			}
			const budget = makeBudget(this.preset, name, this.month, totalCents);
			const file = await this.app.vault.create(path, budgetNoteText(budget));
			this.close();
			new Notice(`Created budget "${name}" in "${folder}".`);
			await this.app.workspace.getLeaf(false).openFile(file);
		} catch (error) {
			this.showError(`The note could not be created: ${String(error)}`);
		} finally {
			this.busy = false;
		}
	}
}

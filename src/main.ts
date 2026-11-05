import { Plugin, parseYaml } from 'obsidian';
import { BLOCK_LANGUAGE } from './blocks';
import { ensureFolder } from './folder';
import { NewBudgetModal } from './newBudget';
import { renderBudgetBlock } from './view';
import {
	BudgetSettingTab,
	DEFAULT_SETTINGS,
	type BudgetPlannerSettings,
} from './settings';

export default class BudgetPlannerPlugin extends Plugin {
	settings!: BudgetPlannerSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new BudgetSettingTab(this.app, this));

		// Draws every ```budget-notes code block as the slider screen.
		this.registerMarkdownCodeBlockProcessor(BLOCK_LANGUAGE, (source, el, ctx) => {
			renderBudgetBlock(this.app, source, el, ctx, parseYaml);
		});

		// Shows in the command palette as "Budget Notes: New budget".
		this.addCommand({
			id: 'new-budget',
			name: 'New budget',
			callback: () => this.openNewBudget(),
		});

		// Piggy-bank button in the left ribbon (on phones: in the ribbon menu).
		this.addRibbonIcon('piggy-bank', 'New budget', () => this.openNewBudget());

		// Wait until the vault has finished loading before checking folders.
		this.app.workspace.onLayoutReady(() => {
			void ensureFolder(this.app, this.settings.budgetFolder);
		});
	}

	/** Opens the "New budget" window. */
	openNewBudget(): void {
		new NewBudgetModal(this.app, () => this.settings.budgetFolder).open();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<BudgetPlannerSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

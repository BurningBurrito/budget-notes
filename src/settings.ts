import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { folderProblem } from './folder';

export interface BudgetPlannerSettings {
	/** Folder (inside the vault) where budget notes are created. */
	budgetFolder: string;
}

export const DEFAULT_SETTINGS: BudgetPlannerSettings = {
	budgetFolder: 'Budget',
};

/**
 * The plugin's page in Settings. Uses Obsidian's declarative settings
 * (Obsidian 1.13.0 and later), which reads and saves `plugin.settings`.
 */
export class BudgetSettingTab extends PluginSettingTab {
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Budget folder',
				desc: 'Where new budget notes are created. The folder is created if it does not exist. Existing notes are never moved.',
				aliases: ['folder', 'location'],
				control: {
					type: 'folder',
					key: 'budgetFolder',
					defaultValue: DEFAULT_SETTINGS.budgetFolder,
					placeholder: DEFAULT_SETTINGS.budgetFolder,
					validate: (value: string) => folderProblem(this.app, value),
				},
			},
		];
	}
}

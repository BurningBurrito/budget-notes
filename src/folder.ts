import { App, Notice, TFolder, normalizePath } from 'obsidian';

/** Tidies a folder path typed by the user: trims spaces and fixes slashes. */
export function cleanFolderPath(raw: string): string {
	return normalizePath(raw.trim());
}

/**
 * Checks a budget folder path. Returns a short message explaining the
 * problem, or undefined when the path is fine. Never changes anything.
 */
export function folderProblem(app: App, raw: string): string | undefined {
	const path = cleanFolderPath(raw);
	if (path === '' || path === '/') {
		return 'Enter a folder, for example Budget.';
	}
	if (path.split('/').some((part) => part.startsWith('.'))) {
		return 'Folders starting with a dot are hidden from Obsidian. Choose another folder.';
	}
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing && !(existing instanceof TFolder)) {
		return 'A file with this name already exists. Choose a folder.';
	}
	return undefined;
}

/**
 * Makes sure the budget folder exists, creating any missing parent folders.
 * Only ever creates folders: it never renames, overwrites or deletes anything.
 * Returns true when the folder exists afterwards.
 */
export async function ensureFolder(app: App, raw: string): Promise<boolean> {
	const problem = folderProblem(app, raw);
	if (problem) {
		new Notice(`Budget folder setting: ${problem}`);
		return false;
	}
	let current = '';
	for (const part of cleanFolderPath(raw).split('/')) {
		current = current ? `${current}/${part}` : part;
		const existing = app.vault.getAbstractFileByPath(current);
		if (existing instanceof TFolder) {
			continue;
		}
		if (existing) {
			new Notice(`Budget folder: "${current}" is a file, not a folder. Nothing was changed.`);
			return false;
		}
		try {
			await app.vault.createFolder(current);
		} catch (error) {
			new Notice(`Budget folder: could not create "${current}". ${String(error)}`);
			return false;
		}
	}
	return true;
}

import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, ButtonComponent } from 'obsidian';
import * as child_process from 'child_process';

// Remember to rename these classes and interfaces!

interface GitSyncPluginSettings {
	gitRepoPath: string;
	syncButtonLocation: 'ribbon' | 'statusBar';
	autoSync: boolean;
	autoSyncInterval: number; // 以分钟为单位
	syncOnBlur: boolean;
}

const DEFAULT_SETTINGS: GitSyncPluginSettings = {
	gitRepoPath: '',
	syncButtonLocation: 'ribbon',
	autoSync: false,
	autoSyncInterval: 30,
	syncOnBlur: false
}

export default class GitSyncPlugin extends Plugin {
	settings: GitSyncPluginSettings;
	statusBarItem: HTMLElement;
	ribbonIconEl: HTMLElement;
	autoSyncIntervalId: number;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new GitSyncSettingTab(this.app, this));

		this.addSyncButton();

		// 添加命令
		this.addCommand({
			id: 'git-sync',
			name: '执行Git同步',
			callback: () => this.syncGit(),
		});

		this.setupAutoSync();

		if (this.settings.syncOnBlur) {
			window.addEventListener('blur', this.onBlur.bind(this));
		}
	}

	onunload() {
		if (this.autoSyncIntervalId) {
			window.clearInterval(this.autoSyncIntervalId);
		}
		window.removeEventListener('blur', this.onBlur.bind(this));
	}

	setupAutoSync() {
		if (this.autoSyncIntervalId) {
			window.clearInterval(this.autoSyncIntervalId);
		}
		if (this.settings.autoSync) {
			this.autoSyncIntervalId = window.setInterval(() => {
				this.syncGit(true);
			}, this.settings.autoSyncInterval * 60 * 1000);
		}
	}

	onBlur() {
		if (this.settings.syncOnBlur) {
			this.syncGit(true);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.setupAutoSync();
	}

	addSyncButton() {
		if (this.settings.syncButtonLocation === 'ribbon') {
			this.ribbonIconEl = this.addRibbonIcon('sync', 'Git同步', (evt: MouseEvent) => {
				this.syncGit();
			});
		} else {
			this.statusBarItem = this.addStatusBarItem();
			this.statusBarItem.setText('Git同步');
			this.statusBarItem.onClickEvent(() => this.syncGit());
		}
	}

	async syncGit(silent: boolean = false) {
		if (!this.settings.gitRepoPath) {
			if (!silent) new Notice('请先在设置中配置Git仓库路径');
			return;
		}

		if (!silent) new Notice('开始检查更新...');

		try {
			const status = await this.execGitCommand('git status --porcelain');
			const hasLocalChanges = status.trim().length > 0;

			await this.execGitCommand('git fetch');
			const diffResult = await this.execGitCommand('git diff HEAD origin/master --name-only');
			const hasRemoteChanges = diffResult.trim().length > 0;

			if (!hasLocalChanges && !hasRemoteChanges) {
				if (!silent) new Notice('无需同步，本地与远程均无更新');
				return;
			}

			if (!silent) new Notice('开始同步...');

			if (hasLocalChanges) {
				const now = new Date();
				const formattedDate = now.getFullYear() + '-' + 
									  String(now.getMonth() + 1).padStart(2, '0') + '-' + 
									  String(now.getDate()).padStart(2, '0') + ' ' + 
									  String(now.getHours()).padStart(2, '0') + ':' + 
									  String(now.getMinutes()).padStart(2, '0') + ':' + 
									  String(now.getSeconds()).padStart(2, '0');
				
				await this.execGitCommand('git add .');
				await this.execGitCommand(`git commit -m "Auto-sync: ${formattedDate}"`);
			}

			if (hasRemoteChanges) {
				await this.execGitCommand('git pull');
			}

			if (hasLocalChanges) {
				await this.execGitCommand('git push');
			}

			if (!silent) {
				if (!hasLocalChanges && hasRemoteChanges) {
					new Notice('本地无更新，已从远程拉取更新');
				} else if (hasLocalChanges) {
					new Notice('本地更新已同步至远程');
				}
			}
		} catch (error) {
			if (!silent) new Notice('同步失败: ' + error);
		}
	}

	async execGitCommand(command: string): Promise<string> {
		return new Promise((resolve, reject) => {
			child_process.exec(command, { cwd: this.settings.gitRepoPath }, (error, stdout, stderr) => {
				if (error) {
					reject(error);
				} else {
					resolve(stdout);
				}
			});
		});
	}
}

class GitSyncSettingTab extends PluginSettingTab {
	plugin: GitSyncPlugin;

	constructor(app: App, plugin: GitSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Git仓库路径')
			.setDesc('设置Git仓库的本地路径')
			.addText(text => text
				.setPlaceholder('输入Git仓库路径')
				.setValue(this.plugin.settings.gitRepoPath)
				.onChange(async (value) => {
					this.plugin.settings.gitRepoPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('同步按钮位置')
			.setDesc('选择同步按钮显示的位置')
			.addDropdown(dropdown => dropdown
				.addOption('ribbon', '左侧功能区')
				.addOption('statusBar', '状态栏')
				.setValue(this.plugin.settings.syncButtonLocation)
				.onChange(async (value: 'ribbon' | 'statusBar') => {
					this.plugin.settings.syncButtonLocation = value;
					await this.plugin.saveSettings();
					this.plugin.ribbonIconEl?.remove();
					this.plugin.statusBarItem?.remove();
					this.plugin.addSyncButton();
				}));

		new Setting(containerEl)
			.setName('启用自动同步')
			.setDesc('定期自动执行同步')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoSync)
				.onChange(async (value) => {
					this.plugin.settings.autoSync = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('自动同步间隔')
			.setDesc('设置自动同步的时间间隔（分钟）')
			.addText(text => text
				.setPlaceholder('输入分钟数')
				.setValue(String(this.plugin.settings.autoSyncInterval))
				.onChange(async (value) => {
					const interval = parseInt(value);
					if (!isNaN(interval) && interval > 0) {
						this.plugin.settings.autoSyncInterval = interval;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('失去焦点时同步')
			.setDesc('当Obsidian窗口失去焦点时执行同步')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.syncOnBlur)
				.onChange(async (value) => {
					this.plugin.settings.syncOnBlur = value;
					await this.plugin.saveSettings();
					if (value) {
						window.addEventListener('blur', this.plugin.onBlur.bind(this.plugin));
					} else {
						window.removeEventListener('blur', this.plugin.onBlur.bind(this.plugin));
					}
				}));
	}
}

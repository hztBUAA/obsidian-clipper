import { handleDragStart, handleDragOver, handleDrop, handleDragEnd } from '../utils/drag-and-drop';
import { initializeIcons } from '../icons/icons';
import { getCommands } from '../utils/hotkeys';
import { initializeToggles, updateToggleState, initializeSettingToggle } from '../utils/ui-utils';
import { generalSettings, loadSettings, saveSettings, setLocalStorage, getLocalStorage } from '../utils/storage-utils';
import { detectBrowser } from '../utils/browser-detection';
import { createElementWithClass, createElementWithHTML } from '../utils/dom-utils';
import { createDefaultTemplate, getTemplates, saveTemplateSettings } from '../managers/template-manager';
import { updateTemplateList, showTemplateEditor } from '../managers/template-ui';
import { exportAllSettings, importAllSettings } from '../utils/import-export';
import { Template } from '../types/types';
import { exportHighlights } from './highlights-manager';
import { getMessage, setupLanguageAndDirection } from '../utils/i18n';
import { debounce } from '../utils/debounce';
import browser from '../utils/browser-polyfill';
import { createUsageChart, aggregateUsageData } from '../utils/charts';
import { getClipHistory } from '../utils/storage-utils';
import dayjs from 'dayjs';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { showModal, hideModal } from '../utils/modal-utils';
import {
	getVaultDirectoryStatus,
	isVaultDirectoryLinkingSupported,
	linkVaultDirectory,
	unlinkVaultDirectory
} from '../utils/vault-directory';

dayjs.extend(weekOfYear);

const STORE_URLS = {
	chrome: 'https://chromewebstore.google.com/detail/obsidian-web-clipper/cnjifjpddelmedmihgijeibhnjfabmlf',
	firefox: 'https://addons.mozilla.org/en-US/firefox/addon/web-clipper-obsidian/',
	safari: 'https://apps.apple.com/us/app/obsidian-web-clipper/id6720708363',
	edge: 'https://microsoftedge.microsoft.com/addons/detail/obsidian-web-clipper/eigdjhmgnaaeaonimdklocfekkaanfme'
};

async function refreshVaultFolderStatus(
	vault: string,
	statusEl: HTMLElement,
	linkBtn: HTMLButtonElement,
	unlinkBtn: HTMLButtonElement
): Promise<void> {
	if (!isVaultDirectoryLinkingSupported()) {
		statusEl.textContent = getMessage('vaultFolderLinkUnsupported');
		linkBtn.disabled = true;
		unlinkBtn.disabled = true;
		return;
	}

	const status = await getVaultDirectoryStatus(vault);
	if (status.linked) {
		statusEl.textContent = getMessage('vaultFolderLinked', status.name || '');
		linkBtn.disabled = false;
		unlinkBtn.disabled = false;
	} else {
		statusEl.textContent = getMessage('vaultFolderNotLinked');
		linkBtn.disabled = false;
		unlinkBtn.disabled = true;
	}
}

export async function updateVaultList(): Promise<void> {
	const vaultList = document.getElementById('vault-list') as HTMLUListElement;
	if (!vaultList) return;

	// Clear existing vaults
	vaultList.textContent = '';
	generalSettings.vaults.forEach((vault, index) => {
		const li = document.createElement('li');
		li.dataset.index = index.toString();
		li.draggable = true;

		const dragHandle = createElementWithClass('div', 'drag-handle');
		dragHandle.appendChild(createElementWithHTML('i', '', { 'data-lucide': 'grip-vertical' }));
		li.appendChild(dragHandle);

		const span = document.createElement('span');
		span.textContent = vault;
		li.appendChild(span);

		const folderStatus = createElementWithClass('span', 'vault-folder-status');
		folderStatus.textContent = getMessage('vaultFolderNotLinked');
		li.appendChild(folderStatus);

		const linkBtn = createElementWithClass('button', 'setting-item-list-link') as HTMLButtonElement;
		linkBtn.setAttribute('type', 'button');
		linkBtn.textContent = getMessage('linkVaultFolder');
		li.appendChild(linkBtn);

		const unlinkBtn = createElementWithClass('button', 'setting-item-list-link') as HTMLButtonElement;
		unlinkBtn.setAttribute('type', 'button');
		unlinkBtn.textContent = getMessage('unlinkVaultFolder');
		li.appendChild(unlinkBtn);

		const removeBtn = createElementWithClass('button', 'setting-item-list-remove clickable-icon');
		removeBtn.setAttribute('type', 'button');
		removeBtn.setAttribute('aria-label', getMessage('removeVault'));
		removeBtn.appendChild(createElementWithHTML('i', '', { 'data-lucide': 'trash-2' }));
		li.appendChild(removeBtn);

		li.addEventListener('dragstart', handleDragStart);
		li.addEventListener('dragover', handleDragOver);
		li.addEventListener('drop', handleDrop);
		li.addEventListener('dragend', handleDragEnd);
		removeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			removeVault(index);
		});
		linkBtn.addEventListener('click', async (e) => {
			e.stopPropagation();
			const linked = await linkVaultDirectory(vault);
			if (!linked) {
				console.warn(`Failed to link vault folder for ${vault}`);
			}
			await refreshVaultFolderStatus(vault, folderStatus, linkBtn, unlinkBtn);
		});
		unlinkBtn.addEventListener('click', async (e) => {
			e.stopPropagation();
			await unlinkVaultDirectory(vault);
			await refreshVaultFolderStatus(vault, folderStatus, linkBtn, unlinkBtn);
		});
		vaultList.appendChild(li);

		refreshVaultFolderStatus(vault, folderStatus, linkBtn, unlinkBtn).catch((error) => {
			console.warn('Failed to refresh vault folder status:', error);
		});
	});

	initializeIcons(vaultList);
}

export function addVault(vault: string): void {
	generalSettings.vaults.push(vault);
	saveSettings();
	updateVaultList();
}

export function removeVault(index: number): void {
	generalSettings.vaults.splice(index, 1);
	saveSettings();
	updateVaultList();
}

export async function setShortcutInstructions() {
	const shortcutInstructionsElement = document.querySelector('.shortcut-instructions');
	if (shortcutInstructionsElement) {
		const browser = await detectBrowser();
		// Clear content
		shortcutInstructionsElement.textContent = '';
		shortcutInstructionsElement.appendChild(document.createTextNode(getMessage('shortcutInstructionsIntro') + ' '));
		
		// Browser-specific instructions
		let instructionsText = '';
		let url = '';
		
		switch (browser) {
			case 'chrome':
				instructionsText = getMessage('shortcutInstructionsChrome', ['$URL']);
				url = 'chrome://extensions/shortcuts';
				break;
			case 'brave':
				instructionsText = getMessage('shortcutInstructionsBrave', ['$URL']);
				url = 'brave://extensions/shortcuts';
				break;
			case 'firefox':
				instructionsText = getMessage('shortcutInstructionsFirefox', ['$URL']);
				url = 'about:addons';
				break;
			case 'edge':
				instructionsText = getMessage('shortcutInstructionsEdge', ['$URL']);
				url = 'edge://extensions/shortcuts';
				break;
			case 'safari':
			case 'mobile-safari':
				instructionsText = getMessage('shortcutInstructionsSafari');
				break;
			default:
				instructionsText = getMessage('shortcutInstructionsDefault');
		}
		
		if (url) {
			// Split text around the URL placeholder and add strong element
			const parts = instructionsText.split('$URL');
			if (parts.length === 2) {
				shortcutInstructionsElement.appendChild(document.createTextNode(parts[0]));
				
				const strongElement = document.createElement('strong');
				strongElement.textContent = url;
				shortcutInstructionsElement.appendChild(strongElement);
				
				shortcutInstructionsElement.appendChild(document.createTextNode(parts[1]));
			} else {
				// Fallback if no placeholder found
				shortcutInstructionsElement.appendChild(document.createTextNode(instructionsText));
			}
		} else {
			// Safari and default cases (no URL needed)
			shortcutInstructionsElement.appendChild(document.createTextNode(instructionsText));
		}
	}
}

async function initializeVersionDisplay(): Promise<void> {
	const manifest = browser.runtime.getManifest();
	const versionNumber = document.getElementById('version-number');
	const updateAvailable = document.getElementById('update-available');
	const usingLatestVersion = document.getElementById('using-latest-version');

	if (versionNumber) {
		versionNumber.textContent = manifest.version;
	}

	// Only add update listener for browsers that support it
	const currentBrowser = await detectBrowser();
	if (currentBrowser !== 'safari' && currentBrowser !== 'mobile-safari' && browser.runtime.onUpdateAvailable) {
		browser.runtime.onUpdateAvailable.addListener((details) => {
			if (updateAvailable && usingLatestVersion) {
				updateAvailable.style.display = 'block';
				usingLatestVersion.style.display = 'none';
			}
		});
	} else {
		// For Safari, just hide the update status elements
		if (updateAvailable) {
			updateAvailable.style.display = 'none';
		}
		if (usingLatestVersion) {
			usingLatestVersion.style.display = 'none';
		}
	}
}

export function initializeGeneralSettings(): void {
	loadSettings().then(async () => {
		await setupLanguageAndDirection();

		// Add version check initialization
		await initializeVersionDisplay();

		// Get clip history and ratings
		const history = await getClipHistory();
		const totalClips = history.length;
		const existingRatings = await getLocalStorage('ratings') || [];

		// Show rating section only total clips >= 20 and no previous ratings
		const rateExtensionSection = document.getElementById('rate-extension');
		if (rateExtensionSection && totalClips >= 20 && existingRatings.length === 0) {
			rateExtensionSection.classList.remove('is-hidden');
		}

		if (totalClips >= 20 && existingRatings.length === 0) {
			const starRating = document.querySelector('.star-rating');
			if (starRating) {
				const stars = starRating.querySelectorAll('.star');
				stars.forEach(star => {
					star.addEventListener('click', async () => {
						const rating = parseInt(star.getAttribute('data-rating') || '0');
						stars.forEach(s => {
							if (parseInt(s.getAttribute('data-rating') || '0') <= rating) {
								s.classList.add('is-active');
							} else {
								s.classList.remove('is-active');
							}
						});
						await handleRating(rating);
						
						// Hide the rating section after rating
						if (rateExtensionSection) {
							rateExtensionSection.style.display = 'none';
						}
					});
				});
			}
		}

		updateVaultList();
		initializeShowMoreActionsToggle();
		initializeBetaFeaturesToggle();
		initializeLegacyModeToggle();
		initializeSilentOpenToggle();
		initializeDownloadImagesLocallyToggle();
		initializeLocalMediaPathInput();
		initializeOcrSettingsUI();
		initializeVaultInput();
		initializeOpenBehaviorDropdown();
		initializeKeyboardShortcuts();
		initializeToggles();
		setShortcutInstructions();
		initializeAutoSave();
		initializeResetDefaultTemplateButton();
		initializeExportImportAllSettingsButtons();
		initializeHighlighterSettings();
		initializeExportHighlightsButton();
		initializeSaveBehaviorDropdown();
		await initializeUsageChart();

		// Initialize feedback modal close button
		const feedbackModal = document.getElementById('feedback-modal');
		const feedbackCloseBtn = feedbackModal?.querySelector('.feedback-close-btn');
		if (feedbackCloseBtn) {
			feedbackCloseBtn.addEventListener('click', () => hideModal(feedbackModal));
		}
	});
}

function initializeAutoSave(): void {
	const generalSettingsForm = document.getElementById('general-settings-form');
	if (generalSettingsForm) {
		// Listen for both input and change events
		generalSettingsForm.addEventListener('input', debounce(saveSettingsFromForm, 500));
		generalSettingsForm.addEventListener('change', debounce(saveSettingsFromForm, 500));
	}
}

function saveSettingsFromForm(): void {
	const openBehaviorDropdown = document.getElementById('open-behavior-dropdown') as HTMLSelectElement;
	const showMoreActionsToggle = document.getElementById('show-more-actions-toggle') as HTMLInputElement;
	const betaFeaturesToggle = document.getElementById('beta-features-toggle') as HTMLInputElement;
	const legacyModeToggle = document.getElementById('legacy-mode-toggle') as HTMLInputElement;
	const silentOpenToggle = document.getElementById('silent-open-toggle') as HTMLInputElement;
	const downloadImagesLocallyToggle = document.getElementById('download-images-locally-toggle') as HTMLInputElement;
	const localMediaPathInput = document.getElementById('local-media-path-input') as HTMLInputElement;
	const ocrEnabledToggle = document.getElementById('ocr-enabled-toggle') as HTMLInputElement;
	const ocrProviderSelect = document.getElementById('ocr-provider-select') as HTMLSelectElement;
	const ocrCloudModelSelect = document.getElementById('ocr-cloud-model-select') as HTMLSelectElement;
	const ocrLocalEndpointInput = document.getElementById('ocr-local-endpoint-input') as HTMLInputElement;
	const ocrLocalModelInput = document.getElementById('ocr-local-model-input') as HTMLInputElement;
	const ocrApplyScopeSelect = document.getElementById('ocr-apply-scope-select') as HTMLSelectElement;
	const ocrOutputFormatSelect = document.getElementById('ocr-output-format-select') as HTMLSelectElement;
	const ocrMaxImagesInput = document.getElementById('ocr-max-images-input') as HTMLInputElement;
	const ocrTimeoutInput = document.getElementById('ocr-timeout-input') as HTMLInputElement;
	const ocrLanguageHintsInput = document.getElementById('ocr-language-hints-input') as HTMLInputElement;
	const highlighterToggle = document.getElementById('highlighter-toggle') as HTMLInputElement;
	const alwaysShowHighlightsToggle = document.getElementById('highlighter-visibility') as HTMLInputElement;
	const highlightBehaviorSelect = document.getElementById('highlighter-behavior') as HTMLSelectElement;

	const parseNumberInRange = (value: string, fallback: number, min: number, max: number): number => {
		const parsed = Number.parseInt(value, 10);
		if (!Number.isFinite(parsed)) return fallback;
		return Math.min(max, Math.max(min, parsed));
	};

	const updatedSettings = {
		...generalSettings, // Keep existing settings
		openBehavior: (openBehaviorDropdown?.value as 'popup' | 'embedded') ?? generalSettings.openBehavior,
		showMoreActionsButton: showMoreActionsToggle?.checked ?? generalSettings.showMoreActionsButton,
		betaFeatures: betaFeaturesToggle?.checked ?? generalSettings.betaFeatures,
		legacyMode: legacyModeToggle?.checked ?? generalSettings.legacyMode,
		silentOpen: silentOpenToggle?.checked ?? generalSettings.silentOpen,
		downloadImagesLocally: downloadImagesLocallyToggle?.checked ?? generalSettings.downloadImagesLocally,
		localMediaPath: localMediaPathInput?.value?.trim() || 'media',
		ocrSettings: {
			...generalSettings.ocrSettings,
			enabled: ocrEnabledToggle?.checked ?? generalSettings.ocrSettings.enabled,
			provider: (ocrProviderSelect?.value as 'cloud' | 'local') ?? generalSettings.ocrSettings.provider,
			cloudModelId: ocrCloudModelSelect?.value ?? generalSettings.ocrSettings.cloudModelId,
			localEndpoint: ocrLocalEndpointInput?.value?.trim() || generalSettings.ocrSettings.localEndpoint,
			localModel: ocrLocalModelInput?.value?.trim() || generalSettings.ocrSettings.localModel,
			applyScope: (ocrApplyScopeSelect?.value as 'all-images' | 'only-local-images') ?? generalSettings.ocrSettings.applyScope,
			outputFormat: (ocrOutputFormatSelect?.value as 'markdown-link' | 'wikilink') ?? generalSettings.ocrSettings.outputFormat,
			maxImagesPerNote: parseNumberInRange(ocrMaxImagesInput?.value, generalSettings.ocrSettings.maxImagesPerNote, 1, 20),
			timeoutMs: parseNumberInRange(ocrTimeoutInput?.value, generalSettings.ocrSettings.timeoutMs, 2000, 120000),
			languageHints: ocrLanguageHintsInput?.value?.trim() || '',
		},
		highlighterEnabled: highlighterToggle?.checked ?? generalSettings.highlighterEnabled,
		alwaysShowHighlights: alwaysShowHighlightsToggle?.checked ?? generalSettings.alwaysShowHighlights,
		highlightBehavior: highlightBehaviorSelect?.value ?? generalSettings.highlightBehavior
	};

	saveSettings(updatedSettings);
}

function initializeShowMoreActionsToggle(): void {
	initializeSettingToggle('show-more-actions-toggle', generalSettings.showMoreActionsButton, (checked) => {
		saveSettings({ ...generalSettings, showMoreActionsButton: checked });
	});
}

function initializeVaultInput(): void {
	const vaultInput = document.getElementById('vault-input') as HTMLInputElement;
	if (vaultInput) {
		vaultInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				const newVault = vaultInput.value.trim();
				if (newVault) {
					addVault(newVault);
					vaultInput.value = '';
				}
			}
		});
	}
}

async function initializeKeyboardShortcuts(): Promise<void> {
	const shortcutsList = document.getElementById('keyboard-shortcuts-list');
	if (!shortcutsList) return;

	const browser = await detectBrowser();

	if (browser === 'mobile-safari') {
		// For Safari, display a message about keyboard shortcuts not being available
		const messageItem = document.createElement('div');
		messageItem.className = 'shortcut-item';
		messageItem.textContent = getMessage('shortcutInstructionsSafari');
		shortcutsList.appendChild(messageItem);
	} else {
		// For other browsers, proceed with displaying the shortcuts
		getCommands().then(commands => {
			commands.forEach(command => {
				const shortcutItem = createElementWithClass('div', 'shortcut-item');
				
				const descriptionSpan = document.createElement('span');
				descriptionSpan.textContent = command.description;
				shortcutItem.appendChild(descriptionSpan);

				const hotkeySpan = createElementWithClass('span', 'setting-hotkey');
				hotkeySpan.textContent = command.shortcut || getMessage('shortcutNotSet');
				shortcutItem.appendChild(hotkeySpan);

				shortcutsList.appendChild(shortcutItem);
			});
		});
	}
}

function initializeBetaFeaturesToggle(): void {
	initializeSettingToggle('beta-features-toggle', generalSettings.betaFeatures, (checked) => {
		saveSettings({ ...generalSettings, betaFeatures: checked });
	});
}

function initializeLegacyModeToggle(): void {
	initializeSettingToggle('legacy-mode-toggle', generalSettings.legacyMode, (checked) => {
		saveSettings({ ...generalSettings, legacyMode: checked });
	});
}

function initializeSilentOpenToggle(): void {
	initializeSettingToggle('silent-open-toggle', generalSettings.silentOpen, (checked) => {
		saveSettings({ ...generalSettings, silentOpen: checked });
	});
}

function initializeDownloadImagesLocallyToggle(): void {
	initializeSettingToggle('download-images-locally-toggle', generalSettings.downloadImagesLocally, (checked) => {
		saveSettings({ ...generalSettings, downloadImagesLocally: checked });
	});
}

function initializeLocalMediaPathInput(): void {
	const input = document.getElementById('local-media-path-input') as HTMLInputElement;
	if (!input) return;
	input.value = generalSettings.localMediaPath || 'media';
	input.addEventListener('change', () => {
		saveSettings({ ...generalSettings, localMediaPath: input.value.trim() || 'media' });
	});
}

function updateOcrProviderVisibility(): void {
	const providerSelect = document.getElementById('ocr-provider-select') as HTMLSelectElement | null;
	const cloudContainer = document.getElementById('ocr-cloud-model-container');
	const localContainer = document.getElementById('ocr-local-config-container');
	if (!providerSelect || !cloudContainer || !localContainer) return;

	const isCloud = providerSelect.value === 'cloud';
	cloudContainer.style.display = isCloud ? 'flex' : 'none';
	localContainer.style.display = isCloud ? 'none' : 'block';
}

function initializeOcrCloudModelSelect(): void {
	const modelSelect = document.getElementById('ocr-cloud-model-select') as HTMLSelectElement | null;
	if (!modelSelect) return;

	const enabledModels = generalSettings.models.filter((model) => model.enabled);
	modelSelect.textContent = '';

	const emptyOption = document.createElement('option');
	emptyOption.value = '';
	emptyOption.textContent = getMessage('selectModel');
	modelSelect.appendChild(emptyOption);

	for (const model of enabledModels) {
		const option = document.createElement('option');
		option.value = model.id;
		option.textContent = model.name;
		modelSelect.appendChild(option);
	}

	modelSelect.value = generalSettings.ocrSettings.cloudModelId || generalSettings.interpreterModel || '';
}

function initializeOcrSettingsUI(): void {
	const enabledToggle = document.getElementById('ocr-enabled-toggle') as HTMLInputElement | null;
	const providerSelect = document.getElementById('ocr-provider-select') as HTMLSelectElement | null;
	const localEndpointInput = document.getElementById('ocr-local-endpoint-input') as HTMLInputElement | null;
	const localModelInput = document.getElementById('ocr-local-model-input') as HTMLInputElement | null;
	const applyScopeSelect = document.getElementById('ocr-apply-scope-select') as HTMLSelectElement | null;
	const outputFormatSelect = document.getElementById('ocr-output-format-select') as HTMLSelectElement | null;
	const maxImagesInput = document.getElementById('ocr-max-images-input') as HTMLInputElement | null;
	const timeoutInput = document.getElementById('ocr-timeout-input') as HTMLInputElement | null;
	const languageHintsInput = document.getElementById('ocr-language-hints-input') as HTMLInputElement | null;

	if (enabledToggle) enabledToggle.checked = generalSettings.ocrSettings.enabled;
	if (providerSelect) providerSelect.value = generalSettings.ocrSettings.provider;
	if (localEndpointInput) localEndpointInput.value = generalSettings.ocrSettings.localEndpoint;
	if (localModelInput) localModelInput.value = generalSettings.ocrSettings.localModel;
	if (applyScopeSelect) applyScopeSelect.value = generalSettings.ocrSettings.applyScope;
	if (outputFormatSelect) outputFormatSelect.value = generalSettings.ocrSettings.outputFormat;
	if (maxImagesInput) maxImagesInput.value = String(generalSettings.ocrSettings.maxImagesPerNote);
	if (timeoutInput) timeoutInput.value = String(generalSettings.ocrSettings.timeoutMs);
	if (languageHintsInput) languageHintsInput.value = generalSettings.ocrSettings.languageHints || '';

	initializeOcrCloudModelSelect();
	updateOcrProviderVisibility();

	if (providerSelect) {
		providerSelect.addEventListener('change', () => {
			updateOcrProviderVisibility();
		});
	}
}

function initializeOpenBehaviorDropdown(): void {
	initializeSettingDropdown(
		'open-behavior-dropdown',
		generalSettings.openBehavior,
		(value) => {
			saveSettings({ ...generalSettings, openBehavior: value as 'popup' | 'embedded' });
		}
	);
}

function initializeResetDefaultTemplateButton(): void {
	const resetDefaultTemplateBtn = document.getElementById('reset-default-template-btn');
	if (resetDefaultTemplateBtn) {
		resetDefaultTemplateBtn.addEventListener('click', resetDefaultTemplate);
	}
}

function initializeSaveBehaviorDropdown(): void {
    const dropdown = document.getElementById('save-behavior-dropdown') as HTMLSelectElement;
    if (!dropdown) return;

    dropdown.value = generalSettings.saveBehavior;
    dropdown.addEventListener('change', () => {
        const newValue = dropdown.value as 'addToObsidian' | 'copyToClipboard' | 'saveFile';
        saveSettings({ saveBehavior: newValue });
    });
}

export function resetDefaultTemplate(): void {
	const defaultTemplate = createDefaultTemplate();
	const currentTemplates = getTemplates();
	const defaultIndex = currentTemplates.findIndex((t: Template) => t.name === getMessage('defaultTemplateName'));
	
	if (defaultIndex !== -1) {
		currentTemplates[defaultIndex] = defaultTemplate;
	} else {
		currentTemplates.unshift(defaultTemplate);
	}

	saveTemplateSettings().then(() => {
		updateTemplateList();
		showTemplateEditor(defaultTemplate);
	}).catch(error => {
		console.error('Failed to reset default template:', error);
		alert(getMessage('failedToResetTemplate'));
	});
}

function initializeExportImportAllSettingsButtons(): void {
	const exportAllSettingsBtn = document.getElementById('export-all-settings-btn');
	if (exportAllSettingsBtn) {
		exportAllSettingsBtn.addEventListener('click', exportAllSettings);
	}

	const importAllSettingsBtn = document.getElementById('import-all-settings-btn');
	if (importAllSettingsBtn) {
		importAllSettingsBtn.addEventListener('click', importAllSettings);
	}
}

function initializeExportHighlightsButton(): void {
	const exportHighlightsBtn = document.getElementById('export-highlights');
	if (exportHighlightsBtn) {
		exportHighlightsBtn.addEventListener('click', exportHighlights);
	}
}

function initializeHighlighterSettings(): void {
	initializeSettingToggle('highlighter-toggle', generalSettings.highlighterEnabled, (checked) => {
		saveSettings({ ...generalSettings, highlighterEnabled: checked });
	});

	initializeSettingToggle('highlighter-visibility', generalSettings.alwaysShowHighlights, (checked) => {
		saveSettings({ ...generalSettings, alwaysShowHighlights: checked });
	});

	const highlightBehaviorSelect = document.getElementById('highlighter-behavior') as HTMLSelectElement;
	if (highlightBehaviorSelect) {
		highlightBehaviorSelect.value = generalSettings.highlightBehavior;
		highlightBehaviorSelect.addEventListener('change', () => {
			saveSettings({ ...generalSettings, highlightBehavior: highlightBehaviorSelect.value });
		});
	}
}

async function initializeUsageChart(): Promise<void> {
	const chartContainer = document.getElementById('usage-chart');
	const periodSelect = document.getElementById('usage-period-select') as HTMLSelectElement;
	const aggregationSelect = document.getElementById('usage-aggregation-select') as HTMLSelectElement;
	if (!chartContainer || !periodSelect || !aggregationSelect) return;

	const history = await getClipHistory();

	const updateChart = async () => {
		const options = {
			timeRange: periodSelect.value as '30d' | 'all',
			aggregation: aggregationSelect.value as 'day' | 'week' | 'month'
		};
		
		const chartData = aggregateUsageData(history, options);
		await createUsageChart(chartContainer, chartData);
	};

	// Initialize with default selections
	await updateChart();

	// Update when any selector changes
	periodSelect.addEventListener('change', updateChart);
	aggregationSelect.addEventListener('change', updateChart);
}

async function handleRating(rating: number) {
	// Get existing ratings from storage
	const existingRatings = await getLocalStorage('ratings') || [];
	
	// Add new rating
	const newRating = {
		rating,
		date: new Date().toISOString()
	};
	
	// Update both storage and generalSettings
	const updatedRatings = [...existingRatings, newRating];
	generalSettings.ratings = updatedRatings;
	
	// Save to storage
	await setLocalStorage('ratings', updatedRatings);
	await saveSettings();

	if (rating >= 4) {
		// Redirect to appropriate store
		const browser = await detectBrowser();
		let storeUrl = STORE_URLS.chrome; // Default to Chrome store

		switch (browser) {
			case 'firefox':
			case 'firefox-mobile':
				storeUrl = STORE_URLS.firefox;
				break;
			case 'safari':
			case 'mobile-safari':
			case 'ipad-os':
				storeUrl = STORE_URLS.safari;
				break;
			case 'edge':
				storeUrl = STORE_URLS.edge;
				break;
		}

		window.open(storeUrl, '_blank');
	} else {
		// Show feedback modal for ratings < 4
		const modal = document.getElementById('feedback-modal');
		showModal(modal);
	}
}

function initializeSettingDropdown(
	elementId: string,
	defaultValue: string,
	onChange: (newValue: string) => void
): void {
	const dropdown = document.getElementById(elementId) as HTMLSelectElement;
	if (!dropdown) return;
	dropdown.value = defaultValue;
	dropdown.addEventListener('change', () => {
		onChange(dropdown.value);
	});
}

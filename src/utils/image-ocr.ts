import { ModelConfig } from '../types/types';
import { generalSettings } from './storage-utils';
import { normalizeVaultPath } from './local-media';
import { readBlobFromVaultPath } from './vault-directory';

const MARKDOWN_IMAGE_REGEX = /!\[[^\]]*\]\((<)?([^)>]+)(>)?\)/gi;
const HTML_IMAGE_REGEX = /<img\b[^>]*\bsrc=(['"])([^'"]+)\1[^>]*>/gi;
const OCR_SECTION_TITLE = '图转文字';

interface ImageReference {
	original: string;
	normalized: string;
	isRemote: boolean;
	localVaultPath?: string;
}

interface OcrRuntimeContext {
	vault: string;
	notePath: string;
	isDailyNote: boolean;
}

interface OcrExecutionResult {
	content: string;
	processedCount: number;
	skippedCount: number;
	warning?: string;
}

function isRemoteImageLink(link: string): boolean {
	return /^https?:\/\//i.test(link);
}

function stripAngleBrackets(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function normalizeImageLink(link: string): string {
	return stripAngleBrackets(link).replace(/\\/g, '/').trim();
}

function resolveRelativeVaultPath(baseFolder: string, relativePath: string): string {
	const normalizedBase = normalizeVaultPath(baseFolder);
	const normalizedRelative = relativePath.replace(/^\.\//, '').trim();
	const base = normalizedBase ? `/${normalizedBase}/` : '/';
	const resolvedPath = new URL(normalizedRelative, `https://clipper.local${base}`).pathname;
	return normalizeVaultPath(resolvedPath);
}

function resolveVaultImagePath(link: string, notePath: string, isDailyNote: boolean): string | null {
	if (isRemoteImageLink(link)) {
		return null;
	}

	const cleaned = normalizeImageLink(link).replace(/[?#].*$/, '');
	if (!cleaned) {
		return null;
	}

	if (cleaned.startsWith('/')) {
		return normalizeVaultPath(cleaned);
	}

	if (isDailyNote && !normalizeVaultPath(notePath)) {
		return null;
	}

	return resolveRelativeVaultPath(notePath, cleaned);
}

function extractImageReferences(content: string, context: OcrRuntimeContext): ImageReference[] {
	const links: ImageReference[] = [];

	for (const match of content.matchAll(MARKDOWN_IMAGE_REGEX)) {
		const raw = match[2] || '';
		const normalized = normalizeImageLink(raw);
		if (!normalized) continue;
		links.push({
			original: normalized,
			normalized,
			isRemote: isRemoteImageLink(normalized),
			localVaultPath: resolveVaultImagePath(normalized, context.notePath, context.isDailyNote) || undefined,
		});
	}

	for (const match of content.matchAll(HTML_IMAGE_REGEX)) {
		const raw = match[2] || '';
		const normalized = normalizeImageLink(raw);
		if (!normalized) continue;
		links.push({
			original: normalized,
			normalized,
			isRemote: isRemoteImageLink(normalized),
			localVaultPath: resolveVaultImagePath(normalized, context.notePath, context.isDailyNote) || undefined,
		});
	}

	const deduplicated = new Map<string, ImageReference>();
	for (const item of links) {
		if (!deduplicated.has(item.normalized)) {
			deduplicated.set(item.normalized, item);
		}
	}
	return Array.from(deduplicated.values());
}

function formatOcrLine(imageRef: ImageReference, text: string): string {
	const cleanedText = text.trim().replace(/\r/g, '').replace(/\n{3,}/g, '\n\n');
	const format = generalSettings.ocrSettings.outputFormat;

	if (format === 'wikilink' && imageRef.localVaultPath) {
		return `${OCR_SECTION_TITLE} [[${imageRef.localVaultPath}]]: ${cleanedText}`;
	}

	const encoded = imageRef.original.replace(/ /g, '%20');
	return `${OCR_SECTION_TITLE} [image-link](${encoded}): ${cleanedText}`;
}

function buildPrompt(languageHints: string): string {
	const hint = languageHints.trim();
	const suffix = hint ? ` Language hints: ${hint}.` : '';
	return `Extract all readable text from this image. Return plain text only, no markdown and no explanation.${suffix}`;
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => {
			const result = reader.result;
			if (typeof result !== 'string') {
				reject(new Error('Failed to convert blob to base64'));
				return;
			}
			const base64 = result.includes(',') ? result.split(',')[1] : result;
			resolve(base64);
		};
		reader.onerror = () => reject(reader.error || new Error('Blob reader failed'));
		reader.readAsDataURL(blob);
	});
}

async function fetchBlobWithTimeout(url: string, timeoutMs: number): Promise<Blob | null> {
	const controller = new AbortController();
	const timer = window.setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) {
			return null;
		}
		return await response.blob();
	} catch (error) {
		console.warn(`Failed to fetch image for OCR: ${url}`, error);
		return null;
	} finally {
		clearTimeout(timer);
	}
}

async function loadImageBlob(ref: ImageReference, context: OcrRuntimeContext): Promise<Blob | null> {
	if (ref.isRemote) {
		return fetchBlobWithTimeout(ref.normalized, generalSettings.ocrSettings.timeoutMs);
	}

	if (!ref.localVaultPath || !context.vault) {
		return null;
	}

	return readBlobFromVaultPath(context.vault, ref.localVaultPath);
}

function parseOpenAIResponse(data: any): string {
	const content = data?.choices?.[0]?.message?.content;
	if (typeof content === 'string') {
		return content.trim();
	}
	if (Array.isArray(content)) {
		const text = content
			.filter((item) => item?.type === 'text' && typeof item?.text === 'string')
			.map((item) => item.text)
			.join('\n')
			.trim();
		return text;
	}
	return '';
}

function getCloudOcrModel(): ModelConfig | null {
	const configuredId = generalSettings.ocrSettings.cloudModelId || generalSettings.interpreterModel || '';
	if (!configuredId) {
		return null;
	}
	return generalSettings.models.find((model) => model.id === configuredId) || null;
}

async function requestCloudOcr(base64Image: string): Promise<string> {
	const model = getCloudOcrModel();
	if (!model) {
		throw new Error('Cloud OCR model is not configured.');
	}

	const provider = generalSettings.providers.find((item) => item.id === model.providerId);
	if (!provider) {
		throw new Error(`Provider not found for OCR model ${model.name}.`);
	}

	if (provider.apiKeyRequired && !provider.apiKey) {
		throw new Error(`API key is not set for OCR provider ${provider.name}.`);
	}

	const lowerName = provider.name.toLowerCase();
	if (lowerName.includes('anthropic') || lowerName.includes('ollama') || lowerName.includes('hugging') || lowerName.includes('perplexity')) {
		throw new Error(`Provider ${provider.name} is not supported by cloud OCR V1. Use OpenAI-compatible providers or Local OCR mode.`);
	}

	const headers: HeadersInit = {
		'Content-Type': 'application/json',
	};

	if (provider.baseUrl.includes('openai.azure.com')) {
		headers['api-key'] = provider.apiKey;
	} else {
		headers['Authorization'] = `Bearer ${provider.apiKey}`;
		headers['HTTP-Referer'] = 'https://obsidian.md/';
		headers['X-Title'] = 'Obsidian Web Clipper';
	}

	const body = {
		model: model.providerModelId,
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: buildPrompt(generalSettings.ocrSettings.languageHints) },
					{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
				],
			},
		],
		max_tokens: 1200,
		temperature: 0,
	};

	const controller = new AbortController();
	const timer = window.setTimeout(() => controller.abort(), generalSettings.ocrSettings.timeoutMs);
	try {
		const response = await fetch(provider.baseUrl, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Cloud OCR request failed: ${response.status} ${text}`);
		}
		const data = await response.json();
		return parseOpenAIResponse(data);
	} finally {
		clearTimeout(timer);
	}
}

async function requestLocalOcr(base64Image: string): Promise<string> {
	const endpoint = generalSettings.ocrSettings.localEndpoint.trim();
	const model = generalSettings.ocrSettings.localModel.trim();
	if (!endpoint || !model) {
		throw new Error('Local OCR endpoint and model are required.');
	}

	const controller = new AbortController();
	const timer = window.setTimeout(() => controller.abort(), generalSettings.ocrSettings.timeoutMs);
	try {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model,
				prompt: buildPrompt(generalSettings.ocrSettings.languageHints),
				images: [base64Image],
				stream: false,
			}),
			signal: controller.signal,
		});
		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Local OCR request failed: ${response.status} ${text}`);
		}
		const data = await response.json();
		if (typeof data?.response === 'string') {
			return data.response.trim();
		}
		if (typeof data?.message?.content === 'string') {
			return data.message.content.trim();
		}
		return '';
	} finally {
		clearTimeout(timer);
	}
}

async function requestImageOcr(base64Image: string): Promise<string> {
	if (generalSettings.ocrSettings.provider === 'local') {
		return requestLocalOcr(base64Image);
	}
	return requestCloudOcr(base64Image);
}

function appendOcrSection(content: string, lines: string[]): string {
	const trimmed = content.replace(/\s+$/g, '');
	const section = [`## ${OCR_SECTION_TITLE}`, ...lines].join('\n\n');
	return `${trimmed}\n\n${section}\n`;
}

function shouldProcessRef(ref: ImageReference): boolean {
	if (generalSettings.ocrSettings.applyScope === 'only-local-images') {
		return !ref.isRemote;
	}
	return true;
}

export async function appendImageOcrToMarkdown(content: string, context: OcrRuntimeContext): Promise<OcrExecutionResult> {
	if (!generalSettings.ocrSettings.enabled) {
		return { content, processedCount: 0, skippedCount: 0 };
	}

	const references = extractImageReferences(content, context).filter(shouldProcessRef);
	if (references.length === 0) {
		return { content, processedCount: 0, skippedCount: 0 };
	}

	const limitedRefs = references.slice(0, generalSettings.ocrSettings.maxImagesPerNote);
	const lines: string[] = [];
	let processedCount = 0;
	let skippedCount = 0;

	for (const ref of limitedRefs) {
		const blob = await loadImageBlob(ref, context);
		if (!blob) {
			skippedCount += 1;
			continue;
		}

		try {
			const base64 = await blobToBase64(blob);
			const text = await requestImageOcr(base64);
			if (!text) {
				skippedCount += 1;
				continue;
			}
			lines.push(formatOcrLine(ref, text));
			processedCount += 1;
		} catch (error) {
			console.warn(`OCR failed for image: ${ref.normalized}`, error);
			skippedCount += 1;
		}
	}

	if (lines.length === 0) {
		return {
			content,
			processedCount,
			skippedCount,
			warning: 'Image OCR enabled but no image text was extracted.',
		};
	}

	return {
		content: appendOcrSection(content, lines),
		processedCount,
		skippedCount,
	};
}

export const __testables__ = {
	isRemoteImageLink,
	normalizeImageLink,
	resolveVaultImagePath,
	extractImageReferences,
	formatOcrLine,
	appendOcrSection,
};

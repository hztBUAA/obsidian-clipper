import { writeBlobToVaultPath } from './vault-directory';

export interface LocalMediaOptions {
	enabled: boolean;
	vault: string;
	notePath: string;
	noteName: string;
	mediaPath: string;
	isDailyNote?: boolean;
}

export interface LocalMediaResult {
	content: string;
	downloadedCount: number;
	skippedCount: number;
	warning?: string;
}

interface ImageMatch {
	url: string;
}

const MARKDOWN_IMAGE_REGEX = /!\[[^\]]*\]\((<)?(https?:\/\/[^)\s>]+)(>)?\)/gi;
const HTML_IMAGE_REGEX = /<img\b[^>]*\bsrc=(['"])(https?:\/\/[^'"]+)\1[^>]*>/gi;

export function normalizeVaultPath(path: string): string {
	const normalized = (path || '')
		.trim()
		.replace(/\\/g, '/')
		.replace(/\/{2,}/g, '/');
	if (!normalized || /^\/+$/g.test(normalized)) {
		return '';
	}
	return normalized.replace(/^\/+|\/+$/g, '');
}

function splitPath(path: string): string[] {
	return normalizeVaultPath(path).split('/').filter(Boolean);
}

function joinPaths(...parts: string[]): string {
	return normalizeVaultPath(parts.filter(Boolean).join('/'));
}

function getRelativePath(fromFolder: string, toFolder: string): string {
	const fromParts = splitPath(fromFolder);
	const toParts = splitPath(toFolder);

	let shared = 0;
	while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) {
		shared += 1;
	}

	const up = Array(Math.max(fromParts.length - shared, 0)).fill('..');
	const down = toParts.slice(shared);
	const relative = [...up, ...down];
	return relative.length > 0 ? relative.join('/') : '.';
}

function sanitizeFileBaseName(value: string): string {
	const sanitized = (value || '')
		.replace(/[^a-zA-Z0-9\u4e00-\u9fa5\s-_]/g, '')
		.trim()
		.replace(/\s+/g, '-')
		.substring(0, 64);
	return sanitized || 'image';
}

function guessExtension(url: string, contentType?: string): string {
	const normalizedType = (contentType || '').toLowerCase();
	if (normalizedType.includes('image/png')) return '.png';
	if (normalizedType.includes('image/webp')) return '.webp';
	if (normalizedType.includes('image/gif')) return '.gif';
	if (normalizedType.includes('image/svg')) return '.svg';
	if (normalizedType.includes('image/avif')) return '.avif';
	if (normalizedType.includes('image/jpeg') || normalizedType.includes('image/jpg')) return '.jpg';

	try {
		const pathname = new URL(url).pathname;
		const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
		if (match?.[1]) {
			const ext = match[1].toLowerCase();
			if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) {
				return ext === 'jpeg' ? '.jpg' : `.${ext}`;
			}
		}
	} catch {
		// Ignore parse failures.
	}

	return '.jpg';
}

function extractImageMatches(content: string): ImageMatch[] {
	const matches: ImageMatch[] = [];

	for (const match of content.matchAll(MARKDOWN_IMAGE_REGEX)) {
		if (match[2]) {
			matches.push({ url: match[2] });
		}
	}

	for (const match of content.matchAll(HTML_IMAGE_REGEX)) {
		if (match[2]) {
			matches.push({ url: match[2] });
		}
	}

	return matches;
}

function applyImageUrlReplacements(content: string, replacements: Map<string, string>): string {
	let updated = content;

	updated = updated.replace(MARKDOWN_IMAGE_REGEX, (full, open, url, close) => {
		const replacement = replacements.get(url);
		if (!replacement) {
			return full;
		}
		const wrapped = /[\s()<>]/.test(replacement) ? `<${replacement}>` : replacement;
		const hasAngle = Boolean(open || close);
		if (hasAngle && wrapped.startsWith('<') && wrapped.endsWith('>')) {
			return full.replace(`${open || ''}${url}${close || ''}`, wrapped);
		}
		return full.replace(`${open || ''}${url}${close || ''}`, wrapped);
	});

	updated = updated.replace(HTML_IMAGE_REGEX, (full, quote, url) => {
		const replacement = replacements.get(url);
		if (!replacement) {
			return full;
		}
		return full.replace(`${quote}${url}${quote}`, `${quote}${replacement}${quote}`);
	});

	return updated;
}

function resolveMediaFolder(notePath: string, configuredMediaPath: string): { mediaFolder: string; relativePrefix: string } {
	const trimmedMediaPath = (configuredMediaPath || '').trim();
	const normalizedNotePath = normalizeVaultPath(notePath);

	let mediaFolder = '';
	if (trimmedMediaPath.startsWith('/')) {
		mediaFolder = normalizeVaultPath(trimmedMediaPath);
	} else {
		const safeMediaPath = normalizeVaultPath(trimmedMediaPath || 'media');
		mediaFolder = joinPaths(normalizedNotePath, safeMediaPath);
	}

	const relativePrefix = getRelativePath(normalizedNotePath, mediaFolder);
	return {
		mediaFolder,
		relativePrefix: relativePrefix === '.' ? '' : relativePrefix,
	};
}

async function fetchImageBlob(url: string): Promise<Blob | null> {
	try {
		const response = await fetch(url);
		if (!response.ok) {
			return null;
		}
		return await response.blob();
	} catch (error) {
		console.warn(`Failed to fetch image: ${url}`, error);
		return null;
	}
}

export async function localizeMarkdownImagesToVault(
	content: string,
	options: LocalMediaOptions
): Promise<LocalMediaResult> {
	if (!options.enabled) {
		return {
			content,
			downloadedCount: 0,
			skippedCount: 0,
		};
	}

	if (!options.vault) {
		return {
			content,
			downloadedCount: 0,
			skippedCount: 0,
			warning: 'No vault selected for local media download.',
		};
	}

	const imageMatches = extractImageMatches(content);
	if (imageMatches.length === 0) {
		return {
			content,
			downloadedCount: 0,
			skippedCount: 0,
		};
	}

	const isDailyNoteWithoutPath = Boolean(options.isDailyNote) && !normalizeVaultPath(options.notePath);
	if (isDailyNoteWithoutPath && !options.mediaPath.startsWith('/')) {
		return {
			content,
			downloadedCount: 0,
			skippedCount: imageMatches.length,
			warning: 'Daily note path is unresolved. Use an absolute media path (starts with /) to enable local media download.',
		};
	}

	const uniqueUrls = Array.from(new Set(imageMatches.map((item) => item.url)));
	const { mediaFolder, relativePrefix } = resolveMediaFolder(options.notePath, options.mediaPath || 'media');
	const noteBaseName = sanitizeFileBaseName(options.noteName || 'image');

	let downloadedCount = 0;
	let skippedCount = 0;
	const replacements = new Map<string, string>();

	for (let i = 0; i < uniqueUrls.length; i++) {
		const url = uniqueUrls[i];
		const blob = await fetchImageBlob(url);
		if (!blob) {
			skippedCount += 1;
			continue;
		}

		const extension = guessExtension(url, blob.type);
		const savedFilename = await writeBlobToVaultPath(
			options.vault,
			mediaFolder,
			`${noteBaseName}-${i + 1}`,
			extension,
			blob,
		);

		if (!savedFilename) {
			skippedCount += 1;
			continue;
		}

		const relativePath = normalizeVaultPath(joinPaths(relativePrefix, savedFilename));
		replacements.set(url, relativePath);
		downloadedCount += 1;
	}

	if (replacements.size === 0) {
		return {
			content,
			downloadedCount,
			skippedCount,
			warning: 'No images were downloaded to local media path.',
		};
	}

	return {
		content: applyImageUrlReplacements(content, replacements),
		downloadedCount,
		skippedCount,
	};
}

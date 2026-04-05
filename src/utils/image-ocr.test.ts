import { describe, test, expect, beforeEach } from 'vitest';
import { appendImageOcrToMarkdown, __testables__ } from './image-ocr';
import { generalSettings } from './storage-utils';

describe('image-ocr utils', () => {
	const originalOcrSettings = JSON.parse(JSON.stringify(generalSettings.ocrSettings));

	beforeEach(() => {
		generalSettings.ocrSettings = JSON.parse(JSON.stringify(originalOcrSettings));
	});

	test('resolves vault image paths for relative and absolute links', () => {
		expect(__testables__.resolveVaultImagePath('media/pic.jpg', 'Clippings', false)).toBe('Clippings/media/pic.jpg');
		expect(__testables__.resolveVaultImagePath('/assets/pic.jpg', 'Clippings', false)).toBe('assets/pic.jpg');
		expect(__testables__.resolveVaultImagePath('https://cdn.example.com/a.jpg', 'Clippings', false)).toBeNull();
	});

	test('returns null for unresolved daily note relative paths', () => {
		expect(__testables__.resolveVaultImagePath('media/pic.jpg', '', true)).toBeNull();
	});

	test('extracts and deduplicates markdown/html image references', () => {
		const content = [
			'![cover](https://cdn.example.com/a.jpg)',
			'![local](media/a.jpg)',
			'<img src="https://cdn.example.com/a.jpg" alt="duplicate" />',
		].join('\n');

		const refs = __testables__.extractImageReferences(content, {
			vault: 'Main',
			notePath: 'Clippings',
			isDailyNote: false,
		});

		expect(refs).toHaveLength(2);
		expect(refs.map((ref) => ref.normalized)).toEqual([
			'https://cdn.example.com/a.jpg',
			'media/a.jpg',
		]);
		expect(refs[1].localVaultPath).toBe('Clippings/media/a.jpg');
	});

	test('formats OCR line with markdown link output', () => {
		generalSettings.ocrSettings.outputFormat = 'markdown-link';
		const line = __testables__.formatOcrLine(
			{ original: 'https://cdn.example.com/a image.jpg', normalized: 'https://cdn.example.com/a image.jpg', isRemote: true },
			'hello world',
		);
		expect(line).toBe('图转文字 [image-link](https://cdn.example.com/a%20image.jpg): hello world');
	});

	test('formats OCR line with wikilink output for local images', () => {
		generalSettings.ocrSettings.outputFormat = 'wikilink';
		const line = __testables__.formatOcrLine(
			{
				original: 'media/a.jpg',
				normalized: 'media/a.jpg',
				isRemote: false,
				localVaultPath: 'Clippings/media/a.jpg',
			},
			'line1\n\nline2',
		);
		expect(line).toBe('图转文字 [[Clippings/media/a.jpg]]: line1\n\nline2');
	});

	test('returns unchanged content when OCR disabled', async () => {
		generalSettings.ocrSettings.enabled = false;
		const input = 'Plain markdown';
		const result = await appendImageOcrToMarkdown(input, {
			vault: 'Main',
			notePath: 'Clippings',
			isDailyNote: false,
		});

		expect(result.content).toBe(input);
		expect(result.processedCount).toBe(0);
		expect(result.skippedCount).toBe(0);
	});
});

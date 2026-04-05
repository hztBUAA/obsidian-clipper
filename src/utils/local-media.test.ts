import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { localizeMarkdownImagesToVault, normalizeVaultPath } from './local-media';
import { writeBlobToVaultPath } from './vault-directory';

vi.mock('./vault-directory', () => ({
	writeBlobToVaultPath: vi.fn(),
}));

describe('local-media', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test('normalizeVaultPath handles slashes and root', () => {
		expect(normalizeVaultPath('  /Clippings//media/  ')).toBe('Clippings/media');
		expect(normalizeVaultPath('/')).toBe('');
		expect(normalizeVaultPath('')).toBe('');
	});

	test('returns unchanged content when local media download is disabled', async () => {
		const content = '![img](https://example.com/a.jpg)';
		const result = await localizeMarkdownImagesToVault(content, {
			enabled: false,
			vault: 'Main',
			notePath: 'Clippings',
			noteName: 'Test Note',
			mediaPath: 'media',
		});

		expect(result.content).toBe(content);
		expect(result.downloadedCount).toBe(0);
		expect(result.skippedCount).toBe(0);
	});

	test('downloads images and rewrites markdown/html urls to relative media paths', async () => {
		const mockedWriter = vi.mocked(writeBlobToVaultPath);
		mockedWriter.mockImplementation(async (_vault, _folder, baseName, extension) => `${baseName}${extension}`);

		vi.stubGlobal('fetch', vi.fn(async () => ({
			ok: true,
			blob: async () => new Blob(['binary'], { type: 'image/jpeg' }),
		} as Response)));

		const content = [
			'![cover](https://cdn.example.com/a.jpg)',
			'<img src="https://cdn.example.com/b.png" alt="b" />',
		].join('\n');

		const result = await localizeMarkdownImagesToVault(content, {
			enabled: true,
			vault: 'Main',
			notePath: 'Clippings',
			noteName: 'My Note',
			mediaPath: 'media',
		});

		expect(result.downloadedCount).toBe(2);
		expect(result.skippedCount).toBe(0);
		expect(result.content).toContain('![cover](media/My-Note-1.jpg)');
		expect(result.content).toContain('<img src="media/My-Note-2.jpg" alt="b" />');
		expect(mockedWriter).toHaveBeenCalledTimes(2);
	});

	test('uses vault-root media path and computes relative references', async () => {
		const mockedWriter = vi.mocked(writeBlobToVaultPath);
		mockedWriter.mockResolvedValue('clip-1.jpg');

		vi.stubGlobal('fetch', vi.fn(async () => ({
			ok: true,
			blob: async () => new Blob(['binary'], { type: 'image/jpeg' }),
		} as Response)));

		const content = '![img](https://example.com/a.jpg)';
		const result = await localizeMarkdownImagesToVault(content, {
			enabled: true,
			vault: 'Main',
			notePath: 'Clippings/sub',
			noteName: 'My Note',
			mediaPath: '/assets/media',
		});

		expect(result.content).toContain('![img](../../assets/media/clip-1.jpg)');
	});

	test('returns warning for unresolved daily note path with relative media path', async () => {
		const content = '![img](https://example.com/a.jpg)';
		const result = await localizeMarkdownImagesToVault(content, {
			enabled: true,
			vault: 'Main',
			notePath: '',
			noteName: 'Daily',
			mediaPath: 'media',
			isDailyNote: true,
		});

		expect(result.warning).toContain('Daily note path is unresolved');
		expect(result.content).toBe(content);
		expect(result.downloadedCount).toBe(0);
	});
});

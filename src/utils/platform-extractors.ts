interface WechatArticleData {
	title: string;
	description: string;
	account: string;
	wechatId: string;
	alias: string;
	author: string;
	publishedAt: string;
	publishedTs: number;
	cover: string;
	type: string;
	contentHtml: string;
	images: string[];
}

interface XhsNoteData {
	title: string;
	content: string;
	images: string[];
	videoUrl: string | null;
	isVideo: boolean;
	tags: string[];
	cover: string;
}

export interface PlatformExtractionResult {
	platform: 'wechat' | 'xiaohongshu';
	contentHtml?: string;
	title?: string;
	author?: string;
	description?: string;
	image?: string;
	published?: string;
	site?: string;
	variables: Record<string, string>;
}

export function extractPlatformData(url: string, html: string): PlatformExtractionResult | null {
	const lower = `${url}\n${html.slice(0, 20000)}`.toLowerCase();

	if (lower.includes('mp.weixin.qq.com') || lower.includes('#js_content')) {
		return extractWechatData(url, html);
	}

	if (lower.includes('xiaohongshu.com') || lower.includes('xhslink.com') || lower.includes('__initial_state__')) {
		return extractXhsData(url, html);
	}

	return null;
}

function extractWechatData(_url: string, html: string): PlatformExtractionResult {
	if (isWechatVerificationPage(html)) {
		return {
			platform: 'wechat',
			variables: {
				platform: 'wechat',
				platform_error: 'WeChat verification page detected',
			},
		};
	}

	const article = extractWechatArticle(html);
	const contentHtml = article.contentHtml || '';
	const variables: Record<string, string> = {
		platform: 'wechat',
		wechat_account: article.account,
		wechat_id: article.wechatId,
		wechat_alias: article.alias,
		wechat_author: article.author,
		wechat_published_at: article.publishedAt,
		wechat_published_ts: String(article.publishedTs || 0),
		wechat_cover: article.cover,
		wechat_type: article.type,
		wechat_images: JSON.stringify(article.images),
	};

	return {
		platform: 'wechat',
		contentHtml: contentHtml || undefined,
		title: article.title || undefined,
		author: article.author || undefined,
		description: article.description || undefined,
		image: article.cover || undefined,
		published: article.publishedAt || undefined,
		site: article.account ? `WeChat · ${article.account}` : 'WeChat',
		variables,
	};
}

function extractXhsData(url: string, html: string): PlatformExtractionResult {
	if (isXhsUnavailablePage(html)) {
		return {
			platform: 'xiaohongshu',
			variables: {
				platform: 'xiaohongshu',
				platform_error: 'Xiaohongshu page unavailable',
			},
		};
	}

	const resolvedUrl = resolveXhsUrlFromPage(url, html);
	const note = extractXhsNoteData(html);
	const contentHtml = buildXhsContentHtml(note);
	const warning = /xhslink\.com/i.test(url)
		? 'Short-link page detected, open the final note URL for full extraction.'
		: '';

	const variables: Record<string, string> = {
		platform: 'xiaohongshu',
		xhs_source_url: resolvedUrl,
		xhs_type: note.isVideo ? 'video' : 'note',
		xhs_is_video: String(note.isVideo),
		xhs_video_url: note.videoUrl || '',
		xhs_tags: JSON.stringify(note.tags),
		xhs_images: JSON.stringify(note.images),
		xhs_cover: note.cover,
	};
	if (warning) {
		variables.platform_warning = warning;
	}

	return {
		platform: 'xiaohongshu',
		contentHtml: contentHtml || undefined,
		title: note.title || undefined,
		description: note.content || undefined,
		image: note.cover || undefined,
		site: 'Xiaohongshu',
		variables,
	};
}

function isWechatVerificationPage(html: string): boolean {
	return /环境异常|去验证|secitptpage\/template\/verify|TCaptcha|wappoc_appmsgcaptcha/i.test(html);
}

function isXhsUnavailablePage(html: string): boolean {
	return /<title>\s*小红书\s*-\s*你访问的页面不见了\s*<\/title>/i.test(html);
}

function extractWechatArticle(html: string): WechatArticleData {
	const cgiSegment = extractCgiDataSegment(html);

	const title =
		pickFirst([
			decodeJsDecodeValue(extractJsDecodeProp(cgiSegment, 'title')),
			decodeJsEscapedString(extractVarSingleQuoted(html, 'msg_title', '\\.html\\(false\\)')),
			extractMetaContent(html, 'property', 'og:title'),
			extractTitleTag(html),
		]) || '';

	const description =
		pickFirst([
			decodeJsDecodeValue(extractJsDecodeProp(cgiSegment, 'desc')),
			decodeJsEscapedString(extractVarHtmlDecodeDoubleQuoted(html, 'msg_desc')),
			extractMetaContent(html, 'name', 'description'),
		]) || '';

	const account =
		pickFirst([
			decodeJsDecodeValue(extractJsDecodeProp(cgiSegment, 'nick_name')),
			decodeJsEscapedString(extractVarHtmlDecodeDoubleQuoted(html, 'nickname')),
		]) || '';

	const wechatId =
		pickFirst([
			decodeJsDecodeValue(extractJsDecodeProp(cgiSegment, 'user_name')),
			decodeJsEscapedString(extractVarDoubleQuoted(html, 'user_name')),
		]) || '';

	const alias =
		pickFirst([
			decodeJsDecodeValue(extractJsDecodeProp(cgiSegment, 'alias')),
			decodeJsEscapedString(extractWindowDoubleQuoted(html, 'alias')),
		]) || '';

	const author =
		pickFirst([
			decodeJsDecodeValue(extractJsDecodeProp(cgiSegment, 'author')),
			decodeJsEscapedString(extractVarDoubleQuoted(html, 'author')),
		]) || '';

	const publishedAtRaw =
		pickFirst([
			decodeJsDecodeValue(extractJsDecodeProp(cgiSegment, 'create_time')),
			decodeJsDecodeValue(extractJsDecodeProp(cgiSegment, 'ori_create_time')),
		]) || '';

	const publishedTs = pickNumber([
		extractNumericProp(cgiSegment, 'ori_create_time'),
		extractNumericVar(html, 'ct'),
		extractNumericVar(html, 'create_time'),
	]);
	const publishedAt = publishedAtRaw || (publishedTs > 0 ? formatUnixTime(publishedTs) : '');

	const cover =
		pickFirst([
			decodeJsDecodeValue(extractJsDecodeProp(cgiSegment, 'cdn_url')),
			decodeJsEscapedString(extractVarDoubleQuoted(html, 'msg_cdn_url')),
			extractMetaContent(html, 'property', 'og:image'),
		]) || '';

	const type =
		pickFirst([
			extractNumericType(cgiSegment),
			decodeJsEscapedString(extractVarDoubleQuoted(html, 'appmsg_type')),
		]) || 'article';

	let contentHtml = extractContentHtmlFromJsContent(html);
	if (!contentHtml) {
		contentHtml = decodeJsDecodeValue(extractContentNoEncode(cgiSegment));
	}
	contentHtml = cleanWechatContentHtml(contentHtml);

	const images = extractImageUrls(contentHtml, cover);

	return {
		title: normalizeWhitespace(title),
		description: normalizeWhitespace(description),
		account: normalizeWhitespace(account),
		wechatId: normalizeWhitespace(wechatId),
		alias: normalizeWhitespace(alias),
		author: normalizeWhitespace(author),
		publishedAt: normalizeWhitespace(publishedAt),
		publishedTs,
		cover: normalizeMediaUrl(cover),
		type: normalizeWhitespace(type),
		contentHtml,
		images,
	};
}

function extractCgiDataSegment(html: string): string {
	const marker = 'window.cgiDataNew';
	const startIndex = html.indexOf(marker);
	if (startIndex < 0) {
		return html;
	}
	return html.slice(startIndex, startIndex + 650000);
}

function extractJsDecodeProp(text: string, prop: string): string {
	const escaped = escapeRegex(prop);
	const regex = new RegExp(`${escaped}\\s*:\\s*JsDecode\\('([\\s\\S]*?)'\\)`);
	return regex.exec(text)?.[1] ?? '';
}

function extractVarDoubleQuoted(text: string, variableName: string): string {
	const escaped = escapeRegex(variableName);
	const regex = new RegExp(`var\\s+${escaped}\\s*=\\s*"([\\s\\S]*?)"`);
	return regex.exec(text)?.[1] ?? '';
}

function extractWindowDoubleQuoted(text: string, variableName: string): string {
	const escaped = escapeRegex(variableName);
	const regex = new RegExp(`window\\.${escaped}\\s*=\\s*"([\\s\\S]*?)"`);
	return regex.exec(text)?.[1] ?? '';
}

function extractVarSingleQuoted(text: string, variableName: string, suffixPattern = ''): string {
	const escaped = escapeRegex(variableName);
	const regex = new RegExp(`var\\s+${escaped}\\s*=\\s*'([\\s\\S]*?)'${suffixPattern}`);
	return regex.exec(text)?.[1] ?? '';
}

function extractVarHtmlDecodeDoubleQuoted(text: string, variableName: string): string {
	const escaped = escapeRegex(variableName);
	const regex = new RegExp(`var\\s+${escaped}\\s*=\\s*htmlDecode\\("([\\s\\S]*?)"\\)`);
	return regex.exec(text)?.[1] ?? '';
}

function extractNumericVar(text: string, variableName: string): number {
	const escaped = escapeRegex(variableName);
	const regex = new RegExp(`var\\s+${escaped}\\s*=\\s*"?(\\d{8,13})"?`);
	return toNumber(regex.exec(text)?.[1] ?? '');
}

function extractNumericProp(text: string, propName: string): number {
	const escaped = escapeRegex(propName);
	const regex = new RegExp(`${escaped}\\s*:\\s*'?(\\d{8,13})'?\\s*\\*?\\s*1?`);
	return toNumber(regex.exec(text)?.[1] ?? '');
}

function extractNumericType(text: string): string {
	const regex = /type\s*:\s*'?(\d+)'?\s*\*\s*1/;
	return regex.exec(text)?.[1] ?? '';
}

function extractMetaContent(html: string, attrName: string, attrValue: string): string {
	const escaped = escapeRegex(attrValue);
	const regex = new RegExp(`<meta\\s+${attrName}=["']${escaped}["']\\s+content=["']([^"']*)["']`, 'i');
	return decodeHtmlEntities(regex.exec(html)?.[1] ?? '');
}

function extractTitleTag(html: string): string {
	const match = html.match(/<title>([\s\S]*?)<\/title>/i);
	if (!match?.[1]) {
		return '';
	}
	return decodeHtmlEntities(match[1]).replace(/\s*-\s*微信公众平台\s*$/, '').trim();
}

function extractContentNoEncode(segment: string): string {
	const match = segment.match(/content_noencode\s*:\s*JsDecode\('([\s\S]*?)'\),\s*create_time\s*:/);
	return match?.[1] ?? '';
}

function extractContentHtmlFromJsContent(html: string): string {
	const match = html.match(/<div[^>]*id=["']js_content["'][^>]*>([\s\S]*?)<\/div>/i);
	return match?.[1] ?? '';
}

function cleanWechatContentHtml(contentHtml: string): string {
	if (!contentHtml) {
		return '';
	}
	let cleaned = contentHtml;
	cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
	cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');
	cleaned = cleaned.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
	cleaned = cleaned.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
	cleaned = cleaned.replace(/<mp-style-type[\s\S]*?<\/mp-style-type>/gi, '');
	return cleaned;
}

function extractImageUrls(contentHtml: string, coverUrl: string): string[] {
	const urls = new Set<string>();
	const cover = normalizeMediaUrl(coverUrl);
	if (cover) {
		urls.add(cover);
	}
	const pattern = /<img\b[^>]*?(?:data-src|src)=['"]([^'"]+)['"][^>]*>/gi;
	let match = pattern.exec(contentHtml);
	while (match) {
		const normalized = normalizeMediaUrl(match[1]);
		if (normalized) {
			urls.add(normalized);
		}
		match = pattern.exec(contentHtml);
	}
	return Array.from(urls);
}

function resolveXhsUrlFromPage(url: string, html: string): string {
	const normalized = normalizeArticleUrl(url);
	if (!/xhslink\.com/i.test(normalized)) {
		return normalizeXhsUrl(normalized);
	}
	const extracted = extractXhsUrlFromHtml(html);
	return extracted || normalized;
}

function normalizeXhsUrl(url: string): string {
	const normalized = normalizeArticleUrl(url);
	try {
		const parsed = new URL(normalized);
		if (!/xiaohongshu\.com$/i.test(parsed.hostname)) {
			return normalized;
		}
		const match = parsed.pathname.match(/\/(?:explore|discovery\/item)\/([a-zA-Z0-9]+)/i);
		if (!match?.[1]) {
			const normalizedPath = parsed.pathname.replace('/explore/', '/discovery/item/');
			return `${parsed.origin}${normalizedPath}${parsed.search}`;
		}
		return `https://www.xiaohongshu.com/discovery/item/${match[1]}${parsed.search}`;
	} catch (_error) {
		return normalized.replace('/explore/', '/discovery/item/');
	}
}

function normalizeArticleUrl(url: string): string {
	let normalized = url.trim().replace(/&amp;/g, '&');
	normalized = normalized.replace(/[。！!）)\]】>,，,]+$/, '');
	normalized = normalized.replace(/#wechat_redirect$/, '');
	return normalized;
}

function extractXhsUrlFromHtml(html: string): string | null {
	const candidates: string[] = [];
	const addCandidate = (raw: string) => {
		if (!raw) {
			return;
		}
		const normalized = normalizeXhsUrl(decodeHtmlEntities(raw));
		if (!normalized || candidates.includes(normalized)) {
			return;
		}
		candidates.push(normalized);
	};

	const metaPatterns = [
		/<meta\b[^>]*\b(?:property|name)=["']og:url["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/gi,
		/<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\b(?:property|name)=["']og:url["'][^>]*>/gi,
	];
	for (const pattern of metaPatterns) {
		for (const match of html.matchAll(pattern)) {
			addCandidate(match[1] || '');
		}
	}

	const canonicalPatterns = [
		/<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi,
		/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']canonical["'][^>]*>/gi,
	];
	for (const pattern of canonicalPatterns) {
		for (const match of html.matchAll(pattern)) {
			addCandidate(match[1] || '');
		}
	}

	for (const match of html.matchAll(/https?:\/\/www\.xiaohongshu\.com\/(?:discovery\/item|explore)\/[a-zA-Z0-9]+(?:\?[^"'<>\\s]*)?/gi)) {
		addCandidate(match[0]);
	}

	const withToken = candidates.find(candidate => /[?&]xsec_token=/i.test(candidate));
	return withToken || candidates[0] || null;
}

function extractXhsNoteData(html: string): XhsNoteData {
	const title = (html.match(/<title>(.*?)<\/title>/)?.[1] || '').replace(' - 小红书', '').trim();
	const state = parseXhsState(html);
	const note = state ? getXhsNoteObject(state) : null;

	const images = extractXhsImages(note);
	const videoUrl = extractXhsVideoUrl(note);
	const isVideo = note?.type === 'video';
	const contentFromHtml = html.match(/<div id="detail-desc" class="desc">([\s\S]*?)<\/div>/)?.[1] || '';
	const content = extractXhsContent(note, contentFromHtml);
	const tags = extractXhsTags(content);

	return {
		title: title || 'Untitled Xiaohongshu Note',
		content: content.replace(/#[^#\s]*(?:\s+#[^#\s]*)*\s*/g, '').trim(),
		images,
		videoUrl,
		isVideo,
		tags,
		cover: images[0] || '',
	};
}

function parseXhsState(html: string): any | null {
	const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/i);
	if (!stateMatch?.[1]) {
		return null;
	}
	try {
		let jsonStr = stateMatch[1].trim().replace(/;\s*$/, '');
		const lastBrace = jsonStr.lastIndexOf('}');
		if (lastBrace >= 0) {
			jsonStr = jsonStr.slice(0, lastBrace + 1);
		}
		return JSON.parse(jsonStr.replace(/undefined/g, 'null').replace(/\bNaN\b/g, 'null'));
	} catch (_error) {
		return null;
	}
}

function getXhsNoteObject(state: any): any | null {
	try {
		const map = state?.note?.noteDetailMap;
		if (!map || typeof map !== 'object') {
			return null;
		}
		const noteId = Object.keys(map)[0];
		return map[noteId]?.note ?? null;
	} catch (_error) {
		return null;
	}
}

function extractXhsImages(note: any): string[] {
	const list = Array.isArray(note?.imageList) ? note.imageList : [];
	return list.map((img: any) => normalizeMediaUrl(img?.urlDefault || '')).filter((url: string) => !!url);
}

function extractXhsVideoUrl(note: any): string | null {
	const stream = note?.video?.media?.stream;
	const h264 = Array.isArray(stream?.h264) ? stream.h264 : [];
	const h265 = Array.isArray(stream?.h265) ? stream.h265 : [];
	const picked = h264[0]?.masterUrl || h265[0]?.masterUrl || '';
	const normalized = normalizeMediaUrl(picked);
	return normalized || null;
}

function extractXhsContent(note: any, contentFromHtml: string): string {
	const htmlText = contentFromHtml.replace(/<[^>]+>/g, '').replace(/\[话题\]/g, '').replace(/\[[^\]]+\]/g, '').trim();
	const desc = Array.isArray(note?.desc) ? note.desc.join('\n') : note?.desc || '';
	return decodeJsEscapedString(String(desc)).replace(/\r/g, '').trim() || htmlText;
}

function extractXhsTags(content: string): string[] {
	const matches = content.match(/#([^#\s]+)/g) || [];
	const unique = new Set(matches.map(tag => tag.replace(/^#/, '').trim()).filter(tag => !!tag));
	return Array.from(unique);
}

function buildXhsContentHtml(note: XhsNoteData): string {
	const parts: string[] = [];
	if (note.content) {
		parts.push(`<p>${escapeHtml(note.content)}</p>`);
	}
	if (note.videoUrl) {
		parts.push(`<p><a href="${escapeHtml(note.videoUrl)}">${escapeHtml(note.videoUrl)}</a></p>`);
	}
	for (const image of note.images) {
		parts.push(`<p><img src="${escapeHtml(image)}" alt="image" /></p>`);
	}
	return parts.join('\n');
}

function decodeJsDecodeValue(value: string): string {
	if (!value) {
		return '';
	}
	const decoded = value
		.replace(/\\x([0-9A-Fa-f]{2})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
		.replace(/\\u([0-9A-Fa-f]{4})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
		.replace(/\\r/g, '\r')
		.replace(/\\n/g, '\n')
		.replace(/\\t/g, '\t')
		.replace(/\\'/g, "'")
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, '\\');
	return decodeHtmlEntities(decoded);
}

function decodeJsEscapedString(value: string): string {
	if (!value) {
		return '';
	}
	return decodeHtmlEntities(
		value
			.replace(/\\'/g, "'")
			.replace(/\\"/g, '"')
			.replace(/\\n/g, '\n')
			.replace(/\\r/g, '\r')
			.replace(/\\t/g, '\t')
			.replace(/\\\\/g, '\\')
	);
}

function decodeHtmlEntities(value: string): string {
	if (!value) {
		return '';
	}
	const named: Record<string, string> = {
		amp: '&',
		lt: '<',
		gt: '>',
		quot: '"',
		apos: "'",
		nbsp: ' ',
	};
	return value.replace(/&(#x?[0-9A-Fa-f]+|[a-zA-Z]+);/g, (all, token: string) => {
		if (token.startsWith('#x') || token.startsWith('#X')) {
			const codePoint = parseInt(token.slice(2), 16);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : all;
		}
		if (token.startsWith('#')) {
			const codePoint = parseInt(token.slice(1), 10);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : all;
		}
		return named[token] ?? all;
	});
}

function normalizeMediaUrl(url: string): string {
	if (!url) {
		return '';
	}
	let normalized = decodeHtmlEntities(decodeJsEscapedString(url.trim()));
	normalized = normalized.replace(/\\x26amp;/gi, '&').replace(/&amp;/gi, '&');
	normalized = normalized.replace(/\u0026/gi, '&');
	normalized = normalized.replace(/^\/\//, 'https://');
	if (/^http:\/\//i.test(normalized)) {
		normalized = normalized.replace(/^http:\/\//i, 'https://');
	}
	if (/^https?:\/\//i.test(normalized)) {
		return normalized.trim();
	}
	return '';
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function formatUnixTime(unixSeconds: number): string {
	if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) {
		return '';
	}
	const date = new Date(unixSeconds * 1000);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hour = String(date.getHours()).padStart(2, '0');
	const minute = String(date.getMinutes()).padStart(2, '0');
	const second = String(date.getSeconds()).padStart(2, '0');
	return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function pickFirst(values: Array<string | null | undefined>): string {
	for (const value of values) {
		if (value && value.trim()) {
			return value.trim();
		}
	}
	return '';
}

function pickNumber(values: number[]): number {
	for (const value of values) {
		if (Number.isFinite(value) && value > 0) {
			return value;
		}
	}
	return 0;
}

function toNumber(value: string): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

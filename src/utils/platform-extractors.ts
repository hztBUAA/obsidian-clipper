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
	author: string;
	publishedAt: string;
	publishedTs: number;
	source: 'state' | 'fallback';
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
		const verificationMessage = 'WeChat verification page detected. Open the article directly after verification and retry clipping.';
		return {
			platform: 'wechat',
			title: extractTitleTag(html) || 'WeChat Verification Required',
			description: verificationMessage,
			contentHtml: `<p>${escapeHtml(verificationMessage)}</p>`,
			site: 'WeChat',
			variables: {
				platform: 'wechat',
				platform_extractor_mode: 'wechat_verification',
				platform_error: 'WeChat verification page detected',
			},
		};
	}

	const article = extractWechatArticle(html);
	const contentHtml = article.contentHtml || '';
	const variables: Record<string, string> = {
		platform: 'wechat',
		platform_extractor_mode: 'wechat_article',
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
	const resolvedUrl = resolveXhsUrlFromPage(url, html);
	if (isXhsUnavailablePage(html)) {
		const unavailableMessage = 'Xiaohongshu page unavailable. Open the final note URL and retry clipping.';
		const title = extractXhsTitle(html) || 'Xiaohongshu Page Unavailable';
		const linkPart = resolvedUrl ? `<p><a href="${escapeHtml(resolvedUrl)}">${escapeHtml(resolvedUrl)}</a></p>` : '';
		return {
			platform: 'xiaohongshu',
			title,
			description: unavailableMessage,
			contentHtml: `<p>${escapeHtml(unavailableMessage)}</p>${linkPart}`,
			site: 'Xiaohongshu',
			variables: {
				platform: 'xiaohongshu',
				platform_extractor_mode: 'xhs_unavailable',
				xhs_source_url: resolvedUrl,
				platform_error: 'Xiaohongshu page unavailable',
				platform_warning: 'Open the final note URL for full extraction.',
			},
		};
	}

	const note = extractXhsNoteData(html);
	let contentHtml = buildXhsContentHtml(note);
	if (!contentHtml && note.title) {
		contentHtml = `<p>${escapeHtml(note.title)}</p>`;
	}
	const warningParts: string[] = [];
	if (/xhslink\.com/i.test(url)) {
		warningParts.push('Short-link page detected, open the final note URL for full extraction.');
	}
	if (note.source === 'fallback') {
		warningParts.push('Structured note data missing, fallback extraction was used.');
	}

	const variables: Record<string, string> = {
		platform: 'xiaohongshu',
		platform_extractor_mode: note.source === 'state' ? 'xhs_state' : 'xhs_fallback',
		xhs_source_url: resolvedUrl,
		xhs_type: note.isVideo ? 'video' : 'note',
		xhs_author: note.author,
		xhs_published_at: note.publishedAt,
		xhs_published_ts: String(note.publishedTs || 0),
		xhs_is_video: String(note.isVideo),
		xhs_video_url: note.videoUrl || '',
		xhs_tags: JSON.stringify(note.tags),
		xhs_images: JSON.stringify(note.images),
		xhs_cover: note.cover,
	};
	if (warningParts.length > 0) {
		variables.platform_warning = warningParts.join(' ');
	}

	return {
		platform: 'xiaohongshu',
		contentHtml: contentHtml || undefined,
		title: note.title || undefined,
		author: note.author || undefined,
		description: note.content || undefined,
		image: note.cover || undefined,
		published: note.publishedAt || undefined,
		site: 'Xiaohongshu',
		variables,
	};
}

function isWechatVerificationPage(html: string): boolean {
	return /环境异常|去验证|secitptpage\/template\/verify|TCaptcha|wappoc_appmsgcaptcha/i.test(html);
}

function isXhsUnavailablePage(html: string): boolean {
	const title = extractXhsTitle(html);
	const titleIndicatesUnavailable = /你访问的页面不见了|页面不存在|note not found|页面异常|无法查看/i.test(title);
	const htmlIndicatesUnavailable = /error_code=\d+|当前笔记暂时无法浏览|你访问的页面不见了/i.test(html);
	const hasNoteStructure = /noteDetailMap|id=["']detail-desc["']|id=["']noteContainer["']/i.test(html);
	return (titleIndicatesUnavailable || htmlIndicatesUnavailable) && !hasNoteStructure;
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
	const regexA = new RegExp(`<meta\\b[^>]*\\b${attrName}=["']${escaped}["'][^>]*\\bcontent=["']([^"']*)["'][^>]*>`, 'i');
	const regexB = new RegExp(`<meta\\b[^>]*\\bcontent=["']([^"']*)["'][^>]*\\b${attrName}=["']${escaped}["'][^>]*>`, 'i');
	return decodeHtmlEntities(regexA.exec(html)?.[1] ?? regexB.exec(html)?.[1] ?? '');
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
	const htmlByStructure = extractDivInnerHtmlById(html, 'js_content');
	if (htmlByStructure) {
		return htmlByStructure;
	}
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
	cleaned = normalizeWechatImageElements(cleaned);
	return cleaned;
}

function extractDivInnerHtmlById(html: string, elementId: string): string {
	const escapedId = escapeRegex(elementId);
	const openTagRegex = new RegExp(`<div\\b[^>]*\\bid=["']${escapedId}["'][^>]*>`, 'i');
	const openMatch = openTagRegex.exec(html);
	if (!openMatch || openMatch.index < 0) {
		return '';
	}
	const contentStart = openMatch.index + openMatch[0].length;
	const tail = html.slice(contentStart);
	const tagRegex = /<\/?div\b[^>]*>/gi;
	let depth = 1;
	let match = tagRegex.exec(tail);
	while (match) {
		const tag = match[0];
		const isClose = /^<\s*\//.test(tag);
		const isSelfClosing = /\/\s*>$/.test(tag);
		if (isClose) {
			depth -= 1;
			if (depth === 0) {
				return tail.slice(0, match.index);
			}
		} else if (!isSelfClosing) {
			depth += 1;
		}
		match = tagRegex.exec(tail);
	}
	return '';
}

function normalizeWechatImageElements(contentHtml: string): string {
	return contentHtml.replace(/<img\b[^>]*>/gi, (imgTag) => {
		const attrs = parseHtmlAttributes(imgTag);
		const bestSrc =
			attrs['data-src'] ||
			attrs['data-original'] ||
			attrs['data-actualsrc'] ||
			attrs.src ||
			'';
		const normalizedSrc = normalizeMediaUrl(bestSrc);
		if (normalizedSrc) {
			attrs.src = normalizedSrc;
		}
		delete attrs['data-src'];
		delete attrs['data-original'];
		delete attrs['data-actualsrc'];
		return buildImgTag(attrs);
	});
}

function parseHtmlAttributes(tag: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const attrRegex = /([^\s"'<>\/=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
	let match = attrRegex.exec(tag);
	while (match) {
		const key = match[1].toLowerCase();
		const value = match[3] ?? match[4] ?? '';
		attrs[key] = decodeHtmlEntities(value);
		match = attrRegex.exec(tag);
	}
	return attrs;
}

function buildImgTag(attrs: Record<string, string>): string {
	const pieces: string[] = [];
	for (const [key, value] of Object.entries(attrs)) {
		if (value === '') {
			continue;
		}
		pieces.push(`${key}="${escapeHtmlAttribute(value)}"`);
	}
	return pieces.length > 0 ? `<img ${pieces.join(' ')} />` : '<img />';
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

	for (const match of html.matchAll(/https?:\/\/www\.xiaohongshu\.com\/(?:discovery\/item|explore)\/[a-zA-Z0-9]+(?:\?[^"'<>\s]*)?/gi)) {
		addCandidate(match[0]);
	}

	const withToken = candidates.find(candidate => /[?&]xsec_token=/i.test(candidate));
	if (withToken) {
		return withToken;
	}

	const fallbackNoteId = extractXhsNoteIdFromUrl(candidates[0] || '');
	const tokenizedFromState = buildTokenizedXhsUrlFromState(html, fallbackNoteId);
	if (tokenizedFromState) {
		return tokenizedFromState;
	}

	return candidates[0] || null;
}

function buildTokenizedXhsUrlFromState(html: string, noteIdHint = ''): string | null {
	const state = parseXhsState(html);
	if (state) {
		try {
			const map = state?.note?.noteDetailMap;
			if (map && typeof map === 'object') {
				const noteIdFromMap = Object.keys(map)[0] || '';
				const note = map[noteIdFromMap]?.note;
				const noteId = (typeof note?.noteId === 'string' && note.noteId) || noteIdFromMap;
				if (noteId) {
					const xsecToken = typeof note?.xsecToken === 'string' ? note.xsecToken.trim() : '';
					if (xsecToken) {
						const query = new URLSearchParams({
							xsec_token: xsecToken,
							xsec_source: 'pc_feed',
							source: 'web_explore_feed',
						});
						return normalizeXhsUrl(`https://www.xiaohongshu.com/discovery/item/${noteId}?${query.toString()}`);
					}
					return normalizeXhsUrl(`https://www.xiaohongshu.com/discovery/item/${noteId}`);
				}
			}
		} catch (_error) {
			// fallback below
		}
	}

	const noteId = noteIdHint || extractXhsNoteIdFromUrl(html);
	if (!noteId) {
		return null;
	}

	const xsecToken = extractXhsTokenFromHtmlByNoteId(html, noteId);
	if (!xsecToken) {
		return null;
	}

	const query = new URLSearchParams({
		xsec_token: xsecToken,
		xsec_source: 'pc_feed',
		source: 'web_explore_feed',
	});
	return normalizeXhsUrl(`https://www.xiaohongshu.com/discovery/item/${noteId}?${query.toString()}`);
}

function extractXhsNoteIdFromUrl(input: string): string {
	if (!input) {
		return '';
	}
	const match = input.match(/\/(?:discovery\/item|explore)\/([a-zA-Z0-9]+)/i);
	return match?.[1] || '';
}

function extractXhsTokenFromHtmlByNoteId(html: string, noteId: string): string {
	if (!html || !noteId) {
		return '';
	}

	const escapedNoteId = noteId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const mapPattern = new RegExp(
		`"noteDetailMap"\\s*:\\s*\\{\\s*"${escapedNoteId}"\\s*:\\s*\\{[\\s\\S]*?"xsecToken"\\s*:\\s*"([^"]+)"`,
		'i'
	);
	const mapMatch = html.match(mapPattern);
	if (mapMatch?.[1]) {
		return decodeJsEscapedString(decodeHtmlEntities(mapMatch[1])).trim();
	}

	const anyTokenMatch = html.match(/"xsecToken"\s*:\s*"([^"]+)"/i);
	if (anyTokenMatch?.[1]) {
		return decodeJsEscapedString(decodeHtmlEntities(anyTokenMatch[1])).trim();
	}

	return '';
}

function extractXhsNoteData(html: string): XhsNoteData {
	const title = extractXhsTitle(html);
	const state = parseXhsState(html);
	const noteFromState = state ? getXhsNoteObject(state) : null;
	const note = noteFromState || extractLooseXhsNoteObject(html);
	const source: 'state' | 'fallback' = note ? 'state' : 'fallback';

	const images = extractXhsImages(note, html);
	const videoUrl = extractXhsVideoUrl(note, html);
	const isVideo = note?.type === 'video';
	const author = extractXhsAuthor(note, html);
	const publishedTs = extractXhsPublishedTs(note);
	const publishedFromDom = extractXhsPublishedFromDom(html);
	const publishedAt = publishedTs > 0 ? formatUnixTime(publishedTs) : publishedFromDom;
	const contentFromHtml = extractXhsDetailDescription(html);
	const metaDescription = extractMetaContent(html, 'name', 'description');
	const content = extractXhsContent(note, contentFromHtml, metaDescription);
	const tags = extractXhsTags(content);
	const cover = images[0] || extractMetaContent(html, 'property', 'og:image') || '';

	return {
		title: title || 'Untitled Xiaohongshu Note',
		content: content.replace(/#[^#\s]*(?:\s+#[^#\s]*)*\s*/g, '').trim(),
		images,
		videoUrl,
		isVideo,
		tags,
		cover: normalizeMediaUrl(cover),
		author,
		publishedAt,
		publishedTs,
		source,
	};
}

function parseXhsState(html: string): any | null {
	const candidates = extractXhsStateCandidates(html);
	let firstParsed: any | null = null;
	for (const candidate of candidates) {
		const parsed = parseLooseJson(candidate);
		if (!parsed || typeof parsed !== 'object') {
			continue;
		}
		if (!firstParsed) {
			firstParsed = parsed;
		}
		if (parsed?.note?.noteDetailMap && typeof parsed.note.noteDetailMap === 'object') {
			return parsed;
		}
	}
	return firstParsed;
}

function extractXhsStateCandidates(html: string): string[] {
	const candidates: string[] = [];
	const addCandidate = (value: string) => {
		const normalized = value.trim();
		if (!normalized || candidates.includes(normalized)) {
			return;
		}
		candidates.push(normalized);
	};

	const assignment = 'window.__INITIAL_STATE__';
	let cursor = 0;
	while (cursor < html.length) {
		const index = html.indexOf(assignment, cursor);
		if (index < 0) {
			break;
		}
		const equalIndex = html.indexOf('=', index + assignment.length);
		if (equalIndex < 0) {
			cursor = index + assignment.length;
			continue;
		}
		const objectStart = html.indexOf('{', equalIndex + 1);
		if (objectStart >= 0) {
			const objectLiteral = extractBalancedObjectLiteral(html, objectStart);
			if (objectLiteral) {
				addCandidate(objectLiteral);
			}
		}

		const parseStart = html.indexOf('JSON.parse', equalIndex + 1);
		if (parseStart >= 0 && parseStart - equalIndex < 120) {
			const literal = extractJsonParseStringFrom(html, parseStart);
			if (literal) {
				addCandidate(decodeJsEscapedString(literal));
			}
		}
		cursor = index + assignment.length;
	}

	for (const match of html.matchAll(/window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/gi)) {
		addCandidate(match[1] || '');
	}

	return candidates;
}

function extractBalancedObjectLiteral(text: string, start: number): string {
	if (start < 0 || text[start] !== '{') {
		return '';
	}
	let depth = 0;
	let inString = false;
	let quote = '';
	let escapeNext = false;
	for (let i = start; i < text.length; i += 1) {
		const ch = text[i];
		if (escapeNext) {
			escapeNext = false;
			continue;
		}
		if (inString) {
			if (ch === '\\') {
				escapeNext = true;
				continue;
			}
			if (ch === quote) {
				inString = false;
				quote = '';
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			inString = true;
			quote = ch;
			continue;
		}
		if (ch === '{') {
			depth += 1;
			continue;
		}
		if (ch === '}') {
			depth -= 1;
			if (depth === 0) {
				return text.slice(start, i + 1);
			}
		}
	}
	return '';
}

function extractJsonParseStringFrom(text: string, from: number): string {
	const segment = text.slice(from, from + 300000);
	const match = segment.match(/JSON\.parse\(\s*(['"])([\s\S]*?)\1\s*\)/);
	return match?.[2] || '';
}

function parseLooseJson(raw: string): any | null {
	try {
		let jsonStr = raw.trim().replace(/;\s*$/, '');
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
		let firstCandidate: any | null = null;
		for (const mapValue of Object.values(map)) {
			const note = (mapValue as any)?.note || (mapValue as any)?.noteCard || null;
			if (!note || typeof note !== 'object') {
				continue;
			}
			if (!firstCandidate) {
				firstCandidate = note;
			}
			if (hasXhsNotePayload(note)) {
				return note;
			}
		}
		return firstCandidate;
	} catch (_error) {
		return null;
	}
}

function hasXhsNotePayload(note: any): boolean {
	if (!note || typeof note !== 'object') {
		return false;
	}
	if (Array.isArray(note.imageList) && note.imageList.length > 0) {
		return true;
	}
	if (typeof note.desc === 'string' && note.desc.trim()) {
		return true;
	}
	if (Array.isArray(note.desc) && note.desc.some((item: unknown) => typeof item === 'string' && item.trim())) {
		return true;
	}
	if (note.video?.media?.stream) {
		return true;
	}
	if (typeof note.title === 'string' && note.title.trim()) {
		return true;
	}
	return false;
}

function extractLooseXhsNoteObject(html: string): any | null {
	let firstCandidate: any | null = null;
	const pattern = /"note"\s*:\s*\{/g;
	let match = pattern.exec(html);
	let scanned = 0;
	while (match && scanned < 80) {
		scanned += 1;
		const braceStart = match.index + match[0].lastIndexOf('{');
		const objectLiteral = extractBalancedObjectLiteral(html, braceStart);
		if (!objectLiteral) {
			match = pattern.exec(html);
			continue;
		}
		const parsed = parseLooseJson(objectLiteral);
		if (parsed && typeof parsed === 'object') {
			if (!firstCandidate) {
				firstCandidate = parsed;
			}
			if (hasXhsNotePayload(parsed)) {
				return parsed;
			}
		}
		match = pattern.exec(html);
	}
	return firstCandidate;
}

function extractXhsImages(note: any, html: string): string[] {
	const urls = new Set<string>();
	const list = Array.isArray(note?.imageList) ? note.imageList : [];
	const hasStructuredImages = list.length > 0;
	for (const img of list) {
		const normalized = normalizeMediaUrl(img?.urlDefault || '');
		if (normalized) {
			urls.add(normalized);
		}
	}
	if (!hasStructuredImages) {
		for (const match of html.matchAll(/https?:\/\/(?:ci|sns-webpic)\.xiaohongshu\.com\/[^\s"'<>\\]+/gi)) {
			const normalized = normalizeMediaUrl(match[0]);
			if (normalized) {
				urls.add(normalized);
			}
		}
		for (const match of html.matchAll(/https?:\/\/(?:sns-webpic|ci)[^"'<>\s]*\.(?:xiaohongshu\.com|xhscdn\.com)\/[^\s"'<>\\]+/gi)) {
			const normalized = normalizeMediaUrl(match[0]);
			if (normalized) {
				urls.add(normalized);
			}
		}
		for (const match of html.matchAll(/background-image\s*:\s*url\((https?:\/\/[^)]+)\)/gi)) {
			const normalized = normalizeMediaUrl(match[1]);
			if (normalized) {
				urls.add(normalized);
			}
		}
		for (const match of html.matchAll(/https?:\\u002F\\u002F(?:sns-webpic|ci)[^"'<>\s]*\.(?:xiaohongshu\.com|xhscdn\.com)\\u002F[^\s"'<>\\]+/gi)) {
			const normalized = normalizeMediaUrl(match[0].replace(/\\u002F/gi, '/'));
			if (normalized) {
				urls.add(normalized);
			}
		}
	}
	if (!hasStructuredImages) {
		const ogImage = normalizeMediaUrl(extractMetaContent(html, 'property', 'og:image'));
		if (ogImage) {
			urls.add(ogImage);
		}
	}
	return Array.from(urls).slice(0, 30);
}

function extractXhsVideoUrl(note: any, html: string): string | null {
	const stream = note?.video?.media?.stream;
	const h264 = Array.isArray(stream?.h264) ? stream.h264 : [];
	const h265 = Array.isArray(stream?.h265) ? stream.h265 : [];
	const picked = h264[0]?.masterUrl || h265[0]?.masterUrl || '';
	const normalized = normalizeMediaUrl(picked);
	if (normalized) {
		return normalized;
	}
	const ogVideo = normalizeMediaUrl(extractMetaContent(html, 'property', 'og:video'));
	if (ogVideo) {
		return ogVideo;
	}
	const inline = html.match(/https?:\/\/[^"'<>\s]*xhs[^"'<>\s]*\.mp4(?:\?[^"'<>\s]*)?/i)?.[0] || '';
	const normalizedInline = normalizeMediaUrl(inline);
	if (normalizedInline) {
		return normalizedInline;
	}
	const escapedInline = html.match(/https?:\\u002F\\u002F[^"'<>\s]*\.mp4(?:\\u003F[^"'<>\s]*)?/i)?.[0] || '';
	if (escapedInline) {
		return normalizeMediaUrl(escapedInline.replace(/\\u002F/gi, '/').replace(/\\u003F/gi, '?').replace(/\\u0026/gi, '&')) || null;
	}
	return null;
}

function extractXhsContent(note: any, contentFromHtml: string, metaDescription: string): string {
	const htmlText = contentFromHtml.replace(/<[^>]+>/g, '').replace(/\[话题\]/g, '').replace(/\[[^\]]+\]/g, '').trim();
	const desc = Array.isArray(note?.desc) ? note.desc.join('\n') : note?.desc || '';
	const decoded = decodeJsEscapedString(String(desc)).replace(/\r/g, '').trim();
	return decoded || htmlText || normalizeWhitespace(metaDescription);
}

function extractXhsAuthor(note: any, html: string): string {
	const author = pickFirst([
		normalizeWhitespace(decodeJsEscapedString(String(note?.user?.nickname || ''))),
		normalizeWhitespace(decodeJsEscapedString(String(note?.author || ''))),
		normalizeWhitespace(decodeJsEscapedString(String(note?.nickname || ''))),
		extractXhsAuthorFromHtml(html),
		extractMetaContent(html, 'name', 'author'),
	]);
	return normalizeWhitespace(author);
}

function extractXhsAuthorFromHtml(html: string): string {
	const text = extractInnerTextByRegex(html, /<span[^>]*class=["'][^"']*\busername\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
	return normalizeWhitespace(text);
}

function extractXhsPublishedTs(note: any): number {
	return pickNumber([
		toUnixSeconds(note?.time),
		toUnixSeconds(note?.lastUpdateTime),
		toUnixSeconds(note?.publishTime),
		toUnixSeconds(note?.publishTimestamp),
	]);
}

function extractXhsPublishedFromDom(html: string): string {
	const text = extractInnerTextByRegex(html, /<span[^>]*class=["'][^"']*\bdate\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
	return normalizeWhitespace(text);
}

function extractInnerTextByRegex(html: string, pattern: RegExp): string {
	const raw = pattern.exec(html)?.[1] || '';
	if (!raw) {
		return '';
	}
	return decodeHtmlEntities(raw).replace(/<[^>]+>/g, '').trim();
}

function extractXhsTitle(html: string): string {
	const ogTitle = extractMetaContent(html, 'property', 'og:title');
	const title = (html.match(/<title>(.*?)<\/title>/)?.[1] || '').replace(' - 小红书', '').trim();
	return normalizeWhitespace(ogTitle || title);
}

function extractXhsDetailDescription(html: string): string {
	const match = html.match(/<div[^>]*id=["']detail-desc["'][^>]*>([\s\S]*?)<\/div>/i);
	return match?.[1] || '';
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
	normalized = normalized.replace(/\\u002F/gi, '/').replace(/\\u003A/gi, ':').replace(/\\u003F/gi, '?').replace(/\\\//g, '/');
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

function toUnixSeconds(value: unknown): number {
	const numeric = typeof value === 'number' ? value : Number(String(value || ''));
	if (!Number.isFinite(numeric) || numeric <= 0) {
		return 0;
	}
	if (numeric >= 1e12) {
		return Math.floor(numeric / 1000);
	}
	return Math.floor(numeric);
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

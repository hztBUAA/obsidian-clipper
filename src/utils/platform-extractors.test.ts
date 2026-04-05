import { describe, expect, test } from 'vitest';
import { extractPlatformData } from './platform-extractors';

describe('platform extractors', () => {
	test('extracts WeChat article metadata and variables', () => {
		const html = `
			<html>
			<head><title>ignored</title></head>
			<body>
				<script>
					window.cgiDataNew = {
						title: JsDecode('测试标题'),
						desc: JsDecode('测试摘要'),
						nick_name: JsDecode('测试公众号'),
						user_name: JsDecode('gh_test'),
						author: JsDecode('作者A'),
						ori_create_time: '1710000000' * 1,
						content_noencode: JsDecode('<p>第一段</p><img data-src="https://mmbiz.qpic.cn/a.jpg" />'),
						create_time: '1710000000' * 1
					};
				</script>
			</body>
			</html>
		`;

		const result = extractPlatformData('https://mp.weixin.qq.com/s/example', html);
		expect(result?.platform).toBe('wechat');
		expect(result?.title).toBe('测试标题');
		expect(result?.variables.wechat_account).toBe('测试公众号');
		expect(result?.variables.wechat_images).toContain('mmbiz.qpic.cn/a.jpg');
		expect(result?.contentHtml).toContain('第一段');
	});

	test('detects WeChat verification page', () => {
		const html = '<html><body>环境异常，请去验证</body></html>';
		const result = extractPlatformData('https://mp.weixin.qq.com/s/example', html);
		expect(result?.platform).toBe('wechat');
		expect(result?.variables.platform_error).toContain('verification');
	});

	test('extracts Xiaohongshu note variables and content', () => {
		const html = `
			<html>
			<head><title>测试笔记 - 小红书</title></head>
			<body>
				<script>
					window.__INITIAL_STATE__ = {"note":{"noteDetailMap":{"6600aa11":{"note":{"type":"video","desc":"这是正文 #效率 #AI","imageList":[{"urlDefault":"https://ci.xiaohongshu.com/1.jpg"}],"video":{"media":{"stream":{"h264":[{"masterUrl":"https://video.xhs.com/a.mp4"}]}}}}}}}};
				</script>
			</body>
			</html>
		`;

		const result = extractPlatformData('https://www.xiaohongshu.com/discovery/item/6600aa11', html);
		expect(result?.platform).toBe('xiaohongshu');
		expect(result?.title).toBe('测试笔记');
		expect(result?.variables.xhs_is_video).toBe('true');
		expect(result?.variables.xhs_video_url).toBe('https://video.xhs.com/a.mp4');
		expect(result?.variables.xhs_tags).toContain('效率');
		expect(result?.contentHtml).toContain('img src=');
	});

	test('extracts Xiaohongshu short-link resolved url from html metadata', () => {
		const html = `
			<html>
			<head>
				<meta property="og:url" content="https://www.xiaohongshu.com/explore/6600aa11?xsec_token=token123&xsec_source=pc_feed">
			</head>
			<body></body>
			</html>
		`;
		const result = extractPlatformData('https://xhslink.com/abc', html);
		expect(result?.platform).toBe('xiaohongshu');
		expect(result?.variables.xhs_source_url).toContain('/discovery/item/6600aa11');
		expect(result?.variables.platform_warning).toContain('Short-link page');
	});
});

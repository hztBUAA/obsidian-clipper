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
		expect(result?.variables.platform_extractor_mode).toBe('wechat_article');
		expect(result?.variables.wechat_account).toBe('测试公众号');
		expect(result?.variables.wechat_images).toContain('mmbiz.qpic.cn/a.jpg');
		expect(result?.contentHtml).toContain('第一段');
		expect(result?.contentHtml).toContain('src="https://mmbiz.qpic.cn/a.jpg"');
	});

	test('detects WeChat verification page', () => {
		const html = '<html><body>环境异常，请去验证</body></html>';
		const result = extractPlatformData('https://mp.weixin.qq.com/s/example', html);
		expect(result?.platform).toBe('wechat');
		expect(result?.variables.platform_extractor_mode).toBe('wechat_verification');
		expect(result?.variables.platform_error).toContain('verification');
		expect(result?.contentHtml).toContain('verification');
	});

	test('extracts Xiaohongshu note variables and content', () => {
		const html = `
			<html>
			<head><title>测试笔记 - 小红书</title></head>
			<body>
				<script>
					window.__INITIAL_STATE__ = {"note":{"noteDetailMap":{"6600aa11":{"note":{"type":"video","desc":"这是正文 #效率 #AI","time":1710000000000,"user":{"nickname":"作者XHS"},"imageList":[{"urlDefault":"https://ci.xiaohongshu.com/1.jpg"}],"video":{"media":{"stream":{"h264":[{"masterUrl":"https://video.xhs.com/a.mp4"}]}}}}}}}};
				</script>
			</body>
			</html>
		`;

		const result = extractPlatformData('https://www.xiaohongshu.com/discovery/item/6600aa11', html);
		expect(result?.platform).toBe('xiaohongshu');
		expect(result?.variables.platform_extractor_mode).toBe('xhs_state');
		expect(result?.title).toBe('测试笔记');
		expect(result?.author).toBe('作者XHS');
		expect(result?.variables.xhs_type).toBe('video');
		expect(result?.variables.xhs_is_video).toBe('true');
		expect(result?.variables.xhs_video_url).toBe('https://video.xhs.com/a.mp4');
		expect(result?.variables.xhs_author).toBe('作者XHS');
		expect(result?.variables.xhs_published_ts).toBe('1710000000');
		expect(result?.variables.xhs_tags).toContain('效率');
		expect(result?.contentHtml).toContain('img src=');
	});

	test('extracts Xiaohongshu state when __INITIAL_STATE__ is assigned via JSON.parse', () => {
		const html = `
			<html>
			<head><title>测试笔记2 - 小红书</title></head>
			<body>
				<script>
					window.__INITIAL_STATE__ = JSON.parse("{\\"note\\":{\\"noteDetailMap\\":{\\"123\\":{\\"note\\":{\\"type\\":\\"normal\\",\\"desc\\":\\"JSON模式正文 #TagA\\",\\"imageList\\":[{\\"urlDefault\\":\\"https://ci.xiaohongshu.com/2.jpg\\"}]}}}}}");
				</script>
			</body>
			</html>
		`;

		const result = extractPlatformData('https://www.xiaohongshu.com/discovery/item/123', html);
		expect(result?.platform).toBe('xiaohongshu');
		expect(result?.variables.platform_extractor_mode).toBe('xhs_state');
		expect(result?.description).toContain('JSON模式正文');
		expect(result?.variables.xhs_tags).toContain('TagA');
		expect(result?.contentHtml).toContain('2.jpg');
	});

	test('uses Xiaohongshu fallback extraction when structured state is missing', () => {
		const html = `
			<html>
			<head>
				<title>回退测试 - 小红书</title>
				<meta property="og:image" content="https://ci.xiaohongshu.com/fallback.jpg">
				<meta name="description" content="回退描述 #生活">
			</head>
			<body>
				<span class="username">回退作者</span>
				<span class="date">昨天 13:04 河南</span>
				<div id="detail-desc">详情正文 #生活</div>
			</body>
			</html>
		`;

		const result = extractPlatformData('https://www.xiaohongshu.com/discovery/item/fallback1', html);
		expect(result?.platform).toBe('xiaohongshu');
		expect(result?.variables.platform_extractor_mode).toBe('xhs_fallback');
		expect(result?.author).toBe('回退作者');
		expect(result?.published).toBe('昨天 13:04 河南');
		expect(result?.contentHtml).toContain('详情正文');
		expect(result?.contentHtml).toContain('fallback.jpg');
		expect(result?.variables.platform_warning).toContain('fallback extraction');
	});

	test('fallback extracts xhscdn images and escaped video url when state is missing', () => {
		const html = `
			<html>
			<head><title>回退媒体测试 - 小红书</title></head>
			<body>
				<div id="detail-desc">回退正文 #测试</div>
				<span class="username">回退作者</span>
				<span class="date">昨天 13:04 河南</span>
				<div class="player-container" style="background-image:url(http://sns-webpic-qc.xhscdn.com/20260405/a.jpg)"></div>
				<script>
					const media = "http:\\u002F\\u002Fsns-video-bd.xhscdn.com\\u002Fstream\\u002F79\\u002F110\\u002F258\\u002Fa.mp4\\u003Fsign\\u003Dabc\\u0026t\\u003D1";
				</script>
			</body>
			</html>
		`;
		const result = extractPlatformData('https://www.xiaohongshu.com/explore/media-fallback?xsec_token=token3&xsec_source=pc_feed', html);
		expect(result?.platform).toBe('xiaohongshu');
		expect(result?.variables.platform_extractor_mode).toBe('xhs_fallback');
		expect(result?.variables.xhs_images).toContain('sns-webpic-qc.xhscdn.com/20260405/a.jpg');
		expect(result?.variables.xhs_video_url).toContain('sns-video-bd.xhscdn.com');
		expect(result?.contentHtml).toContain('<img src=');
		expect(result?.contentHtml).toContain('.mp4');
	});

	test('returns structured fallback content for unavailable Xiaohongshu page', () => {
		const html = '<html><head><title>小红书 - 你访问的页面不见了</title></head><body></body></html>';
		const result = extractPlatformData('https://www.xiaohongshu.com/discovery/item/missing123', html);
		expect(result?.platform).toBe('xiaohongshu');
		expect(result?.variables.platform_extractor_mode).toBe('xhs_unavailable');
		expect(result?.variables.platform_error).toContain('unavailable');
		expect(result?.contentHtml).toContain('unavailable');
	});

	test('does not treat normal Xiaohongshu note as unavailable when html contains 404 text', () => {
		const html = `
			<html>
			<head><title>正常笔记标题 - 小红书</title></head>
			<body>
				<div id="noteContainer"></div>
				<div id="detail-desc">这是详情正文 #测试</div>
				<script>
					window.__INITIAL_STATE__ = {"note":{"noteDetailMap":{"abc123":{"note":{"type":"normal","desc":"这是详情正文 #测试","imageList":[{"urlDefault":"https://ci.xiaohongshu.com/a.jpg"}]}}}}};
				</script>
				<!-- sourceMappingURL=app.404.js.map -->
			</body>
			</html>
		`;
		const result = extractPlatformData('https://www.xiaohongshu.com/discovery/item/abc123', html);
		expect(result?.platform).toBe('xiaohongshu');
		expect(result?.variables.platform_extractor_mode).toBe('xhs_state');
		expect(result?.variables.platform_error || '').toBe('');
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

	test('builds tokenized Xiaohongshu url from state when short-link metadata has no token', () => {
		const html = `
			<html>
			<head>
				<meta property="og:url" content="https://www.xiaohongshu.com/explore/69d09be900000000220036e8">
			</head>
			<body>
				<script>
					window.__INITIAL_STATE__={"note":{"noteDetailMap":{"69d09be900000000220036e8":{"note":{"noteId":"69d09be900000000220036e8","xsecToken":"STATE_TOKEN_123","type":"video","desc":"正文","imageList":[{"urlDefault":"https://ci.xiaohongshu.com/a.jpg"}]}}}}};
				</script>
			</body>
			</html>
		`;
		const result = extractPlatformData('https://xhslink.com/abc-no-token', html);
		expect(result?.platform).toBe('xiaohongshu');
		expect(result?.variables.xhs_source_url).toContain('xsec_token=STATE_TOKEN_123');
		expect(result?.variables.xhs_source_url).toContain('xsec_source=pc_feed');
	});

	test('selects the first useful note entry from Xiaohongshu noteDetailMap', () => {
		const html = `
			<html>
			<head><title>映射选择测试 - 小红书</title></head>
			<body>
				<script>
					window.__INITIAL_STATE__ = {"note":{"noteDetailMap":{"placeholder":{"note":{}},"realNote":{"note":{"desc":"真实正文 #TagB","user":{"nickname":"真实作者"},"time":1712345678000,"imageList":[{"urlDefault":"https://ci.xiaohongshu.com/real.jpg"}]}}}}};
				</script>
			</body>
			</html>
		`;
		const result = extractPlatformData('https://www.xiaohongshu.com/discovery/item/realNote', html);
		expect(result?.platform).toBe('xiaohongshu');
		expect(result?.variables.platform_extractor_mode).toBe('xhs_state');
		expect(result?.author).toBe('真实作者');
		expect(result?.description).toContain('真实正文');
		expect(result?.variables.xhs_type).toBe('note');
		expect(result?.variables.xhs_is_video).toBe('false');
		expect(result?.variables.xhs_video_url).toBe('');
		expect(result?.variables.xhs_images).toContain('real.jpg');
	});

	test('extracts real-world Xiaohongshu video note (aligned with old smoke case)', () => {
		const html = `
			<html>
			<head><title>API中转站是如何日入过万的？ - 小红书</title></head>
			<body>
				<div id="noteContainer"></div>
				<div id="detail-desc">最近中转站很火，拆解一下普通人怎么赚钱和防止被坑</div>
				<span class="username">日安然holland</span>
				<span class="date">昨天 13:04 河南</span>
				<script>
					window.__INITIAL_STATE__={"note":{"noteDetailMap":{"69d09be900000000220036e8":{"note":{"noteId":"69d09be900000000220036e8","type":"video","title":"API中转站是如何日入过万的？","time":1775279081000,"desc":"最近中转站很火，拆解一下普通人怎么赚钱和防止被坑#api中转[话题]#","user":{"nickname":"日安然holland"},"imageList":[{"urlDefault":"http:\\u002F\\u002Fsns-webpic-qc.xhscdn.com\\u002F202604051729\\u002F1d1c1709598eceb8c59177709f8a954e\\u002F1040g2sg31uhd02um2al05o3ftbf084npnkgt4m8!nd_dft_wlteh_jpg_3"}],"video":{"media":{"stream":{"h264":[{"masterUrl":"http:\\u002F\\u002Fsns-video-bd.xhscdn.com\\u002Fstream\\u002F79\\u002F110\\u002F258\\u002F01e9d09be83160014f0370019d56e18d06_258.mp4\\u003Fsign\\u003Daed74243423f9ab50618835afb2a1367\\u0026t\\u003D69d22b90"}]}}}}}}}};
				</script>
			</body>
			</html>
		`;
		const result = extractPlatformData('https://www.xiaohongshu.com/explore/69d09be900000000220036e8?xsec_token=token1&xsec_source=pc_feed', html);
		expect(result?.platform).toBe('xiaohongshu');
		expect(result?.variables.platform_extractor_mode).toBe('xhs_state');
		expect(result?.title).toContain('API中转站');
		expect(result?.author).toBe('日安然holland');
		expect(result?.variables.xhs_type).toBe('video');
		expect(result?.variables.xhs_is_video).toBe('true');
		expect(result?.variables.xhs_video_url).toContain('sns-video-bd.xhscdn.com');
		expect(result?.variables.xhs_images).toContain('sns-webpic-qc.xhscdn.com');
		expect(result?.contentHtml).toContain('<img src=');
	});

	test('extracts real-world Xiaohongshu image note (aligned with old smoke case)', () => {
		const html = `
			<html>
			<head><title>nanorllm开源 agentic RL 最核心的训练闭环 - 小红书</title></head>
			<body>
				<div id="noteContainer"></div>
				<div id="detail-desc">最近写了一个 nanorllm，核心想法不是复现完整 rllm 工程</div>
				<span class="username">PaperBox</span>
				<span class="date">4天前 浙江</span>
				<script>
					window.__INITIAL_STATE__={"note":{"noteDetailMap":{"69cbc340000000001a02329e":{"note":{"noteId":"69cbc340000000001a02329e","type":"normal","title":"nanorllm开源 agentic RL 最核心的训练闭环","time":1774961472000,"desc":"最近写了一个 nanorllm，核心想法不是复现完整 rllm 工程#AGENT[话题]#","user":{"nickname":"PaperBox"},"imageList":[{"urlDefault":"http:\\u002F\\u002Fsns-webpic-qc.xhscdn.com\\u002F202604051747\\u002F73039fcd4fdae5e4567e962c7f05e214\\u002F1040g2sg31uclec9r2ak04a9g0ip0fcm2m0ur988!nd_dft_wlteh_jpg_3"},{"urlDefault":"http:\\u002F\\u002Fsns-webpic-qc.xhscdn.com\\u002F202604051747\\u002F74265709638e72b52a6495c43179602f\\u002F1040g2sg31uclec9r2aj04a9g0ip0fcm29ivqoc0!nd_dft_wgth_jpg_3"},{"urlDefault":"http:\\u002F\\u002Fsns-webpic-qc.xhscdn.com\\u002F202604051747\\u002Fa802ffd53a7e5e2ae0d76dd18048862a\\u002F1040g2sg31uclec9r2aig4a9g0ip0fcm2d77trh8!nd_dft_wgth_jpg_3"}]}}}}};
				</script>
			</body>
			</html>
		`;
		const result = extractPlatformData('https://www.xiaohongshu.com/explore/69cbc340000000001a02329e?xsec_token=token2&xsec_source=pc_feed', html);
		expect(result?.platform).toBe('xiaohongshu');
		expect(result?.variables.platform_extractor_mode).toBe('xhs_state');
		expect(result?.author).toBe('PaperBox');
		expect(result?.variables.xhs_type).toBe('note');
		expect(result?.variables.xhs_is_video).toBe('false');
		expect(result?.variables.xhs_video_url).toBe('');
		const images = JSON.parse(result?.variables.xhs_images || '[]');
		expect(images.length).toBeGreaterThanOrEqual(3);
		expect(result?.contentHtml).toContain('<img src=');
	});
});

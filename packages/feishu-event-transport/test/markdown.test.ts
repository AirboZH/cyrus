import { describe, expect, it } from "vitest";
import { containsMarkdown } from "../src/markdown.js";

describe("containsMarkdown", () => {
	describe("plain text → false", () => {
		const plain: Array<[string, string]> = [
			["empty string", ""],
			["simple greeting", "你好"],
			["english sentence", "Hello, how are you today?"],
			[
				"chinese prose with punctuation",
				"这是一个普通的句子，没有任何特殊语法。",
			],
			["mixed with punctuation", "任务已完成，结果如下：一切正常！"],
			["arithmetic minus", "结果是 5 - 3 = 2"],
			["standalone asterisk", "评分 3 * 4 分，还行"],
			["snake_case identifier", "调用 function_name 完成"],
			["multiple underscores in identifier", "变量 my_var_name 已更新"],
			["version number", "升级到 1.0 版本"],
			["numbered but no space", "第1.项内容"],
			["url without markdown link", "详见 https://example.com/path 页面"],
			["arrow function text", "写成 x => x + 1 即可"],
			["isolated dash mid-line", "这是一个-连字符-例子"],
		];

		it.each(plain)("classifies %s as plain text", (_desc, text) => {
			expect(containsMarkdown(text)).toBe(false);
		});
	});

	describe("markdown → true", () => {
		const markdown: Array<[string, string]> = [
			["bold", "这是 **加粗** 文字"],
			["italic asterisk", "这是 *斜体* 文字"],
			["italic underscore", "这是 _斜体_ 文字"],
			["strikethrough", "这是 ~~删除线~~ 文字"],
			["unordered list dash", "清单：\n- 第一项\n- 第二项"],
			["unordered list star", "清单：\n* 第一项"],
			["unordered list plus", "清单：\n+ 第一项"],
			["ordered list", "步骤：\n1. 打开\n2. 关闭"],
			["heading h1", "# 标题\n正文"],
			["heading h3", "### 小标题"],
			["link", "详见 [文档](https://example.com)"],
			["inline code", "运行 `pnpm build` 命令"],
			["fenced code block", "示例：\n```\nconst a = 1\n```"],
			["blockquote", "> 引用一段话"],
			["horizontal rule", "上文\n\n---\n\n下文"],
		];

		it.each(markdown)("classifies %s as markdown", (_desc, text) => {
			expect(containsMarkdown(text)).toBe(true);
		});
	});
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	FeishuDocsClient,
	parseFeishuDocRef,
} from "../../../src/tools/cyrus-tools/feishu-docs.js";

/** Build a fetch mock that routes by URL substring. */
function routedFetch(
	routes: Array<{
		match: string;
		body: unknown;
		ok?: boolean;
		status?: number;
	}>,
) {
	return vi.fn(async (url: string) => {
		const route = routes.find((r) => url.includes(r.match));
		if (!route) throw new Error(`No route for ${url}`);
		return {
			ok: route.ok ?? true,
			status: route.status ?? 200,
			statusText: "OK",
			text: async () => JSON.stringify(route.body),
			json: async () => route.body,
		};
	});
}

const TOKEN_ROUTE = {
	match: "/auth/v3/tenant_access_token/internal",
	body: { code: 0, tenant_access_token: "t_abc", expire: 7200 },
};

describe("parseFeishuDocRef", () => {
	it("detects docx / wiki / sheets / base URLs", () => {
		expect(parseFeishuDocRef("https://x.feishu.cn/docx/AbC123")).toMatchObject({
			type: "docx",
			token: "AbC123",
			explicit: true,
		});
		expect(parseFeishuDocRef("https://x.feishu.cn/wiki/W1k2")).toMatchObject({
			type: "wiki",
			token: "W1k2",
			explicit: true,
		});
		expect(
			parseFeishuDocRef("https://x.feishu.cn/sheets/Sh33t?sheet=1"),
		).toMatchObject({ type: "sheet", token: "Sh33t", explicit: true });
		expect(parseFeishuDocRef("https://x.feishu.cn/base/Ba5e")).toMatchObject({
			type: "bitable",
			token: "Ba5e",
			explicit: true,
		});
	});

	it("defaults a bare token to docx (non-explicit)", () => {
		expect(parseFeishuDocRef("doxcnAbc123")).toMatchObject({
			type: "docx",
			token: "doxcnAbc123",
			explicit: false,
		});
	});
});

describe("FeishuDocsClient.readDocument", () => {
	afterEach(() => vi.restoreAllMocks());

	it("reads a docx URL: mints token, returns content + title", async () => {
		const fetchMock = routedFetch([
			TOKEN_ROUTE,
			{
				match: "/docx/v1/documents/DocX1/raw_content",
				body: { code: 0, data: { content: "Hello world body" } },
			},
			{
				match: "/docx/v1/documents/DocX1",
				body: { code: 0, data: { document: { title: "My Doc" } } },
			},
		]);
		vi.stubGlobal("fetch", fetchMock);

		const client = new FeishuDocsClient("cli_app", "secret");
		const result = await client.readDocument("https://x.feishu.cn/docx/DocX1");

		expect(result).toMatchObject({
			docType: "docx",
			token: "DocX1",
			title: "My Doc",
			text: "Hello world body",
		});
		// tenant token was minted with the app credentials
		const tokenCall = fetchMock.mock.calls.find((c) =>
			(c[0] as string).includes("tenant_access_token"),
		);
		expect(JSON.parse((tokenCall?.[1] as { body: string }).body)).toEqual({
			app_id: "cli_app",
			app_secret: "secret",
		});
	});

	it("reads a wiki URL: resolves the node to its docx, then reads it", async () => {
		const fetchMock = routedFetch([
			TOKEN_ROUTE,
			{
				match: "/wiki/v2/spaces/get_node",
				body: {
					code: 0,
					data: {
						node: {
							obj_type: "docx",
							obj_token: "DocXfromWiki",
							title: "Wiki Title",
						},
					},
				},
			},
			{
				match: "/docx/v1/documents/DocXfromWiki/raw_content",
				body: { code: 0, data: { content: "wiki body text" } },
			},
			{
				match: "/docx/v1/documents/DocXfromWiki",
				body: { code: 0, data: { document: { title: "Wiki Title" } } },
			},
		]);
		vi.stubGlobal("fetch", fetchMock);

		const client = new FeishuDocsClient("a", "b");
		const result = await client.readDocument("https://x.feishu.cn/wiki/W1");
		expect(result).toMatchObject({
			docType: "docx",
			token: "DocXfromWiki",
			title: "Wiki Title",
			text: "wiki body text",
		});
	});

	it("returns a note for a wiki node that is a sheet (not docx)", async () => {
		vi.stubGlobal(
			"fetch",
			routedFetch([
				TOKEN_ROUTE,
				{
					match: "/wiki/v2/spaces/get_node",
					body: {
						code: 0,
						data: {
							node: {
								obj_type: "sheet",
								obj_token: "Sheet1",
								title: "A Sheet",
							},
						},
					},
				},
			]),
		);
		const client = new FeishuDocsClient("a", "b");
		const result = await client.readDocument("https://x.feishu.cn/wiki/W2");
		expect(result.text).toBeUndefined();
		expect(result.note).toContain("sheet");
		expect(result.token).toBe("Sheet1");
	});

	it("returns a note (no read) for a sheet URL", async () => {
		vi.stubGlobal("fetch", routedFetch([TOKEN_ROUTE]));
		const client = new FeishuDocsClient("a", "b");
		const result = await client.readDocument("https://x.feishu.cn/sheets/S1");
		expect(result.docType).toBe("sheet");
		expect(result.note).toContain("not supported");
	});

	it("caches the tenant token across reads", async () => {
		const fetchMock = routedFetch([
			TOKEN_ROUTE,
			{
				match: "/raw_content",
				body: { code: 0, data: { content: "x" } },
			},
			{
				match: "/docx/v1/documents/",
				body: { code: 0, data: { document: { title: "t" } } },
			},
		]);
		vi.stubGlobal("fetch", fetchMock);
		const client = new FeishuDocsClient("a", "b");
		await client.readDocument("https://x.feishu.cn/docx/D1");
		await client.readDocument("https://x.feishu.cn/docx/D2");
		const tokenCalls = fetchMock.mock.calls.filter((c) =>
			(c[0] as string).includes("tenant_access_token"),
		);
		expect(tokenCalls).toHaveLength(1);
	});

	it("surfaces a Feishu API error (code !== 0)", async () => {
		vi.stubGlobal(
			"fetch",
			routedFetch([
				TOKEN_ROUTE,
				{
					match: "/raw_content",
					body: { code: 1254005, msg: "no permission" },
				},
			]),
		);
		const client = new FeishuDocsClient("a", "b");
		await expect(
			client.readDocument("https://x.feishu.cn/docx/DENIED"),
		).rejects.toThrow(/code=1254005/);
	});
});

/**
 * Minimal Feishu (Lark) document reader used by the `feishu_read_document`
 * cyrus-tool. Reads the text content of a Feishu **docx** document or a **wiki**
 * page (which is resolved to its underlying docx). Authenticates with the app's
 * `tenant_access_token` minted from FEISHU_APP_ID / FEISHU_APP_SECRET.
 *
 * Self-contained (plain `fetch`, no SDK/fastify) so the published `cyrus-mcp-tools`
 * package stays lean. Validated against the live Feishu API:
 * - GET /open-apis/wiki/v2/spaces/get_node?token=<node_token> → data.node.{obj_type, obj_token, title}
 * - GET /open-apis/docx/v1/documents/<document_id>/raw_content → data.content
 * - GET /open-apis/docx/v1/documents/<document_id> → data.document.title
 */

/** Default Feishu open-platform base URL (feishu.cn). */
const FEISHU_DEFAULT_BASE_URL = "https://open.feishu.cn/open-apis";

/** Reference to a Feishu document parsed from a URL or raw token. */
export interface FeishuDocRef {
	/** Document family inferred from the URL path (or defaulted). */
	type: "wiki" | "docx" | "doc" | "sheet" | "bitable" | "unknown";
	/** The token (node_token for wiki, document_id for docx, etc.). */
	token: string;
	/** True when the type was determined from an explicit URL path (not defaulted). */
	explicit: boolean;
}

export interface FeishuReadDocumentResult {
	/** Resolved document family that was actually read. */
	docType: "docx" | "sheet" | "bitable" | "mindnote" | "file" | "unknown";
	/** Token of the underlying object that was read (e.g. resolved docx id). */
	token: string;
	/** Document title, when available. */
	title?: string;
	/** Plain-text content, present for docx. */
	text?: string;
	/** Explanation when the content type is not supported for reading. */
	note?: string;
}

/**
 * Parse a Feishu document URL or raw token into a {@link FeishuDocRef}.
 * Recognizes `/wiki/`, `/docx/`, `/docs/`, `/sheets/`, `/base/` (bitable) URLs;
 * a bare token defaults to `docx` (non-explicit, so callers may fall back to wiki).
 */
export function parseFeishuDocRef(urlOrToken: string): FeishuDocRef {
	const trimmed = (urlOrToken || "").trim();
	const patterns: Array<[FeishuDocRef["type"], RegExp]> = [
		["wiki", /\/wiki\/([A-Za-z0-9]+)/],
		["docx", /\/docx\/([A-Za-z0-9]+)/],
		["doc", /\/docs\/([A-Za-z0-9]+)/],
		["sheet", /\/sheets\/([A-Za-z0-9]+)/],
		["bitable", /\/(?:base|bitable)\/([A-Za-z0-9]+)/],
	];
	for (const [type, re] of patterns) {
		const m = trimmed.match(re);
		if (m?.[1]) return { type, token: m[1], explicit: true };
	}
	// Bare token: strip any query/hash, default to docx (non-explicit).
	const token = trimmed.replace(/[?#].*$/, "");
	return { type: "docx", token, explicit: false };
}

interface FeishuWikiNode {
	obj_type?: string;
	obj_token?: string;
	title?: string;
}

export class FeishuDocsClient {
	private readonly appId: string;
	private readonly appSecret: string;
	private readonly baseUrl: string;
	private cachedToken: string | undefined;
	private tokenExpiresAt = 0;

	constructor(appId: string, appSecret: string, baseUrl?: string) {
		this.appId = appId;
		this.appSecret = appSecret;
		this.baseUrl = (baseUrl ?? FEISHU_DEFAULT_BASE_URL).replace(/\/+$/, "");
	}

	/**
	 * Read a Feishu docx or wiki document into plain text. Non-docx wiki nodes
	 * and sheet/bitable references return a `note` instead of `text`.
	 */
	async readDocument(urlOrToken: string): Promise<FeishuReadDocumentResult> {
		const ref = parseFeishuDocRef(urlOrToken);

		if (ref.type === "wiki") {
			return this.readWiki(ref.token);
		}

		if (ref.type === "docx" || ref.type === "doc") {
			try {
				const { title, text } = await this.readDocx(ref.token);
				return { docType: "docx", token: ref.token, title, text };
			} catch (error) {
				// A bare token we defaulted to docx might actually be a wiki node —
				// retry as wiki before giving up.
				if (!ref.explicit) {
					try {
						return await this.readWiki(ref.token);
					} catch {
						// fall through to rethrow the original docx error
					}
				}
				throw error;
			}
		}

		return {
			docType: ref.type === "sheet" ? "sheet" : "bitable",
			token: ref.token,
			note: `Reading '${ref.type}' content is not supported yet — only Feishu docs (docx) and wiki pages can be read. Token: ${ref.token}`,
		};
	}

	private async readWiki(nodeToken: string): Promise<FeishuReadDocumentResult> {
		const node = await this.resolveWikiNode(nodeToken);
		if (node.obj_type === "docx" || node.obj_type === "doc") {
			const { title, text } = await this.readDocx(node.obj_token ?? "");
			return {
				docType: "docx",
				token: node.obj_token ?? nodeToken,
				title: node.title || title,
				text,
			};
		}
		return {
			docType:
				(node.obj_type as FeishuReadDocumentResult["docType"]) ?? "unknown",
			token: node.obj_token ?? nodeToken,
			title: node.title,
			note: `This wiki page is a '${node.obj_type ?? "unknown"}', whose content reading is not supported yet (only docx wiki pages can be read). Object token: ${node.obj_token ?? nodeToken}`,
		};
	}

	private async resolveWikiNode(nodeToken: string): Promise<FeishuWikiNode> {
		const url = `${this.baseUrl}/wiki/v2/spaces/get_node?token=${encodeURIComponent(nodeToken)}`;
		const body = await this.get(url);
		const node = body?.data?.node as FeishuWikiNode | undefined;
		if (!node?.obj_token) {
			throw new Error(
				`Wiki node not found or the Cyrus bot lacks access: ${nodeToken}`,
			);
		}
		return node;
	}

	private async readDocx(
		documentId: string,
	): Promise<{ title?: string; text: string }> {
		const contentBody = await this.get(
			`${this.baseUrl}/docx/v1/documents/${encodeURIComponent(documentId)}/raw_content`,
		);
		const text = (contentBody?.data?.content as string) ?? "";

		let title: string | undefined;
		try {
			const metaBody = await this.get(
				`${this.baseUrl}/docx/v1/documents/${encodeURIComponent(documentId)}`,
			);
			title = metaBody?.data?.document?.title as string | undefined;
		} catch {
			// title is best-effort
		}

		return { title, text };
	}

	private async get(url: string): Promise<{
		code?: number;
		msg?: string;
		data?: Record<string, unknown> & {
			node?: FeishuWikiNode;
			content?: string;
			document?: { title?: string };
		};
	}> {
		const token = await this.getTenantAccessToken();
		const response = await fetch(url, {
			method: "GET",
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[FeishuDocsClient] GET failed: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}
		const body = (await response.json()) as { code?: number; msg?: string };
		if (body.code !== 0) {
			throw new Error(
				`[FeishuDocsClient] Feishu API error: code=${body.code} msg=${body.msg ?? "unknown"}`,
			);
		}
		return body as Awaited<ReturnType<FeishuDocsClient["get"]>>;
	}

	private async getTenantAccessToken(): Promise<string> {
		if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
			return this.cachedToken;
		}
		const response = await fetch(
			`${this.baseUrl}/auth/v3/tenant_access_token/internal`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json; charset=utf-8" },
				body: JSON.stringify({
					app_id: this.appId,
					app_secret: this.appSecret,
				}),
			},
		);
		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`[FeishuDocsClient] Failed to mint tenant_access_token: ${response.status} ${response.statusText} - ${errorBody}`,
			);
		}
		const body = (await response.json()) as {
			code: number;
			msg?: string;
			tenant_access_token?: string;
			expire?: number;
		};
		if (body.code !== 0 || !body.tenant_access_token) {
			throw new Error(
				`[FeishuDocsClient] Feishu API error minting token: code=${body.code} msg=${body.msg ?? "unknown"}`,
			);
		}
		this.cachedToken = body.tenant_access_token;
		// `expire` is seconds; refresh 5 min early.
		this.tokenExpiresAt =
			Date.now() + Math.max(0, (body.expire ?? 7200) * 1000 - 5 * 60 * 1000);
		return this.cachedToken;
	}
}

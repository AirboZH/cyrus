import {
	FeishuMessageService,
	type FeishuTokenProvider,
	type FeishuWebhookEvent,
} from "cyrus-feishu-event-transport";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRepositoryProvider } from "../src/ChatRepositoryProvider.js";
import {
	extractCreatedLinearIssues,
	FeishuChatAdapter,
} from "../src/FeishuChatAdapter.js";
import type { FeishuIssueBindingInput } from "../src/FeishuIssueNotificationService.js";

type Any = any;

function staticProvider(): ChatRepositoryProvider {
	return {
		getRepositoryPaths: () => [],
		getDefaultRepository: () => undefined,
		getDefaultLinearWorkspaceId: () => undefined,
	};
}

function tokenProvider(): FeishuTokenProvider {
	return {
		getTenantAccessToken: vi.fn().mockResolvedValue("t_test"),
		getCachedBotOpenId: vi.fn().mockReturnValue("ou_bot"),
		resolveBotOpenId: vi.fn().mockResolvedValue("ou_bot"),
	} as unknown as FeishuTokenProvider;
}

function mentionEvent(
	overrides: Partial<FeishuWebhookEvent["payload"]> = {},
): FeishuWebhookEvent {
	return {
		eventType: "mention",
		eventId: "evt_1",
		tenantKey: "tenant",
		payload: {
			type: "mention",
			user: "ou_requester",
			userName: "Ada",
			text: "please create an issue",
			rawContent: "",
			messageType: "text",
			messageId: "om_msg",
			chatId: "oc_chat",
			chatType: "group",
			rootId: "om_root",
			createTime: "1700000000000",
			...overrides,
		},
	};
}

/** Build a save_issue tool_use assistant message + its tool_result user message. */
function saveIssueTurn(
	toolUseId: string,
	input: Record<string, unknown>,
	result: unknown,
	isError = false,
) {
	return [
		{
			type: "assistant",
			message: {
				content: [
					{
						type: "tool_use",
						id: toolUseId,
						name: "mcp__linear__save_issue",
						input,
					},
				],
			},
		},
		{
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: toolUseId,
						is_error: isError,
						content: result,
					},
				],
			},
		},
	];
}

describe("extractCreatedLinearIssues", () => {
	it("returns nothing when no save_issue tool was called", () => {
		const messages = [
			{
				type: "assistant",
				message: { content: [{ type: "text", text: "hello" }] },
			},
		] as Any;
		expect(extractCreatedLinearIssues(messages)).toEqual([]);
	});

	it("recovers identifier + URL + UUID from a JSON result", () => {
		const messages = saveIssueTurn(
			"tu_1",
			{ title: "Ship the thing" },
			JSON.stringify({
				id: "550e8400-e29b-41d4-a716-446655440000",
				identifier: "IN-42",
				url: "https://linear.app/acme/issue/IN-42/ship-the-thing",
				title: "Ship the thing (server)",
			}),
		) as Any;

		expect(extractCreatedLinearIssues(messages)).toEqual([
			{
				issueIdentifier: "IN-42",
				issueId: "550e8400-e29b-41d4-a716-446655440000",
				issueUrl: "https://linear.app/acme/issue/IN-42/ship-the-thing",
				issueTitle: "Ship the thing (server)",
			},
		]);
	});

	it("recovers identifier + URL from a plain-text result and falls back to the input title", () => {
		const messages = saveIssueTurn(
			"tu_1",
			{ title: "Ship the thing" },
			"Created issue: https://linear.app/acme/issue/IN-42/ship-the-thing",
		) as Any;

		expect(extractCreatedLinearIssues(messages)).toEqual([
			{
				issueIdentifier: "IN-42",
				issueId: undefined,
				issueUrl: "https://linear.app/acme/issue/IN-42/ship-the-thing",
				issueTitle: "Ship the thing",
			},
		]);
	});

	it("reads text from a content-block array result", () => {
		const messages = saveIssueTurn("tu_1", { title: "T" }, [
			{
				type: "text",
				text: "Done. https://linear.app/acme/issue/IN-7/t",
			},
		]) as Any;
		const [issue] = extractCreatedLinearIssues(messages);
		expect(issue.issueIdentifier).toBe("IN-7");
		expect(issue.issueUrl).toBe("https://linear.app/acme/issue/IN-7/t");
	});

	it("ignores errored save_issue results", () => {
		const messages = saveIssueTurn(
			"tu_1",
			{ title: "T" },
			"error: permission denied",
			true,
		) as Any;
		expect(extractCreatedLinearIssues(messages)).toEqual([]);
	});

	it("dedupes repeated results for the same identifier", () => {
		const messages = [
			...saveIssueTurn(
				"tu_1",
				{ title: "T" },
				"https://linear.app/acme/issue/IN-42/t",
			),
			...saveIssueTurn(
				"tu_2",
				{ title: "T (update)" },
				"https://linear.app/acme/issue/IN-42/t",
			),
		] as Any;
		expect(extractCreatedLinearIssues(messages)).toHaveLength(1);
	});
});

describe("FeishuChatAdapter created-issue capture", () => {
	beforeEach(() => {
		// Silence the actual reply network call in postReply.
		vi.spyOn(FeishuMessageService.prototype, "replyMessage").mockResolvedValue(
			undefined,
		);
	});

	function runnerWith(messages: unknown[]) {
		return {
			getMessages: vi.fn().mockReturnValue(messages),
		} as Any;
	}

	it("invokes onIssueCreated with the thread source context", async () => {
		const captured: FeishuIssueBindingInput[] = [];
		const adapter = new FeishuChatAdapter(
			staticProvider(),
			tokenProvider(),
			undefined,
			{
				onIssueCreated: (binding) => captured.push(binding),
			},
		);

		const messages = saveIssueTurn(
			"tu_1",
			{ title: "Ship the thing" },
			"Created: https://linear.app/acme/issue/IN-42/ship-the-thing",
		);
		// Add a final assistant text so postReply has a summary to send.
		messages.push({
			type: "assistant",
			message: { content: [{ type: "text", text: "Done!" }] },
		} as Any);

		await adapter.postReply(mentionEvent(), runnerWith(messages));

		expect(captured).toHaveLength(1);
		expect(captured[0]).toMatchObject({
			issueIdentifier: "IN-42",
			issueUrl: "https://linear.app/acme/issue/IN-42/ship-the-thing",
			issueTitle: "Ship the thing",
			chatId: "oc_chat",
			openId: "ou_requester",
			userName: "Ada",
			// rootId || messageId → thread root
			rootMessageId: "om_root",
		});
	});

	it("captures even when the agent stays silent (no-response sentinel)", async () => {
		const captured: FeishuIssueBindingInput[] = [];
		const adapter = new FeishuChatAdapter(
			staticProvider(),
			tokenProvider(),
			undefined,
			{ onIssueCreated: (binding) => captured.push(binding) },
		);

		const messages = saveIssueTurn(
			"tu_1",
			{ title: "Quiet task" },
			"https://linear.app/acme/issue/IN-99/quiet",
		);
		messages.push({
			type: "assistant",
			message: { content: [{ type: "text", text: "<<NO_RESPONSE>>" }] },
		} as Any);

		await adapter.postReply(mentionEvent(), runnerWith(messages));

		expect(captured.map((b) => b.issueIdentifier)).toEqual(["IN-99"]);
	});

	it("falls back to messageId as the thread root when rootId is absent", async () => {
		const captured: FeishuIssueBindingInput[] = [];
		const adapter = new FeishuChatAdapter(
			staticProvider(),
			tokenProvider(),
			undefined,
			{ onIssueCreated: (binding) => captured.push(binding) },
		);

		const messages = saveIssueTurn(
			"tu_1",
			{ title: "T" },
			"https://linear.app/acme/issue/IN-1/t",
		);
		messages.push({
			type: "assistant",
			message: { content: [{ type: "text", text: "ok" }] },
		} as Any);

		await adapter.postReply(
			mentionEvent({ rootId: undefined, messageId: "om_only" }),
			runnerWith(messages),
		);

		expect(captured[0]?.rootMessageId).toBe("om_only");
	});
});

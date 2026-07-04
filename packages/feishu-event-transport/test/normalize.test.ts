import { describe, expect, it } from "vitest";
import { normalizeFeishuMessageEvent } from "../src/normalize.js";
import { BOT_OPEN_ID, USER_OPEN_ID } from "./fixtures.js";

function input(messageOverrides: Record<string, unknown> = {}) {
	return {
		eventId: "evt_1",
		tenantKey: "tenant_1",
		createTime: "1700000000000",
		sender: { sender_id: { open_id: USER_OPEN_ID }, sender_type: "user" },
		message: {
			message_id: "om_1",
			chat_id: "oc_chat",
			chat_type: "group",
			message_type: "text",
			content: JSON.stringify({ text: "@_user_1 do the thing" }),
			mentions: [
				{ key: "@_user_1", id: { open_id: BOT_OPEN_ID }, name: "Cyrus" },
			],
			...messageOverrides,
		},
	};
}

describe("normalizeFeishuMessageEvent", () => {
	it("classifies a group @mention of the bot as a mention", () => {
		const r = normalizeFeishuMessageEvent(input(), {
			getBotOpenId: () => BOT_OPEN_ID,
		});
		expect("event" in r).toBe(true);
		if (!("event" in r)) return;
		expect(r.event.eventType).toBe("mention");
		expect(r.event.payload.chatId).toBe("oc_chat");
		expect(r.event.payload.text).toBe("@Cyrus do the thing");
		expect(r.event.eventId).toBe("evt_1");
		expect(r.event.tenantKey).toBe("tenant_1");
		expect(r.event.payload.createTime).toBe("1700000000000");
	});

	it("classifies a p2p message as a mention even without @", () => {
		const r = normalizeFeishuMessageEvent(
			input({ chat_type: "p2p", mentions: undefined }),
			{ getBotOpenId: () => BOT_OPEN_ID },
		);
		expect("event" in r && r.event.eventType).toBe("mention");
	});

	it("classifies a threaded non-mention as a plain message", () => {
		const r = normalizeFeishuMessageEvent(
			input({
				message_id: "om_2",
				root_id: "om_1",
				thread_id: "omt_x",
				mentions: undefined,
				content: JSON.stringify({ text: "follow up" }),
			}),
			{ getBotOpenId: () => BOT_OPEN_ID },
		);
		expect("event" in r && r.event.eventType).toBe("message");
	});

	it("ignores the bot's own (app) messages", () => {
		const r = normalizeFeishuMessageEvent(
			{
				eventId: "e",
				tenantKey: "t",
				createTime: "0",
				sender: { sender_type: "app", sender_id: { open_id: BOT_OPEN_ID } },
				message: input().message,
			},
			{ getBotOpenId: () => BOT_OPEN_ID },
		);
		expect("ignored" in r).toBe(true);
	});

	it("ignores a top-level (non-threaded) plain message", () => {
		const r = normalizeFeishuMessageEvent(
			input({ mentions: undefined, content: JSON.stringify({ text: "hi" }) }),
			{ getBotOpenId: () => BOT_OPEN_ID },
		);
		expect("ignored" in r).toBe(true);
	});

	it("ignores threaded plain messages when thread-following is disabled", () => {
		const r = normalizeFeishuMessageEvent(
			input({
				root_id: "om_1",
				mentions: undefined,
				content: JSON.stringify({ text: "hi" }),
			}),
			{
				getBotOpenId: () => BOT_OPEN_ID,
				isThreadFollowingEnabled: () => false,
			},
		);
		expect("ignored" in r).toBe(true);
	});

	it("without a known bot open_id, treats any group mention as a mention", () => {
		const r = normalizeFeishuMessageEvent(input(), {});
		expect("event" in r && r.event.eventType).toBe("mention");
	});
});

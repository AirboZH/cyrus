import { afterEach, describe, expect, it, vi } from "vitest";
import { FeishuWsClient } from "../src/FeishuWsClient.js";
import type { FeishuWebhookEvent } from "../src/types.js";
import { BOT_OPEN_ID, USER_OPEN_ID } from "./fixtures.js";

// Shared state the mocked SDK writes into (hoisted so the vi.mock factory can see it).
const sdk = vi.hoisted(() => ({
	handlers: {} as Record<string, (data: unknown) => unknown>,
	started: null as unknown,
	closed: false,
	lastConfig: null as unknown,
}));

vi.mock("@larksuiteoapi/node-sdk", () => ({
	Domain: { Feishu: 0, Lark: 1 },
	LoggerLevel: { fatal: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 },
	WSClient: class {
		constructor(config: unknown) {
			sdk.lastConfig = config;
		}
		start(params: unknown) {
			sdk.started = params;
		}
		close() {
			sdk.closed = true;
		}
	},
	EventDispatcher: class {
		register(handles: Record<string, (data: unknown) => unknown>) {
			Object.assign(sdk.handlers, handles);
			return this;
		}
	},
}));

/** A flattened im.message.receive_v1 payload as the SDK hands it to handlers. */
function wsData(overrides: Record<string, unknown> = {}) {
	return {
		event_id: "evt_ws_1",
		tenant_key: "tenant_1",
		create_time: "1700000000000",
		sender: { sender_id: { open_id: USER_OPEN_ID }, sender_type: "user" },
		message: {
			message_id: "om_1",
			chat_id: "oc_chat",
			chat_type: "group",
			message_type: "text",
			content: JSON.stringify({ text: "@_user_1 build a feature" }),
			mentions: [
				{ key: "@_user_1", id: { open_id: BOT_OPEN_ID }, name: "Cyrus" },
			],
			...overrides,
		},
	};
}

describe("FeishuWsClient", () => {
	afterEach(() => {
		sdk.handlers = {};
		sdk.started = null;
		sdk.closed = false;
		sdk.lastConfig = null;
		vi.clearAllMocks();
	});

	function build() {
		const client = new FeishuWsClient({
			appId: "cli_app",
			appSecret: "secret",
			getBotOpenId: () => BOT_OPEN_ID,
		});
		client.start();
		const handler = sdk.handlers["im.message.receive_v1"];
		return { client, handler };
	}

	it("registers an im.message.receive_v1 handler and starts the WS", () => {
		const { handler } = build();
		expect(typeof handler).toBe("function");
		expect(sdk.started).not.toBeNull();
		expect((sdk.lastConfig as { appId: string }).appId).toBe("cli_app");
	});

	it("emits event + message for a mention", async () => {
		const { client, handler } = build();
		const eventListener = vi.fn();
		const messageListener = vi.fn();
		client.on("event", eventListener);
		client.on("message", messageListener);

		await handler(wsData());

		expect(eventListener).toHaveBeenCalledTimes(1);
		const emitted = eventListener.mock.calls[0][0] as FeishuWebhookEvent;
		expect(emitted.eventType).toBe("mention");
		expect(emitted.eventId).toBe("evt_ws_1");
		expect(emitted.payload.chatId).toBe("oc_chat");
		expect(emitted.payload.text).toBe("@Cyrus build a feature");
		expect(messageListener).toHaveBeenCalledTimes(1);
	});

	it("de-duplicates a redelivered event_id", async () => {
		const { client, handler } = build();
		const eventListener = vi.fn();
		client.on("event", eventListener);
		await handler(wsData());
		await handler(wsData());
		expect(eventListener).toHaveBeenCalledTimes(1);
	});

	it("drops the bot's own messages", async () => {
		const { client, handler } = build();
		const eventListener = vi.fn();
		client.on("event", eventListener);
		await handler(
			wsData({
				// bot-authored
			}),
		);
		// override sender to be the app/bot itself via a fresh payload
		eventListener.mockClear();
		await handler({
			event_id: "evt_ws_bot",
			tenant_key: "t",
			create_time: "0",
			sender: { sender_type: "app", sender_id: { open_id: BOT_OPEN_ID } },
			message: wsData().message,
		});
		expect(eventListener).not.toHaveBeenCalled();
	});

	it("close() closes the underlying WS", () => {
		const { client } = build();
		client.close();
		expect(sdk.closed).toBe(true);
	});
});

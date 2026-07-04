/**
 * Shared normalization of a Feishu `im.message.receive_v1` event into a
 * {@link FeishuWebhookEvent}.
 *
 * Both delivery paths reuse this: the webhook transport (which decrypts +
 * verifies then hands over `header`/`event`) and the long-connection WS client
 * (where the SDK flattens header + event fields to the top level). Keeping the
 * classification + structural filtering in one place means the two transports
 * can never diverge on "what counts as a mention" or "which messages to drop".
 */

import { decodeFeishuContent } from "./FeishuMessageTranslator.js";
import type {
	FeishuEventPayload,
	FeishuEventType,
	FeishuMessageReceiveEvent,
	FeishuWebhookEvent,
} from "./types.js";

/** Header + event fields needed to normalize a message-receive event. */
export interface FeishuMessageEventInput {
	/** Unique event id (`header.event_id`) */
	eventId: string;
	/** Tenant key (`header.tenant_key`) */
	tenantKey: string;
	/** Event create_time (ms epoch string, `header.create_time`) */
	createTime: string;
	/** Sender info (`event.sender`) */
	sender?: FeishuMessageReceiveEvent["sender"];
	/** Message body (`event.message`) */
	message?: FeishuMessageReceiveEvent["message"];
}

export interface FeishuNormalizeOptions {
	/** Live read of the bot's own open_id (for mention detection + self-drop). */
	getBotOpenId?: () => string | undefined;
	/** Live predicate: follow plain (non-@mention) thread messages? */
	isThreadFollowingEnabled?: () => boolean;
	/** Whether this event arrived via an upstream gate (proxy mode). */
	upstreamGated?: boolean;
}

/** Result of normalization: either an event to emit, or a reason it was dropped. */
export type FeishuNormalizeResult =
	| { event: FeishuWebhookEvent }
	| { ignored: string };

/**
 * Classify + normalize a message-receive event. Returns `{ ignored }` for the
 * bot's own messages, disabled thread-following, and non-threaded plain
 * messages; otherwise `{ event }`.
 */
export function normalizeFeishuMessageEvent(
	input: FeishuMessageEventInput,
	opts: FeishuNormalizeOptions = {},
): FeishuNormalizeResult {
	const message = input.message;
	if (!message) {
		return { ignored: "no message body" };
	}

	// Drop the bot's own / app-authored messages to avoid loops.
	const senderType = input.sender?.sender_type;
	const senderOpenId = input.sender?.sender_id?.open_id;
	const botOpenId = opts.getBotOpenId?.();
	if (
		senderType === "app" ||
		(botOpenId && senderOpenId && senderOpenId === botOpenId)
	) {
		return { ignored: "message authored by the bot itself" };
	}

	const chatType = message.chat_type ?? "group";
	const mentions = message.mentions ?? [];
	const botMentioned =
		chatType === "p2p" ||
		(botOpenId
			? mentions.some((m) => m.id?.open_id === botOpenId)
			: mentions.length > 0);
	const eventType: FeishuEventType = botMentioned ? "mention" : "message";

	// Thread-following kill-switch: drop plain messages when disabled.
	if (
		eventType === "message" &&
		opts.isThreadFollowingEnabled &&
		!opts.isThreadFollowingEnabled()
	) {
		return { ignored: "thread-following disabled" };
	}

	// Plain follow-ups only matter inside a thread the bot may be bound to.
	if (
		eventType === "message" &&
		!message.root_id &&
		!message.thread_id &&
		!message.parent_id
	) {
		return { ignored: "non-threaded plain message" };
	}

	const rawContent = message.content ?? "";
	const messageType = message.message_type ?? "text";
	const payload: FeishuEventPayload = {
		type: eventType,
		user: senderOpenId ?? "",
		text: decodeFeishuContent(messageType, rawContent, mentions),
		rawContent,
		messageType,
		messageId: message.message_id,
		chatId: message.chat_id,
		chatType,
		rootId: message.root_id,
		parentId: message.parent_id,
		threadId: message.thread_id,
		createTime: input.createTime || message.create_time || "0",
		mentions,
	};

	const event: FeishuWebhookEvent = {
		eventType,
		eventId: input.eventId,
		payload,
		tenantKey: input.tenantKey,
		upstreamGated: opts.upstreamGated,
	};

	return { event };
}

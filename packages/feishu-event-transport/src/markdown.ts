/**
 * Heuristic detection of Markdown syntax in a piece of text.
 *
 * Feishu renders plain-text messages (`msg_type: "text"`) literally — it does
 * NOT interpret Markdown — while interactive cards render a Markdown subset. To
 * avoid wrapping every trivial reply (e.g. a bare "你好") in a card, callers use
 * {@link containsMarkdown} to decide whether a reply actually needs the card
 * path or can go out as an ordinary text bubble.
 *
 * The detection is deliberately conservative: it favors treating suspected
 * Markdown as Markdown, but tries hard not to misclassify obviously plain text
 * (isolated `*`/`_`, arithmetic minus, snake_case identifiers, version numbers)
 * as Markdown.
 */

/**
 * Ordered set of patterns, each matching one family of Markdown syntax. None
 * carry the global flag, so `.test()` is stateless and safe to reuse.
 */
const MARKDOWN_PATTERNS: readonly RegExp[] = [
	// Bold: **text** (non-empty, no leading space inside the markers)
	/\*\*(?=\S)[^*\n]*\*\*/,
	// Strikethrough: ~~text~~
	/~~(?=\S)[^~\n]*~~/,
	// Italic with asterisks: *text* — not part of ** and not "a * b" arithmetic
	/(?<![*\w])\*(?=\S)[^*\n]+?\*(?![*\w])/,
	// Emphasis with underscores: _text_ — bounded by non-word chars so
	// snake_case identifiers (function_name) do NOT trigger.
	/(?<!\w)_(?=\S)[^_\n]+?_(?!\w)/,
	// ATX headings: line starting with # .. ######
	/^#{1,6}\s/m,
	// Unordered list item: line start `- ` / `* ` / `+ ` (space required, so a
	// bare "-3" or arithmetic "5 - 3" mid-line does not match)
	/^\s*[-*+]\s+\S/m,
	// Ordered list item: line start `1. ` (space required, so "1.0" does not match)
	/^\s*\d+\.\s+\S/m,
	// Blockquote: line start `>` optionally followed by a space then content
	/^\s*>\s?\S/m,
	// Horizontal rule / divider: a line of only ---, ***, or ___ (3+)
	/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m,
	// Link: [text](url)
	/\[[^\]\n]+\]\([^)\n]+\)/,
	// Fenced code block: ```
	/```/,
	// Inline code: `code`
	/`[^`\n]+`/,
];

/**
 * Return `true` when `text` appears to contain Markdown syntax that Feishu can
 * only render via an interactive card. Returns `false` for plain text (including
 * Chinese prose, punctuation, and isolated `*` / `_` / `-` characters).
 */
export function containsMarkdown(text: string): boolean {
	if (!text) return false;
	return MARKDOWN_PATTERNS.some((pattern) => pattern.test(text));
}

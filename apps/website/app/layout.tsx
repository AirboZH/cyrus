import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
	title: "Xight — 你的 AI 产研搭档",
	description:
		"在飞书或 Linear 里说一句话，Xight 独立完成开发、自测并提交成果，做完了主动来叫你。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="zh-CN">
			<body>{children}</body>
		</html>
	);
}

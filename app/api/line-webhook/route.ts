import { messagingApi, validateSignature, type WebhookEvent } from "@line/bot-sdk";
import { NextResponse } from "next/server";

import { getGeminiReply } from "@/lib/gemini";
import { getFaqPromptText } from "@/lib/sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_REPLY =
  "ขออภัยในความไม่สะดวกด้วยนะครับ/ค่ะ ผมเป็นเพียง Bot ตอบข้อความอัตโนมัติ 🤖 และยังไม่มีการบันทึกข้อมูลในส่วนนี้ อีกสักครู่จะมี Admin หน้าตาหล่อ/สวยมาตอบในไม่ช้าครับ/ค่ะ";

const REPLY_TIMEOUT_MS = 8_500;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function buildReplyText(userMessage: string): Promise<string> {
  try {
    const faq = await getFaqPromptText();
    return await getGeminiReply({ faq, question: userMessage });
  } catch (error) {
    console.error("Failed to build reply", error);
    return DEFAULT_REPLY;
  }
}

async function withReplyTimeout(replyPromise: Promise<string>): Promise<string> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<string>((resolve) => {
    timeoutId = setTimeout(() => {
      console.error("Timed out while building LINE reply");
      resolve(DEFAULT_REPLY);
    }, REPLY_TIMEOUT_MS);
  });

  try {
    return await Promise.race([replyPromise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function handleEvent(
  event: WebhookEvent,
  client: messagingApi.MessagingApiClient,
): Promise<void> {
  if (
    event.type !== "message" ||
    event.message.type !== "text" ||
    !("replyToken" in event)
  ) {
    return;
  }

  const replyText = await withReplyTimeout(buildReplyText(event.message.text));

  try {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text: replyText }],
    });
  } catch (error) {
    console.error("Failed to reply LINE message", error);
  }
}

export async function POST(request: Request) {
  let channelSecret: string;
  let channelAccessToken: string;

  try {
    channelSecret = getRequiredEnv("LINE_CHANNEL_SECRET");
    channelAccessToken = getRequiredEnv("LINE_CHANNEL_ACCESS_TOKEN");
  } catch (error) {
    console.error(error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const signature = request.headers.get("x-line-signature") ?? "";
  const body = await request.text();

  if (!validateSignature(body, channelSecret, signature)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let events: WebhookEvent[];
  try {
    const payload = JSON.parse(body) as { events?: WebhookEvent[] };
    events = Array.isArray(payload.events) ? payload.events : [];
  } catch (error) {
    console.error("Invalid LINE webhook payload", error);
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const client = new messagingApi.MessagingApiClient({ channelAccessToken });
  await Promise.all(events.map((event) => handleEvent(event, client)));

  return NextResponse.json({ ok: true });
}

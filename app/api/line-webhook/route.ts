import { messagingApi, validateSignature, type WebhookEvent } from "@line/bot-sdk";
import { NextResponse } from "next/server";

import { getGeminiReply } from "@/lib/gemini";
import { findFaqMatch, getFaqData } from "@/lib/sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_REPLY =
  "ขออภัยในความไม่สะดวกด้วยนะครับ/ค่ะ ผมเป็นเพียง Bot ตอบข้อความอัตโนมัติ 🤖 และยังไม่มีการบันทึกข้อมูลในส่วนนี้ อีกสักครู่จะมี Admin หน้าตาหล่อ/สวยมาตอบในไม่ช้าครับ/ค่ะ";

const GREETING_HELP_REPLY =
  "👋 สวัสดีครับ/ค่ะ\n\nฝ่ายพัฒนาทรัพยากรบุคคล ยินดีให้คำแนะนำและตอบข้อซักถามครับ/ค่ะ 😊\n\n📌 กรุณาพิมพ์คำถามที่ต้องการสอบถามมาได้เลยครับ/ค่ะ";

const REPLY_TIMEOUT_MS = 8_500;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeIncomingText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[!！?？.。…~～\s]+$/g, "")
    .replace(/\s+/g, " ");
}

function stripPoliteSuffix(text: string): string {
  let normalized = text;
  let changed = true;

  while (changed) {
    const next = normalized.replace(/(ครับ|ค่ะ|คะ|ฮะ|จ้า|จ๊ะ|จ๋า)$/u, "").trim();
    changed = next !== normalized;
    normalized = next;
  }

  return normalized;
}

function isGreetingOnly(text: string): boolean {
  const normalized = stripPoliteSuffix(normalizeIncomingText(text));
  const greetingOnlyTexts = new Set(["สวัสดี", "หวัดดี", "hello", "hi"]);

  return greetingOnlyTexts.has(normalized);
}

function isVagueInquiryOnly(text: string): boolean {
  const normalized = stripPoliteSuffix(normalizeIncomingText(text));

  if (normalized.includes("เรื่อง") || normalized.includes("เกี่ยวกับ")) {
    return false;
  }

  const vagueInquiryOnlyTexts = new Set([
    "ขอสอบถามข้อมูล",
    "ขอสอบถาม",
    "สอบถาม",
    "สอบถามข้อมูล",
    "อยากสอบถาม",
  ]);

  return vagueInquiryOnlyTexts.has(normalized);
}

async function buildReplyText(userMessage: string): Promise<string> {
  try {
    const faq = await getFaqData();
    const matchedFaq = findFaqMatch(userMessage, faq.items);

    if (matchedFaq) {
      console.log("[sheet] direct answer preview:", matchedFaq.answer.slice(0, 500));
      return matchedFaq.answer;
    }

    return await getGeminiReply({ faq: faq.text, question: userMessage });
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
  if (event.type !== "message" || !("replyToken" in event)) {
    return;
  }

  let replyText: string | null = null;

  if (event.message.type === "sticker") {
    console.log("[line] sticker message");
    replyText = GREETING_HELP_REPLY;
  } else if (event.message.type === "text") {
    const userMessage = event.message.text.trim();
    console.log("[line] user message:", userMessage);

    if (isGreetingOnly(userMessage) || isVagueInquiryOnly(userMessage)) {
      console.log("[line] greeting/vague inquiry only");
      replyText = GREETING_HELP_REPLY;
    } else {
      replyText = await withReplyTimeout(buildReplyText(userMessage));
    }
  }

  if (!replyText) {
    return;
  }

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

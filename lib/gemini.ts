import { GoogleGenAI } from "@google/genai";

const DEFAULT_REPLY =
  "ขออภัยในความไม่สะดวกด้วยนะครับ/ค่ะ ผมเป็นเพียง Bot ตอบข้อความอัตโนมัติ 🤖 และยังไม่มีการบันทึกข้อมูลในส่วนนี้ อีกสักครู่จะมี Admin หน้าตาหล่อ/สวยมาตอบในไม่ช้าครับ/ค่ะ";

type ReplyInput = {
  faq: string;
  question: string;
};

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function buildPrompt({ faq, question }: ReplyInput): string {
  return `<role>
คุณคือเจ้าหน้าที่ฝ่ายพัฒนาทรัพยากรบุคคล (HRD) ของบริษัทในธุรกิจเสื้อผ้าและแฟชั่น
</role>

<constraints>
ตอบโดยใช้ข้อมูลใน <faq> เท่านั้น
ห้ามแต่งราคา เวลา สถานที่ สวัสดิการ กฎระเบียบ ขั้นตอน หรือข้อมูลบริษัทที่ไม่มีอยู่ใน FAQ
ถ้าคำถามไม่มีข้อมูลใน FAQ ให้ตอบ default_reply เท่านั้น
default_reply คือ:
${DEFAULT_REPLY}

โทนภาษา: กึ่งทางการ กระชับ ตรงประเด็น ข้อมูลครบ
ใช้อิโมจิตามที่มีอยู่ในคำตอบ FAQ ได้ แต่ไม่ต้องเติมเพิ่มเองมากเกินไป
ความยาวคำตอบ: 1-3 ประโยค
</constraints>

<output_format>
ภาษาไทย ไม่ใช้ markdown
</output_format>

<faq>
${faq}
</faq>

<question>
${question}
</question>`;
}

export async function getGeminiReply(input: ReplyInput): Promise<string> {
  const apiKey = getRequiredEnv("GEMINI_API_KEY");
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: buildPrompt(input),
    config: {
      temperature: 1.0,
      maxOutputTokens: 1024,
    },
  });

  const candidate = response.candidates?.[0];
  const finishReason = candidate?.finishReason ?? "UNKNOWN";
  const usageMetadata = response.usageMetadata;

  console.log("Gemini usage", {
    finishReason,
    thoughtsTokenCount: usageMetadata?.thoughtsTokenCount ?? 0,
    candidatesTokenCount: usageMetadata?.candidatesTokenCount ?? 0,
  });

  if (finishReason === "MAX_TOKENS") {
    return DEFAULT_REPLY;
  }

  const text = response.text?.trim();
  if (!text) {
    return DEFAULT_REPLY;
  }

  return text;
}

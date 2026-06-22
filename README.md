# HRD-BOT

LINE bot สำหรับตอบคำถามพนักงานในนามเจ้าหน้าที่ฝ่ายพัฒนาทรัพยากรบุคคล (HRD) โดยใช้ FAQ จาก Google Sheet และ Gemini

## Stack

- Next.js 14 App Router + TypeScript
- Vercel
- LINE Messaging API: `@line/bot-sdk`
- Gemini API: `@google/genai`

## Environment Variables

ตั้งค่า env vars เหล่านี้บน local และ Vercel:

```env
LINE_CHANNEL_ACCESS_TOKEN=
LINE_CHANNEL_SECRET=
GEMINI_API_KEY=
SHEET_CSV_URL=
```

## Webhook

หลัง deploy ให้ตั้ง LINE webhook endpoint เป็น:

```text
https://<production-url>/api/line-webhook
```

## Google Sheet FAQ Schema

ใช้ Google Sheet แบบ publish เป็น CSV public URL โดยมีคอลัมน์:

```csv
category,question,answer
สวัสดิการ,พนักงานลาป่วยได้กี่วัน,พนักงานสามารถลาป่วยได้ตามระเบียบบริษัท โดยต้องแจ้งหัวหน้างานและส่งเอกสารตามที่กำหนด
กฎระเบียบ,เวลาเข้างานคือกี่โมง,เวลาเข้างานให้ยึดตามรอบการทำงานของแต่ละสาขาหรือแผนก
```

## Commands

```bash
npm install
npm run dev
npm run build
```

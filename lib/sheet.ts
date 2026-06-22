type CacheEntry = {
  expiresAt: number;
  text: string;
};

const CACHE_TTL_MS = 60_000;
const FAQ_PREVIEW_LENGTH = 500;

let cache: CacheEntry | null = null;

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    const next = csv[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s*\/\s*/g, "/");
}

function findColumnIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

function assertLooksLikeCsv(csv: string): void {
  const preview = csv.trimStart().slice(0, FAQ_PREVIEW_LENGTH);
  const lowerPreview = preview.toLowerCase();

  if (
    lowerPreview.startsWith("<!doctype html") ||
    lowerPreview.startsWith("<html") ||
    lowerPreview.includes("<head") ||
    lowerPreview.includes("<body")
  ) {
    console.error("[sheet] fetch returned HTML instead of CSV", {
      preview,
    });
    throw new Error("SHEET_CSV_URL returned HTML instead of CSV");
  }
}

function csvToFaqText(csv: string): { rowCount: number; text: string } {
  assertLooksLikeCsv(csv);

  const rows = parseCsv(csv);
  console.log("[sheet] parsed csv rows:", rows.length);

  if (rows.length < 2) {
    console.error("[sheet] faq rows: 0");
    console.error("[sheet] parse failed or no data rows found");
    throw new Error("FAQ sheet has no data rows");
  }

  const headers = rows[0].map(normalizeHeader);
  const categoryIndex = findColumnIndex(headers, ["category", "หมวดหมู่", "หมวด", "ประเภท"]);
  const questionIndex = findColumnIndex(headers, [
    "question",
    "คำถาม",
    "คำถาม/คำสำคัญ",
    "keyword",
    "keywords",
  ]);
  const answerIndex = findColumnIndex(headers, ["answer", "คำตอบ"]);

  if (categoryIndex === -1 || questionIndex === -1 || answerIndex === -1) {
    console.error("[sheet] missing required columns", {
      headers,
      required: {
        category: ["category", "หมวดหมู่", "หมวด", "ประเภท"],
        question: ["question", "คำถาม", "คำถาม/คำสำคัญ"],
        answer: ["answer", "คำตอบ"],
      },
    });
    throw new Error(
      "FAQ sheet must include category, question, answer columns or Thai equivalents",
    );
  }

  const items = rows.slice(1).flatMap((row, index) => {
    const category = row[categoryIndex]?.trim() ?? "";
    const question = row[questionIndex]?.trim() ?? "";
    const answer = row[answerIndex]?.trim() ?? "";

    if (!question || !answer) {
      return [];
    }

    return [
      [
        `FAQ ${index + 1}`,
        `category: ${category || "-"}`,
        `question: ${question}`,
        `answer: ${answer}`,
      ].join("\n"),
    ];
  });

  if (items.length === 0) {
    console.error("[sheet] faq rows: 0");
    console.error("[sheet] parsed rows but found no usable question and answer rows");
    throw new Error("FAQ sheet has no usable question and answer rows");
  }

  return {
    rowCount: items.length,
    text: items.join("\n\n"),
  };
}

export async function getFaqPromptText(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.text;
  }

  const sheetCsvUrl = process.env.SHEET_CSV_URL;
  if (!sheetCsvUrl) {
    throw new Error("Missing required environment variable: SHEET_CSV_URL");
  }

  const response = await fetch(sheetCsvUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch FAQ sheet: ${response.status} ${response.statusText}`);
  }

  const csv = await response.text();
  console.log("[sheet] fetch ok", {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "unknown",
    bytes: csv.length,
  });
  console.log("[sheet] faq preview:", csv.slice(0, FAQ_PREVIEW_LENGTH));

  const { rowCount, text } = csvToFaqText(csv);
  console.log("[sheet] faq rows:", rowCount);

  cache = {
    expiresAt: now + CACHE_TTL_MS,
    text,
  };

  return text;
}

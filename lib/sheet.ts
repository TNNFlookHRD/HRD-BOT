type CacheEntry = {
  expiresAt: number;
  text: string;
};

const CACHE_TTL_MS = 60_000;

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
  return value.trim().toLowerCase();
}

function csvToFaqText(csv: string): string {
  const rows = parseCsv(csv);
  if (rows.length < 2) {
    throw new Error("FAQ sheet has no data rows");
  }

  const headers = rows[0].map(normalizeHeader);
  const categoryIndex = headers.indexOf("category");
  const questionIndex = headers.indexOf("question");
  const answerIndex = headers.indexOf("answer");

  if (categoryIndex === -1 || questionIndex === -1 || answerIndex === -1) {
    throw new Error("FAQ sheet must include category, question, answer columns");
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
        `รายการที่ ${index + 1}`,
        `หมวดหมู่: ${category || "-"}`,
        `คำถาม: ${question}`,
        `คำตอบ: ${answer}`,
      ].join("\n"),
    ];
  });

  if (items.length === 0) {
    throw new Error("FAQ sheet has no usable question and answer rows");
  }

  return items.join("\n\n");
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
  const text = csvToFaqText(csv);
  cache = {
    expiresAt: now + CACHE_TTL_MS,
    text,
  };

  return text;
}

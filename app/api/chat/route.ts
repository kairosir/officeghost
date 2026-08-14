import { generateText } from "ai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type IncomingMessage = { role: "user" | "assistant"; content: string };

const buckets = new Map<string, { count: number; resetAt: number }>();

function cors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Headers", "content-type, x-officeghost-client");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  return response;
}

export function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function POST(request: NextRequest) {
  if (request.headers.get("x-officeghost-client") !== "desktop") {
    return cors(NextResponse.json({ error: "Недоступно" }, { status: 403 }));
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (bucket && bucket.resetAt > now && bucket.count >= 30) {
    return cors(NextResponse.json({ error: "Слишком много запросов. Попробуйте через минуту." }, { status: 429 }));
  }
  buckets.set(ip, bucket && bucket.resetAt > now ? { ...bucket, count: bucket.count + 1 } : { count: 1, resetAt: now + 60_000 });

  try {
    const body = await request.json() as { prompt?: string; history?: IncomingMessage[] };
    const prompt = String(body.prompt || "").slice(0, 48_000).trim();
    if (!prompt) return cors(NextResponse.json({ error: "Пустой запрос" }, { status: 400 }));

    const history = Array.isArray(body.history)
      ? body.history.slice(-20).map((message) => ({
          role: message.role === "assistant" ? "assistant" as const : "user" as const,
          content: String(message.content || "").slice(0, 4_000),
        }))
      : [];

    const { text } = await generateText({
      model: "google/gemini-2.5-flash-lite",
      system: "Ты OfficeGhost — дружелюбный помощник для работы с документами. Учитывай историю диалогов. Если дан контекст файлов, отвечай только по нему, называй релевантные файлы и кратко объясняй смысл найденного. Не выдумывай содержимое файлов. Отвечай на языке пользователя, ясно и без лишних заголовков.",
      messages: [...history, { role: "user", content: prompt }],
      maxOutputTokens: 900,
      temperature: 0.2,
      providerOptions: {
        gateway: { tags: ["app:officeghost", "feature:document-chat"] },
      },
    });

    return cors(NextResponse.json({ answer: text, provider: "officeghost-cloud" }));
  } catch (error) {
    console.error("OfficeGhost cloud AI error", error);
    return cors(NextResponse.json({ error: "Облачный ИИ временно недоступен" }, { status: 503 }));
  }
}

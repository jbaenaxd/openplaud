import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { pollTelegramUpdates } from "@/lib/telegram/bot";

// Track polling status globally in this runtime
let isPollingStarted = false;

export async function GET() {
    if (!env.TELEGRAM_BOT_TOKEN) {
        return NextResponse.json({ status: "Telegram bot not configured" });
    }

    if (isPollingStarted) {
        return NextResponse.json({ status: "Polling already active" });
    }

    // Start polling in background (don't await)
    isPollingStarted = true;
    pollTelegramUpdates().catch((err) => {
        console.error("Critical Telegram Polling Error:", err);
        isPollingStarted = false;
    });

    return NextResponse.json({ status: "Telegram polling started" });
}

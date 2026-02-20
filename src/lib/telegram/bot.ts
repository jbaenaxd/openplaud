import { nanoid } from "nanoid";
import { db } from "@/db";
import { recordings, users, userSettings } from "@/db/schema";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { env } from "@/lib/env";
import { eq } from "drizzle-orm";

/**
 * Very basic Telegram Bot implementation using direct API calls to avoid extra dependencies.
 * This handles polling and processing voice/audio messages.
 */

interface TelegramUpdate {
    update_id: number;
    message?: {
        message_id: number;
        from?: {
            id: number;
            username?: string;
        };
        chat: {
            id: number;
        };
        date: number;
        text?: string;
        voice?: {
            file_id: string;
            duration: number;
            mime_type?: string;
            file_size?: number;
        };
        audio?: {
            file_id: string;
            duration: number;
            mime_type?: string;
            file_size?: number;
            file_name?: string;
        };
    };
}

async function tg(method: string, body: any = {}) {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return response.json();
}

async function downloadFile(fileId: string): Promise<Buffer> {
    const fileInfo = await tg('getFile', { file_id: fileId });
    if (!fileInfo.ok) throw new Error(`Failed to get file info: ${fileInfo.description}`);
    
    const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`;
    const response = await fetch(fileUrl);
    return Buffer.from(await response.arrayBuffer());
}

export async function pollTelegramUpdates() {
    if (!env.TELEGRAM_BOT_TOKEN) return;

    // We store the last update ID in a global variable or file to avoid processing same updates.
    // For simplicity in this background worker, we'll just track it in memory.
    let lastUpdateId = 0;

    console.log("🤖 Starting Telegram Polling...");

    // Get the first user to assign recordings to (as a fallback or if configured)
    // In a real multi-user scenario, we'd map Telegram ID to OpenPlaud user ID.
    const allowedUsers = env.TELEGRAM_ALLOWED_USERS?.split(',').map(s => s.trim()) || [];

    while (true) {
        try {
            const result = await tg('getUpdates', {
                offset: lastUpdateId + 1,
                timeout: 30,
                allowed_updates: ['message']
            });

            if (result.ok && result.result.length > 0) {
                for (const update of result.result as TelegramUpdate[]) {
                    lastUpdateId = update.update_id;
                    
                    const message = update.message;
                    if (!message || !message.from) continue;

                    // Check if user is allowed
                    if (allowedUsers.length > 0 && !allowedUsers.includes(message.from.id.toString())) {
                        console.log(`🚫 Unauthorized Telegram user: ${message.from.id}`);
                        continue;
                    }

                    const audio = message.voice || message.audio;
                    if (audio) {
                        console.log(`📥 Received audio from Telegram user ${message.from.id}`);
                        
                        // Find the user in our DB (matching by some criteria or just the first user for now)
                        // TODO: Implement proper Telegram ID mapping in schema
                        const [targetUser] = await db.select().from(users).limit(1);
                        if (!targetUser) continue;

                        try {
                            const buffer = await downloadFile(audio.file_id);
                            const storageProvider = await createUserStorageProvider(targetUser.id);
                            
                            const recordingId = nanoid();
                            const timestamp = new Date(message.date * 1000);
                            const filename = (audio as any).file_name || `telegram-${recordingId}.ogg`;
                            const storageKey = `telegram/${targetUser.id}/${timestamp.getTime()}-${filename}`;
                            
                            const storagePath = await storageProvider.uploadFile(
                                storageKey,
                                buffer,
                                audio.mime_type || 'audio/ogg'
                            );

                            await db.insert(recordings).values({
                                id: recordingId,
                                userId: targetUser.id,
                                deviceSn: "TELEGRAM",
                                plaudFileId: `tg-${audio.file_id}`,
                                filename: filename,
                                duration: (audio.duration || 0) * 1000,
                                startTime: timestamp,
                                endTime: timestamp,
                                filesize: audio.file_size || buffer.length,
                                fileMd5: "",
                                storageType: env.DEFAULT_STORAGE_TYPE || "local",
                                storagePath: storagePath,
                                downloadedAt: new Date(),
                                plaudVersion: "1.0.0",
                            });

                            console.log(`✅ Telegram recording saved: ${recordingId}`);
                            
                            await tg('sendMessage', {
                                chat_id: message.chat.id,
                                text: "✅ Recording received and saved to OpenPlaud!",
                                reply_to_message_id: message.message_id
                            });
                        } catch (err) {
                            console.error("❌ Error processing Telegram audio:", err);
                        }
                    }
                }
            }
        } catch (error) {
            console.error("❌ Telegram polling error:", error);
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retry
        }
    }
}

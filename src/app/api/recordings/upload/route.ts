import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createUserStorageProvider } from "@/lib/storage/factory";
import { env } from "@/lib/env";

export async function POST(request: Request) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const formData = await request.formData();
        const file = formData.get("file") as File;

        if (!file) {
            return NextResponse.json(
                { error: "No file uploaded" },
                { status: 400 },
            );
        }

        // Validate file type
        if (!file.type.startsWith("audio/")) {
            // Check extension as fallback
            const validExtensions = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'];
            const hasValidExtension = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
            
            if (!hasValidExtension) {
                return NextResponse.json(
                    { error: "Only audio files are allowed" },
                    { status: 400 },
                );
            }
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const storageProvider = await createUserStorageProvider(session.user.id);
        
        // Generate a unique ID for the recording
        const recordingId = nanoid();
        const timestamp = new Date();
        
        // Use a standard naming convention for uploaded files
        const fileExtension = file.name.split('.').pop() || 'mp3';
        const storageKey = `manual/${session.user.id}/${timestamp.getTime()}-${file.name}`;
        
        // Upload to storage
        const storagePath = await storageProvider.uploadFile(
            storageKey,
            buffer,
            file.type || 'audio/mpeg'
        );

        // Estimate duration if possible (optional, set to 0 for now as it requires parsing audio)
        // In a real scenario, we might use a library like music-metadata to get actual duration
        const duration = 0; 

        // Register in database
        const [newRecording] = await db
            .insert(recordings)
            .values({
                id: recordingId,
                userId: session.user.id,
                deviceSn: "MANUAL",
                plaudFileId: `manual-${recordingId}`,
                filename: file.name,
                duration: duration,
                startTime: timestamp,
                endTime: timestamp,
                filesize: file.size,
                fileMd5: "", // Optional for manual
                storageType: env.DEFAULT_STORAGE_TYPE || "local",
                storagePath: storagePath,
                downloadedAt: timestamp,
                plaudVersion: "1.0.0",
            })
            .returning();

        return NextResponse.json({ 
            success: true, 
            recording: newRecording 
        });
    } catch (error) {
        console.error("Error uploading recording:", error);
        return NextResponse.json(
            { error: "Failed to upload recording" },
            { status: 500 },
        );
    }
}

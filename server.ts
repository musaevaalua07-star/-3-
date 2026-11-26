import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Allowed prebuilt voices for Gemini 3.8 TTS
const ALLOWED_VOICES = new Set(['Charon', 'Kore', 'Puck', 'Fenrir', 'Zephyr']);

// Persistent disk + in-memory cache so generated WAVs survive restarts and never re-use quota
const CACHE_DIR = path.resolve(__dirname, '.cache', 'tts');
const ttsMemoryCache = new Map<string, Buffer>();

// Ordered list of Gemini 3.8 TTS models (independent per-model quotas)
const TTS_MODELS = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'] as const;

// Per-model cooldown timestamps after receiving 429 RESOURCE_EXHAUSTED
const modelCooldownUntil = new Map<string, number>();

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCacheHash(voiceName: string, text: string): string {
  return crypto.createHash('sha256').update(`${voiceName}:${text}`).digest('hex');
}

function readCachedWav(hash: string): Buffer | null {
  const mem = ttsMemoryCache.get(hash);
  if (mem) return mem;
  const filePath = path.join(CACHE_DIR, `${hash}.wav`);
  if (fs.existsSync(filePath)) {
    try {
      const buf = fs.readFileSync(filePath);
      if (buf.length > 44) {
        ttsMemoryCache.set(hash, buf);
        return buf;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function writeCachedWav(hash: string, wavBuffer: Buffer): void {
  if (ttsMemoryCache.size > 40) {
    const firstKey = ttsMemoryCache.keys().next().value;
    if (firstKey) ttsMemoryCache.delete(firstKey);
  }
  ttsMemoryCache.set(hash, wavBuffer);
  try {
    ensureCacheDir();
    fs.writeFileSync(path.join(CACHE_DIR, `${hash}.wav`), wavBuffer);
  } catch {
    // Non-fatal if filesystem cache cannot be written
  }
}

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY орта айнымалысы орнатылмаған.');
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractApiStatus(err: unknown): { status: number; isQuota: boolean; isAuth: boolean } {
  const anyErr = err as { status?: number; code?: number; message?: string };
  const msg = typeof anyErr?.message === 'string' ? anyErr.message : String(err ?? '');
  const statusNum = Number(anyErr?.status || anyErr?.code || 0);

  const isQuota =
    statusNum === 429 ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('"code":429') ||
    msg.toLowerCase().includes('quota');

  const isAuth =
    statusNum === 403 ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('API_KEY_INVALID') ||
    msg.includes('GEMINI_API_KEY');

  return {
    status: isQuota ? 429 : isAuth ? 403 : statusNum >= 400 && statusNum < 600 ? statusNum : 500,
    isQuota,
    isAuth,
  };
}

/**
 * Wraps raw 24kHz mono 16-bit PCM in a standard 44-byte RIFF/WAV header if needed.
 * Unary Gemini 3.8 TTS normally returns a complete RIFF WAV, so this is a safe guard.
 */
function ensureWavBuffer(rawBuffer: Buffer, mimeType?: string): Buffer {
  const hasRiffHeader =
    rawBuffer.length >= 12 &&
    rawBuffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    rawBuffer.subarray(8, 12).toString('ascii') === 'WAVE';

  if (hasRiffHeader) {
    return rawBuffer;
  }

  // Only wrap if mimeType indicates raw PCM / L16
  if (!mimeType || mimeType.toLowerCase().includes('pcm') || mimeType.toLowerCase().includes('l16')) {
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = rawBuffer.length;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    return Buffer.concat([header, rawBuffer]);
  }

  return rawBuffer;
}

async function generateKazakhSpeechWav(
  model: string,
  text: string,
  voiceName: string
): Promise<Buffer> {
  const ai = getGenAIClient();
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text,
            speechMetadata: {
              style:
                'Clear, expressive Kazakh science documentary narrator, natural Kazakh pronunciation, calm authoritative pace',
            },
          },
        ],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  const base64Audio = inlineData?.data;

  if (!base64Audio) {
    throw new Error('TTS моделі аудио деректерді қайтармады.');
  }

  return ensureWavBuffer(Buffer.from(base64Audio, 'base64'), inlineData?.mimeType);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // POST /api/tts — Synthesize Kazakh documentary narration via Gemini 3.8 TTS
  app.post('/api/tts', async (req, res) => {
    try {
      const rawText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const rawVoice = typeof req.body?.voiceName === 'string' ? req.body.voiceName : 'Charon';

      if (!rawText || rawText.length > 1200) {
        res.status(400).json({
          code: 'INVALID_INPUT',
          error: 'Дыбыстау мәтіні бос немесе тым ұзын (максимум 1200 таңба).',
        });
        return;
      }

      const voiceName = ALLOWED_VOICES.has(rawVoice) ? rawVoice : 'Charon';
      const cacheHash = getCacheHash(voiceName, rawText);

      // 1. Always serve from persistent disk/memory cache first (uses zero API quota)
      const cached = readCachedWav(cacheHash);
      if (cached) {
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(cached);
        return;
      }

      // 2. Try available Gemini 3.8 TTS models (skipping any currently in 429 cooldown)
      const now = Date.now();
      const availableModels = TTS_MODELS.filter((m) => (modelCooldownUntil.get(m) ?? 0) <= now);

      if (availableModels.length === 0) {
        res.status(429).json({
          code: 'QUOTA_EXHAUSTED',
          error:
            'Gemini TTS тегін күндік лимиті таусылды. Квотаны арттыру үшін Settings > Secrets бөлімінде биллинг қосылған API кілтін таңдаңыз немесе браузер дикторын қолданыңыз.',
        });
        return;
      }

      let wavBuffer: Buffer | null = null;
      let lastErr: unknown = null;
      let allQuota = true;

      for (const model of availableModels) {
        try {
          wavBuffer = await generateKazakhSpeechWav(model, rawText, voiceName);
          break;
        } catch (err) {
          lastErr = err;
          const info = extractApiStatus(err);
          if (info.isQuota) {
            // Cool down only this exhausted model and fail over to the next Gemini TTS model
            modelCooldownUntil.set(model, Date.now() + 10 * 60 * 1000);
            continue;
          }
          allQuota = false;
          if (info.status >= 400 && info.status < 500) {
            break; // Never retry 400/403 client or auth errors
          }
          // Transient 5xx: retry once on the same model
          await new Promise((r) => setTimeout(r, 450));
          try {
            wavBuffer = await generateKazakhSpeechWav(model, rawText, voiceName);
            break;
          } catch (retryErr) {
            lastErr = retryErr;
            const retryInfo = extractApiStatus(retryErr);
            if (retryInfo.isQuota) {
              modelCooldownUntil.set(model, Date.now() + 10 * 60 * 1000);
            }
          }
        }
      }

      if (!wavBuffer) {
        if (allQuota && lastErr) {
          res.status(429).json({
            code: 'QUOTA_EXHAUSTED',
            error:
              'Gemini TTS тегін күндік лимиті таусылды. Квотаны арттыру үшін Settings > Secrets бөлімінде биллинг қосылған API кілтін таңдаңыз немесе браузер дикторын қолданыңыз.',
          });
          return;
        }
        throw lastErr ?? new Error('Дыбыстауды жасау сәтсіз аяқталды.');
      }

      writeCachedWav(cacheHash, wavBuffer);

      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(wavBuffer);
    } catch (err: unknown) {
      const { status, isQuota, isAuth } = extractApiStatus(err);

      if (isQuota) {
        res.status(429).json({
          code: 'QUOTA_EXHAUSTED',
          error:
            'Gemini TTS тегін күндік лимиті таусылды. Квотаны арттыру үшін Settings > Secrets бөлімінде биллинг қосылған API кілтін таңдаңыз немесе браузер дикторын қолданыңыз.',
        });
        return;
      }

      if (isAuth) {
        res.status(403).json({
          code: 'AUTH_ERROR',
          error:
            'Gemini API кілті дұрыс орнатылмаған. Settings > Secrets бөлімінен API кілтін тексеріңіз.',
        });
        return;
      }

      console.error('[TTS API Error]:', err);
      const message =
        err instanceof Error ? err.message : 'Қазақша дыбыстау серверінде қате орын алды.';
      res.status(status).json({ code: 'TTS_ERROR', error: message });
    }
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distPath, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Abrasion 3D server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

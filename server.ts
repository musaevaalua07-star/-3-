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

// Cooldown timestamp after receiving a 429 RESOURCE_EXHAUSTED to prevent upstream request spam
let quotaCooldownUntil = 0;

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
      ttsMemoryCache.set(hash, buf);
      return buf;
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

async function generateKazakhSpeechWav(text: string, voiceName: string): Promise<Buffer> {
  const ai = getGenAIClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash-lite-tts',
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

  const base64Audio =
    response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

  if (!base64Audio) {
    throw new Error('TTS моделі аудио деректерді қайтармады.');
  }

  return Buffer.from(base64Audio, 'base64');
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // POST /api/tts — Synthesize Kazakh documentary narration via Gemini 3.8 Flash Lite TTS
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

      // 2. If recently rate-limited (429), respond cleanly without hammering upstream API
      if (Date.now() < quotaCooldownUntil) {
        res.status(429).json({
          code: 'QUOTA_EXHAUSTED',
          error:
            'Gemini TTS тегін күндік лимиті (10 сұраныс) таусылды. Квотаны арттыру үшін Settings > Secrets бөлімінде биллинг қосылған API кілтін таңдаңыз немесе браузер дикторын қолданыңыз.',
        });
        return;
      }

      // 3. Call Gemini TTS (retry ONCE only for transient 5xx/network errors — NEVER on 4xx/429)
      let wavBuffer: Buffer | null = null;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          wavBuffer = await generateKazakhSpeechWav(rawText, voiceName);
          break;
        } catch (err) {
          lastErr = err;
          const info = extractApiStatus(err);
          if (info.status >= 400 && info.status < 500) {
            break; // Never retry 400/403/429 client or quota errors
          }
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      }

      if (!wavBuffer) {
        throw lastErr ?? new Error('Дыбыстауды жасау сәтсіз аяқталды.');
      }

      writeCachedWav(cacheHash, wavBuffer);

      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(wavBuffer);
    } catch (err: unknown) {
      const { status, isQuota, isAuth } = extractApiStatus(err);

      if (isQuota) {
        // Cool down upstream requests for 10 minutes so repeated playback never spams 429
        quotaCooldownUntil = Date.now() + 10 * 60 * 1000;
        res.status(429).json({
          code: 'QUOTA_EXHAUSTED',
          error:
            'Gemini TTS тегін күндік лимиті (10 сұраныс) таусылды. Квотаны арттыру үшін Settings > Secrets бөлімінде биллинг қосылған API кілтін таңдаңыз немесе браузер дикторын қолданыңыз.',
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

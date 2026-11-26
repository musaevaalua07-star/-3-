import { GoogleGenAI } from '@google/genai';
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

// In-memory cache of synthesized WAV buffers so repeated playback is instant
const ttsCache = new Map<string, Buffer>();

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
      const stageId = typeof req.body?.stageId === 'number' ? req.body.stageId : -1;

      if (!rawText || rawText.length > 1200) {
        res.status(400).json({
          error: 'Дыбыстау мәтіні бос немесе тым ұзын (максимум 1200 таңба).',
        });
        return;
      }

      const voiceName = ALLOWED_VOICES.has(rawVoice) ? rawVoice : 'Charon';
      const cacheKey = `${stageId}:${voiceName}:${rawText}`;

      const cached = ttsCache.get(cacheKey);
      if (cached) {
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(cached);
        return;
      }

      // Retry once on transient network/5xx errors
      let wavBuffer: Buffer | null = null;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          wavBuffer = await generateKazakhSpeechWav(rawText, voiceName);
          break;
        } catch (err) {
          lastErr = err;
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 450));
          }
        }
      }

      if (!wavBuffer) {
        throw lastErr ?? new Error('Дыбыстауды жасау сәтсіз аяқталды.');
      }

      // Cap cache size to prevent unbounded memory growth
      if (ttsCache.size > 40) {
        const firstKey = ttsCache.keys().next().value;
        if (firstKey) ttsCache.delete(firstKey);
      }
      ttsCache.set(cacheKey, wavBuffer);

      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(wavBuffer);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Қазақша дыбыстау серверінде қате орын алды.';
      console.error('[TTS API Error]:', err);
      const status =
        message.includes('API_KEY') || message.includes('403') || message.includes('PERMISSION_DENIED')
          ? 503
          : 500;
      res.status(status).json({ error: message });
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

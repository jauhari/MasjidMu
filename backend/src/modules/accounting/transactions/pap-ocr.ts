import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { z } from 'zod';
import { logger } from '../../../lib/logger.js';
import {
  normalizePAPRawRows,
  reconcilePAPReviewRows,
  summarizePAPReviewRows,
  type PAPImportResult,
  type PAPReviewRow,
} from './pap-import.js';

export const PAP_OCR_MODEL = 'claude-opus-4-8';
const ANTHROPIC_API_BASE_URL = 'https://api.anthropic.com';
export const PAP_OCR_MAX_IMAGES = 5;
export const PAP_OCR_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const PAP_OCR_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const PAP_OCR_ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type PAPOCRMediaType = (typeof PAP_OCR_ALLOWED_MEDIA_TYPES)[number];
export type PAPOCRRotation = 0 | 90 | 180 | 270;

export interface PAPOCRImage {
  bytes: Buffer | Uint8Array;
  mediaType: PAPOCRMediaType;
  name?: string;
  rotationDegrees?: PAPOCRRotation;
}

interface NormalizedPAPOCRImage {
  bytes: Buffer;
  mediaType: PAPOCRMediaType;
}

export interface PAPOCRResult {
  rows: PAPReviewRow[];
  totals: PAPImportResult['totals'];
  warnings: string[];
  source: {
    kind: 'ocr';
    fingerprint: string;
    imageCount: number;
  };
  sourceFingerprint: string;
  model: string;
  requestId: string | null;
}

export class PAPOCRError extends Error {}
export class PAPOCRInputError extends PAPOCRError {}
export class PAPOCRConfigurationError extends PAPOCRError {}
export class PAPOCRProviderError extends PAPOCRError {}
export class PAPOCRResponseError extends PAPOCRError {}

const rawRowSchema = z.object({
  date: z.string().nullable(),
  description: z.string(),
  referenceNo: z.string().nullable(),
  income: z.union([z.string(), z.number()]).nullable(),
  expense: z.union([z.string(), z.number()]).nullable(),
  balance: z.union([z.string(), z.number()]).nullable(),
  sourceImage: z.number().int().positive(),
  sourceRow: z.number().int().positive(),
});

const extractionSchema = z.object({ rows: z.array(rawRowSchema) });
type AnthropicClient = Pick<Anthropic, 'messages'>;

export function createPAPOCRClient(apiKey?: string): AnthropicClient {
  if (!apiKey) throw new PAPOCRConfigurationError('ANTHROPIC_API_KEY belum dikonfigurasi');
  return new Anthropic({ apiKey, baseURL: ANTHROPIC_API_BASE_URL });
}

export async function parsePAPImages(
  images: PAPOCRImage[],
  options: { client?: AnthropicClient; apiKey?: string } = {},
): Promise<PAPOCRResult> {
  validateImages(images);
  const client = options.client ?? createPAPOCRClient(options.apiKey ?? process.env.ANTHROPIC_API_KEY);
  const sourceFingerprint = fingerprintImages(images);
  const normalizedImages = await Promise.all(images.map(normalizePAPOCRImage));
  validateNormalizedImages(normalizedImages);
  const imageBlocks: Anthropic.ImageBlockParam[] = normalizedImages.map((image) => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: image.mediaType,
      data: image.bytes.toString('base64'),
    },
  }));

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: PAP_OCR_MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: papOCRJSONSchema } },
      system: [
        {
          type: 'text',
          text: 'Ekstrak tabel PAP persis dari gambar. Jangan menebak, melengkapi, menghitung, atau mengoreksi nilai. Jika sel tidak terbaca atau kosong, gunakan null atau string kosong. Jangan gabungkan baris berbeda. Abaikan header, baris kosong, dan footer total.',
        },
      ],
      messages: [{
        role: 'user',
        content: [
          ...imageBlocks,
          {
            type: 'text',
            text: 'Baca setiap baris transaksi dengan kolom Tanggal, Uraian, No Bukti, Masuk, Keluar, Saldo. sourceImage adalah nomor gambar mulai 1; sourceRow adalah urutan baris transaksi yang terlihat mulai 1 pada gambar tersebut.',
          },
        ],
      }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new PAPOCRConfigurationError('ANTHROPIC_API_KEY ditolak');
    }
    if (error instanceof Anthropic.RateLimitError) {
      logger.warn({ requestId: error.requestID ?? null }, 'PAP OCR rate limited');
      throw new PAPOCRProviderError('layanan OCR sedang dibatasi; coba lagi nanti');
    }
    if (error instanceof Anthropic.BadRequestError) {
      logger.warn({ requestId: error.requestID ?? null, status: error.status }, 'PAP OCR request rejected');
      throw new PAPOCRConfigurationError('konfigurasi OCR ditolak provider; periksa model atau format permintaan');
    }
    if (error instanceof Anthropic.NotFoundError) {
      logger.warn({ requestId: error.requestID ?? null, status: error.status }, 'PAP OCR model unavailable');
      throw new PAPOCRConfigurationError('model OCR tidak tersedia untuk API key ini');
    }
    if (error instanceof Anthropic.APIConnectionError) {
      logger.warn({ requestId: error.requestID ?? null }, 'PAP OCR connection failed');
      throw new PAPOCRProviderError('koneksi ke layanan OCR gagal; coba lagi nanti');
    }
    if (error instanceof Anthropic.APIError) {
      logger.error({ requestId: error.requestID ?? null, status: error.status }, 'PAP OCR provider error');
      throw new PAPOCRProviderError('layanan OCR mengembalikan galat; coba lagi nanti');
    }
    throw error;
  }

  if (response.stop_reason !== 'end_turn') {
    throw new PAPOCRResponseError(`OCR tidak selesai: stop_reason=${response.stop_reason ?? 'unknown'}`);
  }
  const text = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
  if (!text) throw new PAPOCRResponseError('OCR tidak menghasilkan konten JSON');

  let json: unknown;
  try {
    json = JSON.parse(text.text);
  } catch {
    throw new PAPOCRResponseError('respons OCR bukan JSON valid');
  }
  const parsed = extractionSchema.safeParse(json);
  if (!parsed.success) throw new PAPOCRResponseError('struktur respons OCR tidak valid');

  const reviewRows = parsed.data.rows.map((row) => ({
    date: row.date,
    description: row.description,
    referenceNo: row.referenceNo,
    income: row.income,
    expense: row.expense,
    balance: row.balance,
    sourceRow: row.sourceRow,
    sourceRef: `image:${row.sourceImage}:row:${row.sourceRow}`,
  }));
  const rows = reconcilePAPReviewRows(normalizePAPRawRows(reviewRows, {
    sourceKind: 'ocr',
    sourceFingerprint,
  }));
  const requestId = (response as Anthropic.Message & { _requestID?: string })._requestID ?? null;
  const totals = summarizePAPReviewRows(rows);
  const warnings = rows.flatMap((row) => row.warnings.map((warning) => `${row.source.ref}: ${warning}`));
  return {
    rows,
    totals,
    warnings,
    source: { kind: 'ocr', fingerprint: sourceFingerprint, imageCount: images.length },
    sourceFingerprint,
    model: response.model,
    requestId,
  };
}

function validateImages(images: PAPOCRImage[]): void {
  if (images.length === 0) throw new PAPOCRInputError('minimal satu gambar diperlukan');
  if (images.length > PAP_OCR_MAX_IMAGES) throw new PAPOCRInputError(`maksimal ${PAP_OCR_MAX_IMAGES} gambar`);
  let totalBytes = 0;
  for (const image of images) {
    if (!PAP_OCR_ALLOWED_MEDIA_TYPES.includes(image.mediaType)) {
      throw new PAPOCRInputError(`tipe gambar tidak didukung: ${image.mediaType}`);
    }
    if (!isPAPOCRRotation(image.rotationDegrees ?? 0)) {
      throw new PAPOCRInputError('rotasi gambar tidak valid');
    }
    if (image.bytes.byteLength === 0) throw new PAPOCRInputError('gambar kosong');
    if (image.bytes.byteLength > PAP_OCR_MAX_IMAGE_BYTES) {
      throw new PAPOCRInputError(`gambar melebihi ${PAP_OCR_MAX_IMAGE_BYTES} byte`);
    }
    totalBytes += image.bytes.byteLength;
  }
  if (totalBytes > PAP_OCR_MAX_TOTAL_BYTES) {
    throw new PAPOCRInputError(`total gambar melebihi ${PAP_OCR_MAX_TOTAL_BYTES} byte`);
  }
}

export async function normalizePAPOCRImage(image: PAPOCRImage): Promise<NormalizedPAPOCRImage> {
  const bytes = Buffer.from(image.bytes);
  const rotationDegrees = image.rotationDegrees ?? 0;
  try {
    const metadata = await sharp(bytes).metadata();
    const decodedMediaType = mediaTypeFromSharpFormat(metadata.format);
    if (!decodedMediaType || decodedMediaType !== image.mediaType) {
      throw new PAPOCRInputError('isi gambar tidak cocok dengan tipe file');
    }

    const needsAutoOrientation = metadata.orientation !== undefined && metadata.orientation !== 1;
    if (!needsAutoOrientation && rotationDegrees === 0) {
      return { bytes, mediaType: image.mediaType };
    }

    const transformer = sharp(bytes).autoOrient();
    if (rotationDegrees !== 0) transformer.rotate(rotationDegrees);
    const normalized = await transformer.toBuffer();
    return { bytes: normalized, mediaType: image.mediaType };
  } catch (error) {
    if (error instanceof PAPOCRInputError) throw error;
    throw new PAPOCRInputError('gambar tidak dapat dibaca atau rusak');
  }
}

function validateNormalizedImages(images: NormalizedPAPOCRImage[]): void {
  let totalBytes = 0;
  for (const image of images) {
    if (image.bytes.byteLength > PAP_OCR_MAX_IMAGE_BYTES) {
      throw new PAPOCRInputError(`gambar setelah orientasi melebihi ${PAP_OCR_MAX_IMAGE_BYTES} byte`);
    }
    totalBytes += image.bytes.byteLength;
  }
  if (totalBytes > PAP_OCR_MAX_TOTAL_BYTES) {
    throw new PAPOCRInputError(`total gambar setelah orientasi melebihi ${PAP_OCR_MAX_TOTAL_BYTES} byte`);
  }
}

function mediaTypeFromSharpFormat(format: string | undefined): PAPOCRMediaType | null {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  return null;
}

function isPAPOCRRotation(value: number): value is PAPOCRRotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

function fingerprintImages(images: PAPOCRImage[]): string {
  const hash = createHash('sha256');
  for (const image of images) {
    hash.update(image.mediaType).update(Buffer.from(image.bytes));
    if ((image.rotationDegrees ?? 0) !== 0) hash.update(`:rotation=${image.rotationDegrees}`);
  }
  return hash.digest('hex');
}

const papOCRJSONSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          date: { type: ['string', 'null'] },
          description: { type: 'string' },
          referenceNo: { type: ['string', 'null'] },
          income: { type: ['string', 'number', 'null'] },
          expense: { type: ['string', 'number', 'null'] },
          balance: { type: ['string', 'number', 'null'] },
          sourceImage: { type: 'integer' },
          sourceRow: { type: 'integer' },
        },
        required: ['date', 'description', 'referenceNo', 'income', 'expense', 'balance', 'sourceImage', 'sourceRow'],
      },
    },
  },
  required: ['rows'],
} as const;

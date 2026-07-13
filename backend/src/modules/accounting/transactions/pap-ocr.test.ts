import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  PAPOCRInputError,
  PAPOCRResponseError,
  PAP_OCR_MAX_TOTAL_BYTES,
  normalizePAPOCRImage,
  parsePAPImages,
} from './pap-ocr.js';

function mockClient(response: unknown) {
  return { messages: { create: vi.fn().mockResolvedValue(response) } };
}

function successfulResponse() {
  return {
    stop_reason: 'end_turn',
    model: 'claude-opus-4-8',
    _requestID: 'req_test',
    content: [{
      type: 'text',
      text: JSON.stringify({ rows: [{
        date: '01/07/2026', description: 'Infak', referenceNo: 'PAP-1',
        income: 'Rp 1.000', expense: null, balance: '1.000', sourceImage: 1, sourceRow: 1,
      }] }),
    }],
  };
}

async function jpeg(options: { orientation?: number; width?: number; height?: number } = {}): Promise<Buffer> {
  const { orientation, width = 3, height = 2 } = options;
  return sharp({
    create: { width, height, channels: 3, background: { r: 220, g: 40, b: 10 } },
  }).jpeg().withMetadata(orientation === undefined ? {} : { orientation }).toBuffer();
}

describe('parsePAPImages', () => {
  it('uses structured Claude vision and normalizes extracted rows', async () => {
    const client = mockClient(successfulResponse());
    const image = await jpeg();

    const result = await parsePAPImages([
      { bytes: image, mediaType: 'image/jpeg' },
    ], { client: client as never });

    expect(result.rows[0]).toMatchObject({
      date: '2026-07-01', direction: 'income', amount: '1000.00', writtenBalance: '1000.00',
      referenceNo: 'PAP-1', source: { kind: 'ocr', ref: 'image:1:row:1' },
    });
    expect(result.requestId).toBe('req_test');
    expect(result.source).toMatchObject({ kind: 'ocr', imageCount: 1, fingerprint: result.sourceFingerprint });
    expect(client.messages.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-opus-4-8',
      thinking: { type: 'adaptive' },
      output_config: { format: expect.objectContaining({ type: 'json_schema' }) },
    }));
    const request = client.messages.create.mock.calls[0]![0];
    expect(request.messages[0].content[0]).toMatchObject({
      type: 'image', source: { type: 'base64', media_type: 'image/jpeg' },
    });
    expect(Buffer.from(request.messages[0].content[0].source.data, 'base64')).toEqual(image);
  });

  it('applies EXIF orientation before sending the image to OCR', async () => {
    const client = mockClient(successfulResponse());
    const sideways = await jpeg({ orientation: 6, width: 3, height: 2 });

    const result = await parsePAPImages([
      { bytes: sideways, mediaType: 'image/jpeg' },
    ], { client: client as never });

    const request = client.messages.create.mock.calls[0]![0];
    const sent = Buffer.from(request.messages[0].content[0].source.data, 'base64');
    const metadata = await sharp(sent).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(2);
    expect(metadata.height).toBe(3);
    expect(metadata.orientation ?? 1).toBe(1);
    expect(result.sourceFingerprint).toBe(await fingerprintFor(sideways, 'image/jpeg'));
  });

  it('applies an explicit quarter-turn after EXIF normalization', async () => {
    const image = await jpeg({ width: 3, height: 2 });
    const unchanged = await normalizePAPOCRImage({ bytes: image, mediaType: 'image/jpeg' });
    const rotated = await normalizePAPOCRImage({
      bytes: image,
      mediaType: 'image/jpeg',
      rotationDegrees: 90,
    });

    expect(unchanged.bytes).toEqual(image);
    expect((await sharp(rotated.bytes).metadata()).width).toBe(2);
    expect((await sharp(rotated.bytes).metadata()).height).toBe(3);
  });

  it('keeps source fingerprint stable for EXIF normalization but distinguishes manual rotation', async () => {
    const image = await jpeg({ orientation: 8 });
    const zeroRotation = await parsePAPImages([
      { bytes: image, mediaType: 'image/jpeg' },
    ], { client: mockClient(successfulResponse()) as never });
    const manualRotation = await parsePAPImages([
      { bytes: image, mediaType: 'image/jpeg', rotationDegrees: 90 },
    ], { client: mockClient(successfulResponse()) as never });

    expect(zeroRotation.sourceFingerprint).toBe(await fingerprintFor(image, 'image/jpeg'));
    expect(manualRotation.sourceFingerprint).not.toBe(zeroRotation.sourceFingerprint);
  });

  it('rejects corrupt image bytes and MIME mismatches before calling OCR', async () => {
    const corruptClient = mockClient(successfulResponse());
    await expect(parsePAPImages([
      { bytes: Buffer.from('not an image'), mediaType: 'image/jpeg' },
    ], { client: corruptClient as never })).rejects.toThrow(PAPOCRInputError);
    expect(corruptClient.messages.create).not.toHaveBeenCalled();

    const mismatchClient = mockClient(successfulResponse());
    await expect(parsePAPImages([
      { bytes: await jpeg(), mediaType: 'image/png' },
    ], { client: mismatchClient as never })).rejects.toThrow('isi gambar tidak cocok');
    expect(mismatchClient.messages.create).not.toHaveBeenCalled();
  });

  it('checks stop_reason before reading content', async () => {
    const client = mockClient({ stop_reason: 'max_tokens', model: 'claude-opus-4-8', content: [] });
    await expect(parsePAPImages([
      { bytes: await jpeg(), mediaType: 'image/jpeg' },
    ], { client: client as never })).rejects.toThrow(PAPOCRResponseError);
  });

  it('rejects unsupported, empty, and oversized image input locally', async () => {
    await expect(parsePAPImages([], { client: mockClient({}) as never })).rejects.toThrow(PAPOCRInputError);
    await expect(parsePAPImages([
      { bytes: Buffer.from('x'), mediaType: 'image/gif' as never },
    ], { client: mockClient({}) as never })).rejects.toThrow('tipe gambar tidak didukung');
    const chunkSize = Math.ceil(PAP_OCR_MAX_TOTAL_BYTES / 3);
    await expect(parsePAPImages([
      { bytes: Buffer.alloc(chunkSize), mediaType: 'image/png' },
      { bytes: Buffer.alloc(chunkSize), mediaType: 'image/png' },
      { bytes: Buffer.alloc(chunkSize), mediaType: 'image/png' },
    ], { client: mockClient({}) as never })).rejects.toThrow('total gambar melebihi');
  });

  it('rejects locally invalid model JSON', async () => {
    const client = mockClient({
      stop_reason: 'end_turn', model: 'claude-opus-4-8', _requestID: null,
      content: [{ type: 'text', text: '{"rows":[{"description":1}]}' }],
    });
    await expect(parsePAPImages([
      { bytes: await jpeg(), mediaType: 'image/jpeg' },
    ], { client: client as never })).rejects.toThrow('struktur respons OCR tidak valid');
  });
});

async function fingerprintFor(bytes: Buffer, mediaType: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(mediaType).update(bytes).digest('hex');
}

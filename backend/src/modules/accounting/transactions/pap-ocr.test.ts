import { describe, expect, it, vi } from 'vitest';
import { PAPOCRInputError, PAPOCRResponseError, PAP_OCR_MAX_TOTAL_BYTES, parsePAPImages } from './pap-ocr.js';

function mockClient(response: unknown) {
  return { messages: { create: vi.fn().mockResolvedValue(response) } };
}

describe('parsePAPImages', () => {
  it('uses structured Claude vision and normalizes extracted rows', async () => {
    const client = mockClient({
      stop_reason: 'end_turn',
      model: 'claude-opus-4-8',
      _request_id: 'req_test',
      content: [{
        type: 'text',
        text: JSON.stringify({ rows: [{
          date: '01/07/2026', description: 'Infak', referenceNo: 'PAP-1',
          income: 'Rp 1.000', expense: null, balance: '1.000', sourceImage: 1, sourceRow: 1,
        }] }),
      }],
    });

    const result = await parsePAPImages([
      { bytes: Buffer.from('image'), mediaType: 'image/png' },
    ], { client: client as never });

    expect(result.rows[0]).toMatchObject({
      date: '2026-07-01', direction: 'income', amount: '1000.00', writtenBalance: '1000.00',
      referenceNo: 'PAP-1', source: { kind: 'ocr', ref: 'image:1:row:1' },
    });
    expect(result.source).toMatchObject({ kind: 'ocr', imageCount: 1, fingerprint: result.sourceFingerprint });
    expect(client.messages.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-opus-4-8',
      thinking: { type: 'adaptive' },
      output_config: { format: expect.objectContaining({ type: 'json_schema' }) },
    }));
    const request = client.messages.create.mock.calls[0]![0];
    expect(request.messages[0].content[0]).toMatchObject({
      type: 'image', source: { type: 'base64', media_type: 'image/png' },
    });
  });

  it('checks stop_reason before reading content', async () => {
    const client = mockClient({ stop_reason: 'max_tokens', model: 'claude-opus-4-8', content: [] });
    await expect(parsePAPImages([
      { bytes: Buffer.from('image'), mediaType: 'image/jpeg' },
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
      stop_reason: 'end_turn', model: 'claude-opus-4-8', _request_id: null,
      content: [{ type: 'text', text: '{"rows":[{"description":1}]}' }],
    });
    await expect(parsePAPImages([
      { bytes: Buffer.from('image'), mediaType: 'image/webp' },
    ], { client: client as never })).rejects.toThrow('struktur respons OCR tidak valid');
  });
});

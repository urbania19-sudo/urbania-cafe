import { describe, expect, it } from 'vitest';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  validateImageFile,
} from '../src/components/admin/MenuManager';

describe('Menu Item Image Upload Validation', () => {
  it('allows standard web image formats: JPEG, PNG, WebP, and AVIF', () => {
    ALLOWED_IMAGE_TYPES.forEach((type) => {
      const file = new File(['mock content'], 'test-image', { type });
      const res = validateImageFile(file);
      expect(res.valid).toBe(true);
      expect(res.error).toBeUndefined();
    });
  });

  it('rejects unsupported file formats such as PDF, GIF, and plain text', () => {
    const invalidTypes = ['application/pdf', 'image/gif', 'text/plain', ''];
    invalidTypes.forEach((type) => {
      const file = new File(['mock content'], 'doc', { type });
      const res = validateImageFile(file);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Unsupported image format');
    });
  });

  it('rejects images exceeding the 5MB size limit', () => {
    // 6 MB dummy file
    const oversizedBlob = new Blob([new Uint8Array(6 * 1024 * 1024)]);
    const file = new File([oversizedBlob], 'large.jpg', { type: 'image/jpeg' });
    const res = validateImageFile(file);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('File size exceeds 5MB limit');
  });

  it('accepts images under the 5MB size limit', () => {
    // 2 MB dummy file
    const validBlob = new Blob([new Uint8Array(2 * 1024 * 1024)]);
    const file = new File([validBlob], 'medium.jpg', { type: 'image/jpeg' });
    const res = validateImageFile(file);
    expect(res.valid).toBe(true);
    expect(res.error).toBeUndefined();
  });
});

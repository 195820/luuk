import { describe, it, expect } from 'vitest';
import { hammingDistance } from '../phash';

describe('pHash', () => {
  describe('hammingDistance', () => {
    it('相同哈希距离为 0', () => {
      const hash = 'a1b2c3d4e5f67890';
      expect(hammingDistance(hash, hash)).toBe(0);
    });

    it('已知异或结果的距离', () => {
      // 0x0000000000000001 XOR 0x0000000000000000 = 1 bit
      expect(hammingDistance('0000000000000001', '0000000000000000')).toBe(1);

      // 0xffffffffffffffff XOR 0x0000000000000000 = 64 bits
      expect(hammingDistance('ffffffffffffffff', '0000000000000000')).toBe(64);

      // 0xa1b2c3d4e5f67890 XOR 0xa1b2c3d4e5f67891 = 1 bit (最后一位不同)
      expect(hammingDistance('a1b2c3d4e5f67890', 'a1b2c3d4e5f67891')).toBe(1);
    });

    it('非法输入抛错', () => {
      expect(() => hammingDistance('abc', '0000000000000000')).toThrow('输入长度必须为 16');
      expect(() => hammingDistance('0000000000000000', 'xyz')).toThrow('输入长度必须为 16');
    });
  });
});

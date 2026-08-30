import sharp from 'sharp'

/**
 * 计算图片的 pHash（感知哈希）
 *
 * 算法步骤：
 * 1. 缩放到 32×32 灰度图
 * 2. 对像素矩阵做 2D DCT（离散余弦变换）
 * 3. 取左上 8×8 低频分量（排除 [0][0] 直流分量）
 * 4. 计算 63 个分量的中值
 * 5. 每个分量与中值比较生成 64 bit（实际用 63 bit + 1 bit 补齐）
 * 6. 转为 16 位 hex 字符串
 *
 * @param filePath 图片文件路径
 * @returns 16 位小写 hex 字符串，损坏/不支持文件抛错
 */
export async function computePhash(filePath: string): Promise<string> {
  // 1. 缩放到 32×32 灰度
  const SIZE = 32
  const { data, info } = await sharp(filePath)
    .resize(SIZE, SIZE, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  if (info.width !== SIZE || info.height !== SIZE) {
    throw new Error(`pHash: 缩放后尺寸异常 ${info.width}x${info.height}`)
  }

  // 2. 构建 32×32 像素矩阵
  const pixels: number[][] = []
  for (let y = 0; y < SIZE; y++) {
    const row: number[] = []
    for (let x = 0; x < SIZE; x++) {
      row.push(data[y * SIZE + x])
    }
    pixels.push(row)
  }

  // 3. 2D DCT 变换
  const dct = dct2D(pixels)

  // 4. 取左上 8×8 低频分量
  const lowFreq: number[] = []
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 0 && y === 0) continue // 跳过直流分量
      lowFreq.push(dct[y][x])
    }
  }

  // 5. 计算中值
  const sorted = [...lowFreq].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]

  // 6. 生成 64 bit 哈希（63 个比较位 + 1 个补齐位）
  let hash = 0n
  for (let i = 0; i < lowFreq.length; i++) {
    if (lowFreq[i] > median) {
      hash |= 1n << BigInt(63 - i)
    }
  }
  // 补齐第 64 位（使总位数为 64）
  // 这里使用低频次数的奇偶性作为补齐位
  const positiveCount = lowFreq.filter(v => v > median).length
  if (positiveCount % 2 === 0) {
    hash |= 1n
  }

  // 7. 转为 16 位 hex
  return hash.toString(16).padStart(16, '0')
}

/**
 * 计算两个 pHash 的汉明距离
 * @param a 16 位 hex 字符串
 * @param b 16 位 hex 字符串
 * @returns 汉明距离（0-64）
 */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== 16 || b.length !== 16) {
    throw new Error(`hammingDistance: 输入长度必须为 16（a=${a.length}, b=${b.length}）`)
  }
  const aBigInt = BigInt('0x' + a)
  const bBigInt = BigInt('0x' + b)
  let xor = aBigInt ^ bBigInt
  let distance = 0
  while (xor > 0n) {
    distance += Number(xor & 1n)
    xor >>= 1n
  }
  return distance
}

/**
 * 2D DCT（离散余弦变换）
 * 使用 type-II DCT 公式
 */
function dct2D(matrix: number[][]): number[][] {
  const N = matrix.length
  const M = matrix[0].length

  // 先对每行做 1D DCT
  const rowDct: number[][] = matrix.map(row => dct1D(row))

  // 再对每列做 1D DCT
  const result: number[][] = Array.from({ length: N }, () => Array(M).fill(0))
  for (let x = 0; x < M; x++) {
    const col = rowDct.map(row => row[x])
    const colDct = dct1D(col)
    for (let y = 0; y < N; y++) {
      result[y][x] = colDct[y]
    }
  }

  return result
}

/**
 * 1D DCT (type-II)
 * X[k] = sum_{n=0}^{N-1} x[n] * cos(pi/N * (n + 0.5) * k)
 */
function dct1D(data: number[]): number[] {
  const N = data.length
  const result: number[] = []

  for (let k = 0; k < N; k++) {
    let sum = 0
    for (let n = 0; n < N; n++) {
      sum += data[n] * Math.cos(Math.PI / N * (n + 0.5) * k)
    }
    result.push(sum)
  }

  return result
}

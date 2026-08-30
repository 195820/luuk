import fs from 'fs'
import ExifReader from 'exifreader'
import { logger } from '../../utils/logger'
import type { ExifInfo } from '../../types'

/** EXIF 读取截断大小（1MB 足够覆盖绝大多数 EXIF 数据） */
const EXIF_READ_SIZE = 1024 * 1024

/**
 * 读取图片 EXIF 信息（惰性解析，仅读取文件头 1MB）
 * 所有字段缺失容错，解析异常返回空对象
 */
export async function readExif(absPath: string): Promise<ExifInfo> {
  try {
    const fd = await fs.promises.open(absPath, 'r')
    try {
      const stat = await fd.stat()
      const readSize = Math.min(stat.size, EXIF_READ_SIZE)
      const buffer = Buffer.alloc(readSize)
      await fd.read(buffer, 0, readSize, 0)

      const tags = ExifReader.load(buffer)

      const info: ExifInfo = {}

      // 拍摄时间
      if (tags['DateTimeOriginal']?.description) {
        info.dateTimeOriginal = tags['DateTimeOriginal'].description
      }

      // 相机品牌/型号
      if (tags['Make']?.description) {
        info.make = tags['Make'].description.trim()
      }
      if (tags['Model']?.description) {
        info.model = tags['Model'].description.trim()
      }
      if (tags['LensModel']?.description) {
        info.lensModel = tags['LensModel'].description
      }

      // 曝光参数
      if (tags['ExposureTime']?.description) {
        info.exposureTime = tags['ExposureTime'].description
      }
      if (tags['FNumber']?.value !== undefined) {
        info.fNumber = Number(tags['FNumber'].value)
      }
      if (tags['ISOSpeedRatings']?.value !== undefined) {
        info.iso = Number(tags['ISOSpeedRatings'].value)
      }
      if (tags['FocalLength']?.value !== undefined) {
        info.focalLength = Number(tags['FocalLength'].value)
      }

      // GPS 坐标
      const gpsLat = tags['GPSLatitude']?.value as number[] | undefined
      const gpsLatRef = tags['GPSLatitudeRef']?.description
      const gpsLon = tags['GPSLongitude']?.value as number[] | undefined
      const gpsLonRef = tags['GPSLongitudeRef']?.description

      if (gpsLat && gpsLon && gpsLat.length === 3 && gpsLon.length === 3) {
        const latitude = dmsToDecimal(gpsLat, gpsLatRef === 'S' ? -1 : 1)
        const longitude = dmsToDecimal(gpsLon, gpsLonRef === 'W' ? -1 : 1)
        info.gps = { latitude, longitude }
      }

      return info
    } finally {
      await fd.close()
    }
  } catch (err) {
    logger.warn('EXIF', `解析失败: ${absPath}`, err)
    return {}
  }
}

/**
 * DMS（度分秒）转十进制度数
 */
function dmsToDecimal(dms: number[], sign: number): number {
  const [d, m, s] = dms
  return sign * (d + m / 60 + s / 3600)
}

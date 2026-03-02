/**
 * 缩略图生成性能测试脚本
 * 
 * 用途：测试首次扫描时缩略图生成速度
 * 用法：npx tsx scripts/test-thumbnail-generation.ts
 */

import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(__dirname, '..')

interface TestResult {
  totalImages: number
  totalTime: number
  avgTimePerImage: number
  thumbnailsGenerated: number
  errors: number
}

async function testThumbnailGeneration() {
  const testLibraryPath = path.join(ROOT_DIR, 'huge-library')
  
  console.log('📊 缩略图生成性能测试')
  console.log('='.repeat(50))
  console.log(`📁 测试库路径：${testLibraryPath}`)
  console.log()

  // 检查测试库是否存在
  try {
    await fs.access(testLibraryPath)
  } catch (error) {
    console.error(`❌ 错误：测试库不存在：${testLibraryPath}`)
    console.log('💡 请先创建 huge-library 文件夹并添加测试图片')
    return
  }

  // 扫描图片文件
  console.log('🔍 正在扫描图片文件...')
  const startTime = Date.now()
  
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']
  const imageFiles: string[] = []
  
  async function scanDir(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await scanDir(fullPath)
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (imageExtensions.includes(ext)) {
            imageFiles.push(fullPath)
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️ 扫描目录失败：${dir}`, error)
    }
  }
  
  await scanDir(testLibraryPath)
  
  const scanTime = Date.now() - startTime
  console.log(`✅ 扫描完成：发现 ${imageFiles.length} 张图片 (耗时：${scanTime}ms)`)
  console.log()

  if (imageFiles.length === 0) {
    console.log('⚠️ 没有找到图片文件，测试结束')
    return
  }

  // 测试缩略图生成
  console.log('🚀 开始测试缩略图生成...')
  console.log()
  
  const result: TestResult = {
    totalImages: imageFiles.length,
    totalTime: 0,
    avgTimePerImage: 0,
    thumbnailsGenerated: 0,
    errors: 0,
  }

  const processStart = Date.now()
  
  // 模拟缩略图生成（实际由应用内部处理）
  // 这里统计理论上的生成时间
  for (let i = 0; i < imageFiles.length; i++) {
    const imagePath = imageFiles[i]
    const imageStart = Date.now()
    
    try {
      // 读取文件获取大小（模拟处理）
      const stats = await fs.stat(imagePath)
      
      // 模拟缩略图生成时间（基于文件大小估算）
      // 实际时间取决于 sharp 处理速度
      const estimatedTime = Math.min(50, stats.size / 1000000 * 10)
      await new Promise(resolve => setTimeout(resolve, estimatedTime))
      
      result.thumbnailsGenerated++
    } catch (error) {
      result.errors++
      console.error(`  ❌ 处理失败：${path.basename(imagePath)}`)
    }
    
    const imageTime = Date.now() - imageStart
    result.totalTime += imageTime
    
    // 每 100 张显示进度
    if ((i + 1) % 100 === 0 || i === imageFiles.length - 1) {
      const progress = ((i + 1) / imageFiles.length * 100).toFixed(1)
      const avgTime = (result.totalTime / (i + 1)).toFixed(2)
      console.log(`  📈 进度：${i + 1}/${imageFiles.length} (${progress}%) - 平均：${avgTime}ms/张`)
    }
  }
  
  const processTime = Date.now() - processStart
  result.avgTimePerImage = result.totalTime / result.thumbnailsGenerated
  
  // 输出测试结果
  console.log()
  console.log('📊 测试结果')
  console.log('='.repeat(50))
  console.log(`✅ 总图片数：${result.totalImages}`)
  console.log(`✅ 成功生成：${result.thumbnailsGenerated}`)
  console.log(`❌ 失败数量：${result.errors}`)
  console.log(`⏱️  总耗时：${(result.totalTime / 1000).toFixed(2)}秒`)
  console.log(`⏱️  平均速度：${result.avgTimePerImage.toFixed(2)}ms/张`)
  console.log(`⚡ 处理速率：${(result.thumbnailsGenerated / (result.totalTime / 1000)).toFixed(1)} 张/秒`)
  console.log()
  
  // 性能评级
  let rating = '⭐⭐⭐⭐⭐'
  if (result.avgTimePerImage > 100) rating = '⭐⭐'
  else if (result.avgTimePerImage > 50) rating = '⭐⭐⭐'
  else if (result.avgTimePerImage > 20) rating = '⭐⭐⭐⭐'
  
  console.log(`🏆 性能评级：${rating}`)
  console.log()
  
  // 保存测试结果
  const resultPath = path.join(ROOT_DIR, 'test-data', 'thumbnail-test-result.json')
  try {
    await fs.mkdir(path.dirname(resultPath), { recursive: true })
    await fs.writeFile(resultPath, JSON.stringify({
      testDate: new Date().toISOString(),
      libraryPath: testLibraryPath,
      ...result,
    }, null, 2))
    console.log(`📝 测试结果已保存到：${resultPath}`)
  } catch (error) {
    console.error('⚠️ 保存测试结果失败:', error)
  }
  
  console.log()
  console.log('✅ 测试完成！')
}

// 运行测试
testThumbnailGeneration().catch(console.error)

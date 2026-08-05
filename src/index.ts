import * as step from '@flow-step/step-toolkit'
import process from 'node:process'
import path from 'node:path'
import {
    getLatestLtsVersion,
    getDownloadUrl,
    ensureDir,
    downloadFile,
    getFileSize,
    formatSize,
    extractArchive
} from './util'
import * as fs from 'node:fs'

const INSTALL_BASE = '/root/yunxiao/flow_tools/node'

async function runStep(): Promise<void> {

    const nodeVersion = process.env.NODE_VERSION as string
    step.info(`Node.js版本=${nodeVersion}`)

    const ltsVersion = await getLatestLtsVersion(nodeVersion)
    console.log(`✅ 找到最新 LTS 版本: ${ltsVersion}`)

    const {url, filename} = getDownloadUrl(ltsVersion)
    const installDir = path.join(INSTALL_BASE, ltsVersion)
    const archivePath = path.join(installDir, filename)
    console.log(`📁 安装目录: ${installDir}`)
    console.log(`📥 下载地址: ${url}`)

    ensureDir(installDir)


    console.log(`⏳ 正在下载 ${filename}...`)
    await downloadFile(url, archivePath, 300000)
    const size = getFileSize(archivePath)
    console.log(`✅ 下载完成 (${formatSize(size)})`)

    // 6. 解压
    console.log(`📦 正在解压到 ${installDir}...`)
    await extractArchive(archivePath, installDir)
    console.log('✅ 解压完成')

    // 7. 清理压缩包
    fs.unlinkSync(archivePath)
    console.log('🧹 已清理临时压缩包')

    // 8. 设置环境变量
    step.addPath(path.join(installDir, 'bin'))

    // 9. 输出摘要
    console.log(`\n🎉 安装完成！`)
    console.log(`📦 版本: ${ltsVersion}`)
    console.log(`📂 路径: ${installDir}`)
}

runStep()
    .then(function() {
        step.success('run step successfully!')
    })
    .catch(function(err: Error) {
        step.error(err.message)
        process.exit(-1)
    })

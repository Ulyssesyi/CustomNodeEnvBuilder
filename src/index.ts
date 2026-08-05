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
    step.info(`✅ 找到最新 LTS 版本: ${ltsVersion}`)

    const {url, filename} = getDownloadUrl(ltsVersion)
    const installDir = path.join(INSTALL_BASE, ltsVersion)
    const archivePath = path.join(installDir, filename)
    step.info(`📁 安装目录: ${installDir}`)
    step.info(`📥 下载地址: ${url}`)

    ensureDir(installDir)


    step.info(`⏳ 正在下载 ${filename}...`)
    await downloadFile(url, archivePath, 300000)
    const size = getFileSize(archivePath)
    step.info(`✅ 下载完成 (${formatSize(size)})`)

    // 6. 解压
    step.info(`📦 正在解压到 ${installDir}...`)
    await extractArchive(archivePath, installDir)
    step.info('✅ 解压完成')

    // 7. 清理压缩包
    fs.unlinkSync(archivePath)
    step.info('🧹 已清理临时压缩包')

    // 8. 设置环境变量
    step.addPath(path.join(installDir, 'bin'))

    // 9. 输出摘要
    step.info(`🎉 安装完成！`)
    step.info(`📦 版本: ${ltsVersion}`)
    step.info(`📂 路径: ${installDir}`)
}

runStep()
    .then(function() {
        step.success('run step successfully!')
    })
    .catch(function(err: Error) {
        step.error(err.message)
        process.exit(-1)
    })

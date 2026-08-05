import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as step from '@flow-step/step-toolkit'

const execPromise = promisify(exec);

/**
 * 获取匹配输入前缀的最新 LTS 版本
 * @param majorVersion 用户输入的版本前缀，如 "22", "22.22", "22.22.1"
 * @returns 完整版本号，如 "v22.19.0"
 */
export async function getLatestLtsVersion(majorVersion: string): Promise<string> {
    const prefix = majorVersion.trim().replace(/^v/, ''); // 去除可能的前导 v
    if (prefix === '') {
        return Promise.reject(new Error('版本前缀不能为空'));
    }

    return new Promise((resolve, reject) => {
        https.get('https://nodejs.org/dist/index.json', (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`获取版本列表失败，HTTP ${res.statusCode}`));
                return;
            }

            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const versions = JSON.parse(data);
                    // 筛选 LTS 版本，且版本号（去掉 v）以输入前缀开头
                    const matched = versions.filter((v: any) => {
                        const ver = v.version.replace(/^v/, '');
                        return ver.startsWith(prefix) && v.lts !== null;
                    });

                    if (matched.length === 0) {
                        reject(new Error(`未找到以 "${prefix}" 开头的 LTS 版本`));
                        return;
                    }

                    // index.json 按版本从新到旧排序，第一个就是最新的匹配版本
                    resolve(matched[0].version);
                } catch (err) {
                    reject(new Error(`解析版本列表失败: ${err}`));
                }
            });
        }).on('error', reject);
    });
}

/**
 * 根据操作系统和架构构造下载 URL
 */
export function getDownloadUrl(version: string): { url: string; filename: string } {
    const platform = os.platform();
    const arch = os.arch();

    let ext: string;
    let platformName: string;

    switch (platform) {
        case 'linux':
            ext = 'tar.xz';
            platformName = 'linux';
            break;
        case 'darwin':
            ext = 'tar.gz';
            platformName = 'darwin';
            break;
        case 'win32':
            ext = 'zip';
            platformName = 'win';
            break;
        default:
            throw new Error(`不支持的平台: ${platform}`);
    }

    // 架构映射
    let archName: string;
    switch (arch) {
        case 'x64':
            archName = 'x64';
            break;
        case 'arm64':
            archName = 'arm64';
            break;
        case 'arm':
            archName = 'armv7l';
            break;
        default:
            archName = arch;
    }

    const filename = `node-${version}-${platformName}-${archName}.${ext}`;
    const url = `https://nodejs.org/dist/${version}/${filename}`;

    return { url, filename };
}

/**
 * 下载文件（带进度显示）
 */
export function downloadFile(url: string, destPath: string, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        let downloaded = 0;
        let total = 0;
        let lastLoggedPercent = -1;
        let isResolved = false;

        // 超时处理
        const timeoutHandle = setTimeout(() => {
            if (!isResolved) {
                file.close();
                reject(new Error(`下载超时（${timeout / 1000}秒）`));
            }
        }, timeout);

        https.get(url, (response) => {
            // 处理非 200 状态
            if (response.statusCode !== 200) {
                clearTimeout(timeoutHandle);
                file.close();
                reject(new Error(`下载失败，HTTP ${response.statusCode}`));
                return;
            }

            // 获取总大小（可能为 0，表示服务端未返回 Content-Length）
            total = parseInt(response.headers['content-length'] || '0', 10);

            step.info(`📊 文件总大小: ${total > 0 ? formatSize(total) : '未知'}`);

            // 数据到达
            response.on('data', (chunk) => {
                downloaded += chunk.length;
                file.write(chunk);

                if (total > 0) {
                    // 已知总大小：按百分比显示
                    const percent = Math.floor((downloaded / total) * 100);
                    // 只在百分比变化时打印，避免刷屏
                    if (percent > lastLoggedPercent) {
                        lastLoggedPercent = percent;
                        step.info(`⏳ 下载进度: ${percent}% (${formatSize(downloaded)} / ${formatSize(total)})`);
                    }
                } else {
                    // 未知总大小：每下载 5MB 显示一次
                    const mbStep = Math.floor(downloaded / (5 * 1024 * 1024));
                    if (mbStep > lastLoggedPercent) {
                        lastLoggedPercent = mbStep;
                        step.info(`⏳ 已下载: ${formatSize(downloaded)}`);
                    }
                }
            });

            // 下载完成
            response.on('end', () => {
                clearTimeout(timeoutHandle);
                file.end();
            });

            // 响应错误
            response.on('error', (err) => {
                clearTimeout(timeoutHandle);
                file.close();
                reject(err);
            });
        }).on('error', (err) => {
            // 请求错误
            clearTimeout(timeoutHandle);
            file.close();
            reject(err);
        });

        // 文件写入完成
        file.on('finish', () => {
            if (!isResolved) {
                isResolved = true;
                step.info(`✅ 下载完成 (${formatSize(downloaded)})`);
                resolve();
            }
        });

        // 文件写入错误
        file.on('error', (err) => {
            clearTimeout(timeoutHandle);
            if (!isResolved) {
                isResolved = true;
                reject(err);
            }
        });
    });
}
/**
 * 解压 tar.xz / tar.gz / zip 文件
 */
export async function extractArchive(archivePath: string, destDir: string): Promise<void> {
    const ext = path.extname(archivePath);

    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    if (ext === '.xz' || archivePath.endsWith('.tar.xz')) {
        // tar.xz: 使用 tar 命令
        await execPromise(`tar -xJf "${archivePath}" -C "${destDir}" --strip-components=1`);
    } else if (ext === '.gz' || archivePath.endsWith('.tar.gz')) {
        await execPromise(`tar -xzf "${archivePath}" -C "${destDir}" --strip-components=1`);
    } else if (ext === '.zip') {
        await execPromise(`unzip -q "${archivePath}" -d "${destDir}" && mv "${destDir}/node-*"/* "${destDir}/" 2>/dev/null || true`);
    } else {
        throw new Error(`不支持的压缩格式: ${ext}`);
    }
}

/**
 * 获取文件大小（字节）
 */
export function getFileSize(filePath: string): number {
    const stats = fs.statSync(filePath);
    return stats.size;
}

/**
 * 格式化文件大小
 */
export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

export function ensureDir(dir: string) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
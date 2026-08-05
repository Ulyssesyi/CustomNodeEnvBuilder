import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';

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
 * 下载文件
 * @param url 下载地址
 * @param destPath 目标文件路径
 * @param timeout 超时（毫秒）
 */
export async function downloadFile(url: string, destPath: string, timeout: number = 300000): Promise<void> {
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const timeoutHandle = setTimeout(() => {
            file.close();
            reject(new Error(`下载超时（${timeout / 1000}秒）`));
        }, timeout);

        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                clearTimeout(timeoutHandle);
                reject(new Error(`下载失败，HTTP ${response.statusCode}`));
                return;
            }

            response.pipe(file);

            file.on('finish', () => {
                clearTimeout(timeoutHandle);
                file.close();
                resolve();
            });

            file.on('error', (err) => {
                clearTimeout(timeoutHandle);
                reject(err);
            });
        }).on('error', (err) => {
            clearTimeout(timeoutHandle);
            reject(err);
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
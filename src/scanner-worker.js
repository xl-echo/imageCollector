/**
 * 图片扫描 Worker
 * 在后台线程中扫描指定驱动器的图片文件
 * 支持：JPG, PNG, GIF, BMP, WEBP, TIFF, ICO, SVG
 */

'use strict';

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');

// ==================== 日志函数 ====================
function log(type, msg) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type}] ${msg}`);
}

// 图片扩展名
const IMAGE_EXTS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.bmp',
    '.webp', '.tiff', '.tif', '.ico', '.svg', '.heic', '.heif', '.avif'
]);

// 文件名黑名单（缩略图、缓存等）
const EXCLUDE_PATTERNS = [
    /[Tt]humb/i,
    /[Tt]humbnail/i,
    /[Cc]ache/i,
    /[Dd]esktop\.ini/i,
    / thumbs\.db/i,
    /\.msix/i,
    /\.appx/i,
];

// 批次大小
const BATCH_SIZE = 50;

// 扫描计数器
let totalScanned = 0;
let totalImages = 0;
let isStopped = false;
let startTime = Date.now();

// 用于收集所有批次的累积数组
let allBatchImages = [];

// 图片尺寸检测（读取文件头）
function getImageDimensions(filePath) {
    let width = 0, height = 0;
    
    try {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(32);
        fs.readSync(fd, buffer, 0, 32, 0);

        // PNG: IHDR chunk (width/height at offset 16-24)
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
            const ihdr = Buffer.alloc(24);
            fs.readSync(fd, ihdr, 0, 24, 8);
            width = ihdr.readUInt32BE(16);
            height = ihdr.readUInt32BE(20);
            log('DEBUG', `PNG 图片: ${filePath}, 尺寸: ${width}x${height}`);
        }
        // JPEG: SOF0 marker
        else if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
            let offset = 2;
            while (offset < 1024 * 1024) { // 最多读 1MB
                fs.readSync(fd, buffer, 0, 4, offset);
                if (buffer[0] !== 0xFF) break;

                const marker = buffer[1];
                // SOF0, SOF1, SOF2
                if ((marker >= 0xC0 && marker <= 0xC2) || (marker >= 0xC4 && marker <= 0xC7)
                    || (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
                    const sof = Buffer.alloc(9);
                    fs.readSync(fd, sof, 0, 9, offset + 5);
                    height = sof.readUInt16BE(1);
                    width = sof.readUInt16BE(3);
                    log('DEBUG', `JPEG 图片: ${filePath}, 尺寸: ${width}x${height}`);
                    break;
                }
                // 读取下一个 marker
                if (marker === 0xD9) break; // EOI
                const len = buffer.readUInt16BE(2);
                offset += 2 + len;
            }
        }
        // GIF: Logical Screen Descriptor
        else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
            width = buffer.readUInt16LE(6);
            height = buffer.readUInt16LE(8);
            log('DEBUG', `GIF 图片: ${filePath}, 尺寸: ${width}x${height}`);
        }
        // BMP: BITMAPINFOHEADER
        else if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
            const bmp = Buffer.alloc(26);
            fs.readSync(fd, bmp, 0, 26, 14);
            width = bmp.readUInt32LE(18);
            height = Math.abs(bmp.readInt32LE(22));
            log('DEBUG', `BMP 图片: ${filePath}, 尺寸: ${width}x${height}`);
        }
        // WEBP: RIFF header
        else if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
            const riff = Buffer.alloc(30);
            fs.readSync(fd, riff, 0, 30, 0);
            // 修复：检查 'WEBP' 签名 (offset 8-11 应该是 'WEBP')
            if (riff[8] === 0x57 && riff[9] === 0x45 && riff[10] === 0x42 && riff[11] === 0x50) {
                // VP8 (lossy) - chunk at offset 12
                const chunk = Buffer.alloc(8);
                fs.readSync(fd, chunk, 0, 8, 12);
                if (chunk[0] === 0x56 && chunk[1] === 0x50 && chunk[2] === 0x38 && chunk[3] === 0x20) {
                    // VP8 chunk
                    const vp8 = Buffer.alloc(10);
                    fs.readSync(fd, vp8, 0, 10, 26);
                    if (vp8[0] === 0x9D && vp8[1] === 0x01 && vp8[2] === 0x2A) {
                        width = (vp8[7] << 8) | vp8[6];
                        height = (vp8[9] << 8) | vp8[8];
                        log('DEBUG', `WEBP(VP8) 图片: ${filePath}, 尺寸: ${width}x${height}`);
                    }
                }
                // VP8L (lossless) - chunk at offset 12
                else if (chunk[0] === 0x56 && chunk[1] === 0x50 && chunk[2] === 0x38 && chunk[3] === 0x4C) {
                    const vp8l = Buffer.alloc(5);
                    fs.readSync(fd, vp8l, 0, 5, 21);
                    // 修复：正确的 WEBP VP8L 尺寸解析
                    const bits = (vp8l[1] << 24) | (vp8l[2] << 16) | (vp8l[3] << 8) | vp8l[4];
                    width = (bits & 0x3FFF) + 1;
                    height = ((bits >> 14) & 0x3FFF) + 1;
                    log('DEBUG', `WEBP(VP8L) 图片: ${filePath}, 尺寸: ${width}x${height}`);
                }
                // VP8X (extended) - 可能有尺寸信息
                else if (chunk[0] === 0x56 && chunk[1] === 0x50 && chunk[2] === 0x38 && chunk[3] === 0x58) {
                    const vp8x = Buffer.alloc(10);
                    fs.readSync(fd, vp8x, 0, 10, 12);
                    // VP8X: width-1 在 offset 24-26 (3 bytes), height-1 在 offset 27-29
                    if ((vp8x[0] & 0xC0) === 0) { // check for presence bits
                        width = ((vp8x[3] << 16) | (vp8x[2] << 8) | vp8x[1]) + 1;
                        height = ((vp8x[6] << 16) | (vp8x[5] << 8) | vp8x[4]) + 1;
                        log('DEBUG', `WEBP(VP8X) 图片: ${filePath}, 尺寸: ${width}x${height}`);
                    }
                }
            }
        }

        fs.closeSync(fd);
        return { width, height };
    } catch (e) {
        log('WARN', `读取图片尺寸失败: ${filePath}, 错误: ${e.message}`);
        return { width: 0, height: 0 };
    }
}

function shouldExclude(name) {
    return EXCLUDE_PATTERNS.some(p => p.test(name));
}

function isImageFile(name) {
    const ext = path.extname(name).toLowerCase();
    return IMAGE_EXTS.has(ext);
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function scanDir(dir, batch) {
    if (isStopped) {
        log('INFO', `扫描已停止，退出目录: ${dir}`);
        return;
    }

    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
        log('DEBUG', `扫描目录: ${dir}, 包含 ${entries.length} 个条目`);
    } catch (e) {
        log('WARN', `读取目录失败: ${dir}, 错误: ${e.message}`);
        return;
    }

    for (const entry of entries) {
        if (isStopped) {
            log('INFO', `扫描已停止，停止处理: ${entry.name}`);
            break;
        }

        const fullPath = path.join(dir, entry.name);

        try {
            if (entry.isDirectory()) {
                // 跳过隐藏目录和系统目录
                if (entry.name.startsWith('.') || entry.name.startsWith('$')) {
                    continue;
                }
                // 跳过常见非图片目录
                const skipDirs = ['node_modules', 'System Volume Information', '$RECYCLE.BIN', 'Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', 'AppData', 'OneDrive', 'OneDrive - Personal'];
                if (skipDirs.includes(entry.name)) {
                    continue;
                }
                log('DEBUG', `进入子目录: ${fullPath}`);
                // 发送当前目录信息
                parentPort.postMessage({
                    type: 'directory',
                    data: { directory: fullPath }
                });
                scanDir(fullPath, batch);
            } else if (entry.isFile()) {
                totalScanned++;

                // 进度报告（每 500 个文件，减少日志频率）
                if (totalScanned % 500 === 0) {
                    parentPort.postMessage({
                        type: 'progress',
                        data: {
                            status: `已扫描 ${totalScanned} 个文件，发现 ${totalImages} 张图片...`,
                            scanned: totalScanned,
                            count: totalImages
                        }
                    });
                }

                if (shouldExclude(entry.name)) {
                    continue;
                }
                if (!isImageFile(entry.name)) {
                    continue;
                }

                let stats;
                try {
                    stats = fs.statSync(fullPath);
                } catch (e) {
                    // 文件可能被删除或无法访问，跳过
                    continue;
                }

                // 跳过空文件
                if (stats.size === 0) {
                    continue;
                }

                // 获取图片尺寸
                const { width, height } = getImageDimensions(fullPath);

                const imageInfo = {
                    path: fullPath,
                    name: entry.name,
                    ext: path.extname(entry.name).toLowerCase(),
                    size: stats.size,
                    sizeStr: formatSize(stats.size),
                    width: width,
                    height: height,
                    resolution: width > 0 && height > 0 ? `${width}x${height}` : null,
                    modified: stats.mtime.toISOString(),
                    created: stats.birthtime.toISOString()
                };

                batch.push(imageInfo);
                allBatchImages.push(imageInfo);
                totalImages++;

                // 批次发送
                if (batch.length >= BATCH_SIZE) {
                    parentPort.postMessage({
                        type: 'batch',
                        data: [...batch]
                    });
                    batch.length = 0;
                }
            }
        } catch (e) {
            // 单个文件/目录处理错误不影响整体扫描
            log('WARN', `处理出错: ${fullPath}, 错误: ${e.message}`);
        }
    }
}

// ==================== 监听停止信号 ====================
// 必须在扫描开始前注册，否则停止信号无法被接收！
parentPort.on('message', (msg) => {
    log('INFO', `收到停止信号: ${msg}`);
    if (msg === 'stop') {
        isStopped = true;
        log('INFO', `停止标志已设置，扫描即将停止...`);
    }
});

// ==================== 开始扫描 ====================
const { drives } = workerData;

log('INFO', `========== 开始扫描 ==========`);
log('INFO', `扫描驱动器: ${drives.join(', ')}`);
log('INFO', `图片扩展名: ${[...IMAGE_EXTS].join(', ')}`);

parentPort.postMessage({
    type: 'progress',
    data: { status: '开始扫描...', scanned: 0, count: 0 }
});

// 创建批次数组用于累积
const initialBatch = [];

for (const drive of drives) {
    if (isStopped) {
        log('INFO', '扫描已停止');
        break;
    }
    const root = drive.endsWith('\\') ? drive : drive + '\\';
    log('INFO', `开始扫描根目录: ${root}`);
    scanDir(root, initialBatch);
}

// 发送剩余数据（使用 allBatchImages 确保数据不丢失）
log('INFO', `扫描完成，发送剩余批次数据`);

// 这里应该发送 initialBatch 中剩余的数据
if (initialBatch.length > 0) {
    log('INFO', `发送最后批次: ${initialBatch.length} 张图片`);
    parentPort.postMessage({
        type: 'batch',
        data: [...initialBatch]
    });
}

// 完成
const duration = ((Date.now() - startTime) / 1000).toFixed(1);
log('INFO', `========== 扫描完成 ==========`);
log('INFO', `总计: 扫描 ${totalScanned} 个文件，发现 ${totalImages} 张图片，耗时 ${duration} 秒`);

parentPort.postMessage({
    type: 'complete',
    data: { total: totalImages, scanned: totalScanned, duration }
});

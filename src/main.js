/**
 * ImageCollector - 图片搜集器
 * 主进程入口文件
 * 版本: 2.0.0
 */

'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const log = require('electron-log');

// 禁用 GPU 加速，解决 GPU 进程崩溃问题
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');

// 财神图标路径
const GODDESS_ICON = 'C:\\Users\\ZTSK\\Downloads\\财神爷捧大金元.png';

// ==================== 路径配置 ====================
// 应用基础目录
const APP_DIR = app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..');
// 配置文件路径
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

// 默认配置
const DEFAULT_CONFIG = {
    initialized: false,
    dataDir: '',           // 数据目录（数据库、收藏夹）
    cacheDir: '',          // 缓存目录（缩略图）
    downloadDir: '',       // 下载目录
    mode: 'standard',      // 工作模式
    theme: 'light'         // 主题
};

// 动态路径（从配置读取）
let config = { ...DEFAULT_CONFIG };

// 初始化后的路径
let LOG_DIR = '';
let DATA_DIR = '';
let USERS_FILE = '';
let SALT_FILE = '';
let THUMB_DIR = '';
let SCAN_CACHE_FILE = '';
let LOG_FILE_APP = '';

// ==================== 日志配置 ====================
log.transports.file.level = 'debug';
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.transports.file.maxSize = 10 * 1024 * 1024;
log.transports.console.level = 'debug';

// ==================== 全局状态 ====================
let mainWindow = null;
let loginWindow = null;
let scanWorker = null;
let isQuitting = false;
let encryptKey = null;

// ==================== 配置管理 ====================
function loadConfig() {
    writeLog('DEBUG', 'Config', '加载配置文件');
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            config = { ...DEFAULT_CONFIG, ...JSON.parse(data) };
            writeLog('INFO', 'Config', '配置加载成功', { initialized: config.initialized });
        } else {
            writeLog('INFO', 'Config', '配置文件不存在，使用默认配置');
            config = { ...DEFAULT_CONFIG };
        }
    } catch (e) {
        writeLog('ERROR', 'Config', `加载配置失败: ${e.message}`);
        config = { ...DEFAULT_CONFIG };
    }
    return config;
}

function saveConfig(newConfig) {
    writeLog('DEBUG', 'Config', '保存配置文件');
    try {
        config = { ...config, ...newConfig };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
        writeLog('INFO', 'Config', '配置保存成功');
        return true;
    } catch (e) {
        writeLog('ERROR', 'Config', `保存配置失败: ${e.message}`);
        return false;
    }
}

function initPaths() {
    writeLog('INFO', 'Paths', '初始化路径配置');
    
    // 确定基础目录（用于绿色安装包）
    const baseDir = config.dataDir || app.getPath('userData');
    
    DATA_DIR = path.join(baseDir, 'data');
    LOG_DIR = config.dataDir ? path.join(config.dataDir, 'logs') : path.join(app.getPath('userData'), 'logs');
    THUMB_DIR = config.cacheDir || path.join(app.getPath('userData'), 'thumbnails');
    
    USERS_FILE = path.join(DATA_DIR, 'users.dat');
    SALT_FILE = path.join(DATA_DIR, '.salt');
    SCAN_CACHE_FILE = path.join(DATA_DIR, 'scan_cache.json');
    LOG_FILE_APP = path.join(LOG_DIR, 'app.log');
    
    // 更新日志路径
    log.transports.file.resolvePathFn = () => LOG_FILE_APP;
    
    writeLog('INFO', 'Paths', '路径配置完成', {
        DATA_DIR, LOG_DIR, THUMB_DIR,
        LOG_FILE_APP
    });
}

// ==================== 日志写入函数 ====================
function writeLog(level, category, message, data = null) {
    const timestamp = new Date().toISOString();
    let logMsg = `[${timestamp}] [${level}] [${category}] ${message}`;
    if (data) {
        logMsg += ` | ${JSON.stringify(data)}`;
    }
    
    switch (level) {
        case 'DEBUG': log.debug(logMsg); break;
        case 'INFO': log.info(logMsg); break;
        case 'WARN': log.warn(logMsg); break;
        case 'ERROR': log.error(logMsg); break;
        default: log.info(logMsg);
    }
}

// ==================== 工具函数 ====================
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        writeLog('INFO', 'Dir', `创建目录成功: ${dir}`);
    }
}

function initAppDirs() {
    writeLog('INFO', 'App', '初始化应用目录', { LOG_DIR, DATA_DIR, THUMB_DIR });
    ensureDir(LOG_DIR);
    ensureDir(DATA_DIR);
    ensureDir(THUMB_DIR);
    ensureDir(path.join(DATA_DIR, 'logs'));

    if (fs.existsSync(SALT_FILE)) {
        encryptKey = fs.readFileSync(SALT_FILE);
        writeLog('INFO', 'Crypto', '加载加密盐成功');
    } else {
        encryptKey = crypto.randomBytes(32);
        fs.writeFileSync(SALT_FILE, encryptKey, { mode: 0o600 });
        writeLog('INFO', 'Crypto', '生成并保存加密盐');
    }
}



// ==================== 加密 ====================
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt + encryptKey.toString('hex'), 100000, 32, 'sha256').toString('hex');
    writeLog('DEBUG', 'Crypto', '密码哈希生成完成', { saltLength: salt.length, hashLength: hash.length });
    return { salt, hash };
}

function verifyPassword(password, stored) {
    try {
        const hash = crypto.pbkdf2Sync(
            password,
            stored.salt + encryptKey.toString('hex'),
            100000, 32, 'sha256'
        ).toString('hex');
        const result = crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(stored.hash, 'hex'));
        writeLog('DEBUG', 'Auth', `密码验证结果: ${result}`);
        return result;
    } catch (e) {
        writeLog('ERROR', 'Crypto', `密码验证异常: ${e.message}`);
        return false;
    }
}

// ==================== 用户管理 ====================
function loadUsers() {
    writeLog('DEBUG', 'UserManager', '开始加载用户数据');
    if (!fs.existsSync(USERS_FILE)) {
        writeLog('INFO', 'UserManager', '用户文件不存在，返回空对象');
        return {};
    }
    try {
        const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        writeLog('DEBUG', 'UserManager', `用户数据加载成功，用户数: ${Object.keys(users).length}`);
        return users;
    } catch (e) {
        writeLog('ERROR', 'UserManager', `读取用户数据失败: ${e.message}`);
        return {};
    }
}

function saveUsers(users) {
    writeLog('DEBUG', 'UserManager', '开始保存用户数据');
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), { mode: 0o600 });
        writeLog('INFO', 'UserManager', '用户数据保存成功');
    } catch (e) {
        writeLog('ERROR', 'UserManager', `保存用户数据失败: ${e.message}`);
        throw e;
    }
}

function hasUsers() {
    const users = loadUsers();
    const count = Object.keys(users).length;
    writeLog('DEBUG', 'UserManager', `检查用户存在性: ${count > 0 ? '有用户' : '无用户'}`);
    return count > 0;
}

function registerUser(username, password) {
    writeLog('INFO', 'Auth', '========== 注册请求开始 ==========');
    writeLog('INFO', 'Auth', `请求用户名: "${username}"`);
    
    if (!username || username.length < 3 || username.length > 20) {
        writeLog('WARN', 'Auth', '注册失败: 用户名长度不符合要求');
        return { success: false, message: '用户名需 3~20 个字符' };
    }
    const isValid = /^[a-zA-Z0-9_]+$/.test(username);
    writeLog('INFO', 'Auth', `正则验证结果: ${isValid}`);
    if (!isValid) {
        writeLog('WARN', 'Auth', '注册失败: 用户名格式不符合要求');
        return { success: false, message: '用户名只允许英文、数字和下划线' };
    }
    if (!password || password.length < 6 || password.length > 30) {
        writeLog('WARN', 'Auth', '注册失败: 密码长度不符合要求');
        return { success: false, message: '密码需 6~30 个字符' };
    }

    const users = loadUsers();
    
    if (users[username]) {
        writeLog('WARN', 'Auth', '注册失败: 用户名已被占用');
        return { success: false, message: '用户名已被占用' };
    }

    const { salt, hash } = hashPassword(password);
    users[username] = { salt, hash, createdAt: new Date().toISOString(), lastLogin: null };

    try {
        saveUsers(users);
    } catch (e) {
        writeLog('ERROR', 'Auth', '注册失败: 保存用户数据异常');
        return { success: false, message: '注册失败，请检查磁盘权限' };
    }

    writeLog('INFO', 'Auth', '========== 注册成功 ==========');
    return { success: true, message: '注册成功！' };
}

function loginUser(username, password) {
    writeLog('INFO', 'Auth', '========== 登录请求开始 ==========');
    
    const users = loadUsers();

    if (!users[username]) {
        writeLog('WARN', 'Auth', '登录失败: 用户不存在');
        return { success: false, message: '账户不存在，请先注册', code: 'USER_NOT_FOUND' };
    }

    const user = users[username];
    if (!verifyPassword(password, user)) {
        writeLog('WARN', 'Auth', '登录失败: 密码错误');
        return { success: false, message: '用户名或密码错误' };
    }

    users[username].lastLogin = new Date().toISOString();
    saveUsers(users);

    writeLog('INFO', 'Auth', '========== 登录成功 ==========');
    return { success: true, message: '登录成功', username };
}

function changePassword(username, oldPwd, newPwd) {
    writeLog('INFO', 'Auth', `修改密码请求: ${username}`);
    const users = loadUsers();

    if (!users[username]) {
        writeLog('WARN', 'Auth', '修改密码失败: 用户不存在');
        return { success: false, message: '用户不存在' };
    }
    if (!verifyPassword(oldPwd, users[username])) {
        writeLog('WARN', 'Auth', '修改密码失败: 旧密码错误');
        return { success: false, message: '旧密码错误' };
    }
    if (!newPwd || newPwd.length < 6) {
        writeLog('WARN', 'Auth', '修改密码失败: 新密码长度不足');
        return { success: false, message: '新密码至少 6 位' };
    }

    const { salt, hash } = hashPassword(newPwd);
    users[username].salt = salt;
    users[username].hash = hash;
    saveUsers(users);

    writeLog('INFO', 'Auth', '修改密码成功');
    return { success: true, message: '密码修改成功' };
}

// ==================== 驱动器检测 ====================
function getAvailableDrives() {
    writeLog('DEBUG', 'System', '开始检测可用驱动器');
    const drives = [];
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    for (const letter of letters) {
        const drivePath = `${letter}:\\`;
        try {
            fs.accessSync(drivePath, fs.constants.F_OK);
            drives.push(`${letter}:`);
        } catch {}
    }
    writeLog('INFO', 'System', `检测到驱动器: ${drives.join(', ')}`);
    return drives;
}

// ==================== 扫描结果持久化 ====================
function loadScanCache() {
    writeLog('DEBUG', 'Cache', '开始加载扫描缓存');
    if (!fs.existsSync(SCAN_CACHE_FILE)) {
        writeLog('INFO', 'Cache', '扫描缓存文件不存在');
        return null;
    }
    try {
        const data = JSON.parse(fs.readFileSync(SCAN_CACHE_FILE, 'utf8'));
        const cacheTime = new Date(data.timestamp).getTime();
        const now = Date.now();
        if (now - cacheTime > 24 * 60 * 60 * 1000) {
            writeLog('INFO', 'Cache', '扫描缓存已过期（24小时）');
            return null;
        }
        writeLog('INFO', 'Cache', `扫描缓存加载成功，图片数: ${data.images?.length || 0}`);
        return data.images || [];
    } catch (e) {
        writeLog('ERROR', 'Cache', `读取扫描缓存失败: ${e.message}`);
        return null;
    }
}

function saveScanCache(images) {
    writeLog('DEBUG', 'Cache', '开始保存扫描缓存');
    try {
        fs.writeFileSync(SCAN_CACHE_FILE, JSON.stringify({
            timestamp: new Date().toISOString(),
            images: images
        }, null, 2), { mode: 0o600 });
        writeLog('INFO', 'Cache', `扫描缓存已保存，图片数: ${images.length}`);
    } catch (e) {
        writeLog('ERROR', 'Cache', `保存扫描缓存失败: ${e.message}`);
    }
}

function clearScanCache() {
    writeLog('INFO', 'Cache', '清除扫描缓存请求');
    if (fs.existsSync(SCAN_CACHE_FILE)) {
        fs.unlinkSync(SCAN_CACHE_FILE);
        writeLog('INFO', 'Cache', '扫描缓存已清除');
    }
}

// ==================== 图片扫描 ====================
const { Worker } = require('worker_threads');

function startImageScan(drives) {
    writeLog('INFO', 'Scanner', '========== 开始图片扫描 ==========');
    writeLog('INFO', 'Scanner', `扫描驱动器: ${drives.join(', ')}`);

    if (scanWorker) {
        writeLog('WARN', 'Scanner', '终止已有的扫描 Worker');
        scanWorker.terminate();
        scanWorker = null;
    }

    const workerPath = path.join(__dirname, 'scanner-worker.js');
    writeLog('DEBUG', 'Scanner', `Worker 路径: ${workerPath}`);

    scanWorker = new Worker(workerPath, {
        workerData: { drives }
    });

    let allImages = [];

    scanWorker.on('message', (msg) => {
        writeLog('DEBUG', 'Scanner', `收到 Worker 消息: ${msg.type}`);
        if (!mainWindow || mainWindow.isDestroyed()) {
            writeLog('WARN', 'Scanner', '主窗口不存在，跳过消息处理');
            return;
        }

        switch (msg.type) {
            case 'progress':
                writeLog('INFO', 'Scanner', `扫描进度: ${msg.data.status}`);
                mainWindow.webContents.send('scan-progress', msg.data);
                break;
            case 'directory':
                mainWindow.webContents.send('scan-directory', msg.data);
                break;
            case 'batch':
                writeLog('INFO', 'Scanner', `收到图片批次: ${msg.data.length} 张`);
                allImages = allImages.concat(msg.data);
                writeLog('DEBUG', 'Scanner', `当前累计图片数: ${allImages.length}`);
                mainWindow.webContents.send('scan-batch', msg.data);
                break;
            case 'complete':
                writeLog('INFO', 'Scanner', '========== 扫描完成 ==========');
                writeLog('INFO', 'Scanner', `总图片数: ${msg.data.total}, 扫描文件数: ${msg.data.scanned}, 耗时: ${msg.data.duration}秒`);
                saveScanCache(allImages);
                mainWindow.webContents.send('scan-complete', { ...msg.data, images: allImages });
                scanWorker = null;
                break;
            case 'error':
                writeLog('ERROR', 'Scanner', `扫描错误: ${msg.data}`);
                mainWindow.webContents.send('scan-error', msg.data);
                break;
        }
    });

    scanWorker.on('error', (err) => {
        writeLog('ERROR', 'Scanner', `Worker 异常: ${err.message}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('scan-error', err.message);
        }
    });

    scanWorker.on('exit', (code) => {
        if (code !== 0) {
            writeLog('WARN', 'Scanner', `Worker 异常退出, code: ${code}`);
        } else {
            writeLog('INFO', 'Scanner', `Worker 正常退出, code: ${code}`);
        }
        scanWorker = null;
    });
}

function stopImageScan() {
    writeLog('INFO', 'Scanner', '========== 停止扫描 ==========');
    if (scanWorker) {
        writeLog('INFO', 'Scanner', '发送停止信号到 Worker');
        scanWorker.postMessage('stop');
        scanWorker.terminate();
        scanWorker = null;
        writeLog('INFO', 'Scanner', '扫描已停止');
    }
}

// ==================== 缩略图生成 ====================
function generateThumbnail(imagePath, width = 200, height = 200) {
    writeLog('DEBUG', 'Thumbnail', `生成缩略图请求: ${imagePath}`);
    try {
        if (!fs.existsSync(imagePath)) {
            writeLog('WARN', 'Thumbnail', `文件不存在: ${imagePath}`);
            return null;
        }
        
        const normalizedPath = path.normalize(imagePath);
        writeLog('DEBUG', 'Thumbnail', `标准化路径: ${normalizedPath}`);
        
        let imageBuffer;
        try {
            imageBuffer = fs.readFileSync(normalizedPath);
        } catch (readErr) {
            writeLog('ERROR', 'Thumbnail', `读取文件失败: ${readErr.message}`);
            return null;
        }
        
        const ext = path.extname(normalizedPath).toLowerCase();
        const mimeTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.bmp': 'image/bmp',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon'
        };
        const mimeType = mimeTypes[ext] || 'image/jpeg';
        
        let nativeImg = null;
        try {
            nativeImg = nativeImage.createFromPath(normalizedPath);
            if (!nativeImg.isEmpty()) {
                const size = nativeImg.getSize();
                if (size.width && size.height) {
                    writeLog('DEBUG', 'Thumbnail', `nativeImage 加载成功，尺寸: ${size.width}x${size.height}`);
                    const ratio = Math.min(width / size.width, height / size.height);
                    const newSize = {
                        width: Math.round(size.width * ratio),
                        height: Math.round(size.height * ratio)
                    };
                    const thumb = nativeImg.resize(newSize, { quality: 'good' });
                    const result = thumb.toDataURL();
                    writeLog('DEBUG', 'Thumbnail', `缩略图生成成功，尺寸: ${newSize.width}x${newSize.height}`);
                    return result;
                }
            }
        } catch (nativeErr) {
            writeLog('WARN', 'Thumbnail', `nativeImage 加载失败，尝试 Buffer: ${nativeErr.message}`);
        }
        
        try {
            const base64 = imageBuffer.toString('base64');
            const dataUrl = `data:${mimeType};base64,${base64}`;
            nativeImg = nativeImage.createFromDataURL(dataUrl);
            
            if (!nativeImg.isEmpty()) {
                const size = nativeImg.getSize();
                if (size.width && size.height) {
                    writeLog('DEBUG', 'Thumbnail', `Buffer 方式加载成功，尺寸: ${size.width}x${size.height}`);
                    const ratio = Math.min(width / size.width, height / size.height);
                    const newSize = {
                        width: Math.round(size.width * ratio),
                        height: Math.round(size.height * ratio)
                    };
                    const thumb = nativeImg.resize(newSize, { quality: 'good' });
                    const result = thumb.toDataURL();
                    writeLog('DEBUG', 'Thumbnail', `缩略图生成成功，尺寸: ${newSize.width}x${newSize.height}`);
                    return result;
                }
            }
        } catch (bufferErr) {
            writeLog('ERROR', 'Thumbnail', `Buffer 方式失败: ${bufferErr.message}`);
        }
        
        writeLog('WARN', 'Thumbnail', '所有方式都无法加载图片');
        return null;
    } catch (e) {
        writeLog('ERROR', 'Thumbnail', `生成缩略图异常: ${imagePath}, 错误: ${e.message}`);
        return null;
    }
}

// ==================== 收藏功能 ====================
function getFavoritesFile(username) {
    return path.join(DATA_DIR, `${username}_favorites.json`);
}

function loadFavorites(username) {
    writeLog('DEBUG', 'Favorites', `加载收藏列表: ${username}`);
    const file = getFavoritesFile(username);
    if (!fs.existsSync(file)) {
        writeLog('INFO', 'Favorites', '收藏文件不存在，返回空列表');
        return [];
    }
    try {
        const favorites = JSON.parse(fs.readFileSync(file, 'utf8'));
        writeLog('INFO', 'Favorites', `收藏列表加载成功，数量: ${favorites.length}`);
        return favorites;
    } catch (e) {
        writeLog('ERROR', 'Favorites', `加载收藏失败: ${e.message}`);
        return [];
    }
}

function saveFavorites(username, favorites) {
    writeLog('DEBUG', 'Favorites', `保存收藏列表: ${username}, 数量: ${favorites.length}`);
    const file = getFavoritesFile(username);
    try {
        fs.writeFileSync(file, JSON.stringify(favorites, null, 2), { mode: 0o600 });
        writeLog('INFO', 'Favorites', '收藏列表保存成功');
    } catch (e) {
        writeLog('ERROR', 'Favorites', `保存收藏失败: ${e.message}`);
    }
}

// ==================== 文件操作 ====================
async function deleteFile(filePath) {
    writeLog('INFO', 'File', `========== 删除文件 ==========`);
    writeLog('INFO', 'File', `文件路径: ${filePath}`);
    try {
        if (!fs.existsSync(filePath)) {
            writeLog('WARN', 'File', '文件不存在');
            return { success: false, message: '文件不存在' };
        }
        writeLog('INFO', 'File', '将文件移到回收站');
        await shell.trashItem(filePath);
        writeLog('INFO', 'File', '文件已移到回收站');
        return { success: true };
    } catch (e) {
        writeLog('ERROR', 'File', `删除失败: ${e.message}`);
        return { success: false, message: e.message };
    }
}

async function copyFileToDirectory(sourcePath, targetDir) {
    writeLog('INFO', 'File', `========== 复制文件到目录 ==========`);
    writeLog('INFO', 'File', `源文件: ${sourcePath}`);
    writeLog('INFO', 'File', `目标目录: ${targetDir}`);
    
    try {
        ensureDir(targetDir);
        
        const fileName = path.basename(sourcePath);
        let targetPath = path.join(targetDir, fileName);
        
        // 如果文件已存在，添加序号
        let counter = 1;
        while (fs.existsSync(targetPath)) {
            const ext = path.extname(fileName);
            const base = path.basename(fileName, ext);
            targetPath = path.join(targetDir, `${base}_${counter}${ext}`);
            counter++;
        }
        
        fs.copyFileSync(sourcePath, targetPath);
        writeLog('INFO', 'File', `文件已复制: ${targetPath}`);
        return { success: true, path: targetPath };
    } catch (e) {
        writeLog('ERROR', 'File', `复制失败: ${e.message}`);
        return { success: false, message: e.message };
    }
}

// ==================== 窗口管理 ====================
// 使用财神图标
const ICON_PATH = GODDESS_ICON;

function createLoginWindow() {
    writeLog('INFO', 'Window', '========== 创建登录窗口 ==========');
    
    if (loginWindow && !loginWindow.isDestroyed()) {
        writeLog('INFO', 'Window', '登录窗口已存在，聚焦');
        loginWindow.focus();
        return;
    }

    loginWindow = new BrowserWindow({
        width: 900,
        height: 780,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        title: '图片搜集器 v1.1.0 · 登录',
        icon: ICON_PATH,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            devTools: !app.isPackaged
        },
        autoHideMenuBar: true,
        show: false
    });

    writeLog('INFO', 'Window', `加载登录页面: ${path.join(__dirname, 'index.html')}`);
    loginWindow.loadFile(path.join(__dirname, 'index.html'));
    loginWindow.once('ready-to-show', () => {
        writeLog('INFO', 'Window', '登录窗口准备好显示');
        loginWindow.show();
    });
    loginWindow.on('closed', () => {
        writeLog('INFO', 'Window', '登录窗口已关闭');
        loginWindow = null;
    });
}

function createMainWindow(username) {
    writeLog('INFO', 'Window', '========== 创建主窗口 ==========');
    
    if (mainWindow && !mainWindow.isDestroyed()) {
        writeLog('INFO', 'Window', '主窗口已存在，聚焦');
        mainWindow.focus();
        return;
    }

    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        title: '图片搜集器 v1.1.0',
        icon: ICON_PATH,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            devTools: !app.isPackaged
        },
        autoHideMenuBar: true,
        show: false
    });

    mainWindow.loadFile(path.join(__dirname, 'main.html'));

    mainWindow.once('ready-to-show', () => {
        writeLog('INFO', 'Window', '主窗口准备好显示');
        mainWindow.show();
    });

    mainWindow.on('closed', () => {
        writeLog('INFO', 'Window', '主窗口已关闭');
        mainWindow = null;
    });
}

// ==================== IPC 处理器注册 ====================
function registerIpcHandlers() {
    writeLog('INFO', 'IPC', '========== 注册 IPC 处理器 ==========');

    // ===== 安装向导相关 =====
    ipcMain.handle('setup:get-defaults', async () => {
        writeLog('DEBUG', 'IPC', 'setup:get-defaults 被调用');
        // 默认使用用户目录
        const defaultDataDir = path.join(app.getPath('documents'), 'ImageCollector');
        const defaultCacheDir = path.join(app.getPath('userData'), 'thumbnails');
        const defaultDownloadDir = app.getPath('downloads');
        return {
            dataDir: defaultDataDir,
            cacheDir: defaultCacheDir,
            downloadDir: defaultDownloadDir
        };
    });

    ipcMain.handle('setup:create-directories', async (event, cfg) => {
        writeLog('INFO', 'IPC', 'setup:create-directories 被调用', cfg);
        try {
            if (cfg.dataDir) ensureDir(cfg.dataDir);
            if (cfg.cacheDir) ensureDir(cfg.cacheDir);
            if (cfg.downloadDir) ensureDir(cfg.downloadDir);
            return { success: true };
        } catch (e) {
            writeLog('ERROR', 'IPC', `创建目录失败: ${e.message}`);
            return { success: false, message: e.message };
        }
    });

    // 使用主目录创建所有子目录
    ipcMain.handle('setup:create-with-main-dir', async (event, mainDir) => {
        writeLog('INFO', 'IPC', `setup:create-with-main-dir 被调用: ${mainDir}`);
        try {
            // 创建主目录
            ensureDir(mainDir);
            
            // 创建子目录
            const dataDir = path.join(mainDir, 'data');
            const cacheDir = path.join(mainDir, 'cache');
            const downloadDir = path.join(mainDir, 'downloads');
            const logsDir = path.join(mainDir, 'logs');
            
            ensureDir(dataDir);
            ensureDir(cacheDir);
            ensureDir(downloadDir);
            ensureDir(logsDir);
            
            // 保存配置
            const saveResult = saveConfig({
                initialized: true,
                dataDir: dataDir,
                cacheDir: cacheDir,
                downloadDir: downloadDir
            });

            if (!saveResult) {
                return { success: false, message: '保存配置失败' };
            }

            // 重新初始化路径
            initPaths();
            
            writeLog('INFO', 'IPC', 'setup:create-with-main-dir 完成');
            return { success: true };
        } catch (e) {
            writeLog('ERROR', 'IPC', `创建目录失败: ${e.message}`);
            return { success: false, message: e.message };
        }
    });

    ipcMain.handle('check-setup', async () => {
        writeLog('DEBUG', 'IPC', 'check-setup 被调用');
        return config.initialized;
    });

    // 保存安装配置
    ipcMain.handle('save-setup-config', async (event, cfg) => {
        writeLog('INFO', 'IPC', 'save-setup-config 被调用', cfg);
        const success = saveConfig(cfg);
        if (success) {
            initPaths();
        }
        return { success };
    });

    // ===== 对话框 =====
    ipcMain.handle('dialog:select-directory', async () => {
        writeLog('DEBUG', 'IPC', 'dialog:select-directory 被调用');
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory']
        });
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }
        return result.filePaths[0];
    });

    // 通用目录选择
    ipcMain.handle('select-directory', async () => {
        writeLog('DEBUG', 'IPC', 'select-directory 被调用');
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
            title: '选择目录'
        });
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }
        return result.filePaths[0];
    });

    // ===== 用户认证 =====
    ipcMain.handle('check-users', async () => {
        writeLog('DEBUG', 'IPC', 'check-users 被调用');
        return hasUsers();
    });

    ipcMain.handle('register', async (event, { username, password }) => {
        writeLog('DEBUG', 'IPC', `register 被调用: ${username}`);
        return registerUser(username, password);
    });

    ipcMain.handle('login', async (event, { username, password }) => {
        writeLog('DEBUG', 'IPC', `login 被调用: ${username}`);
        return loginUser(username, password);
    });

    ipcMain.handle('change-password', async (event, { username, oldPwd, newPwd }) => {
        writeLog('DEBUG', 'IPC', `change-password 被调用: ${username}`);
        return changePassword(username, oldPwd, newPwd);
    });

    ipcMain.handle('show-main-window', async (event, username) => {
        writeLog('INFO', 'IPC', `show-main-window 被调用: ${username}`);
        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.close();
        }
        createMainWindow(username);
        return { success: true };
    });

    ipcMain.handle('confirm-exit', async () => {
        writeLog('INFO', 'IPC', 'confirm-exit 被调用 - 将完全退出程序');
        
        if (scanWorker) {
            scanWorker.postMessage('stop');
            scanWorker.terminate();
            scanWorker = null;
        }
        
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.destroy();
        }
        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.destroy();
        }
        
        isQuitting = true;
        app.quit();
        
        return { success: true };
    });

    ipcMain.handle('logout', async () => {
        writeLog('INFO', 'IPC', 'logout 被调用 - 返回登录');
        
        if (scanWorker) {
            scanWorker.postMessage('stop');
            scanWorker.terminate();
            scanWorker = null;
        }
        
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.close();
        }
        
        if (!loginWindow || loginWindow.isDestroyed()) {
            createLoginWindow();
        } else {
            loginWindow.show();
        }
        return { success: true };
    });

    // ===== 驱动器 =====
    ipcMain.handle('get-drives', async () => {
        return getAvailableDrives();
    });

    // ===== 扫描 =====
    ipcMain.handle('load-scan-cache', async () => {
        return loadScanCache();
    });

    ipcMain.handle('start-scan', async (event, drives) => {
        startImageScan(drives);
        return { success: true };
    });

    ipcMain.handle('stop-scan', async () => {
        stopImageScan();
        return { success: true };
    });

    // ===== 缩略图 =====
    ipcMain.handle('get-thumbnail', async (event, imagePath) => {
        return generateThumbnail(imagePath);
    });

    ipcMain.handle('get-image-data-url', async (event, { imagePath, maxDim }) => {
        const nativeImage = require('electron').nativeImage;
        const fs = require('fs');
        try {
            if (!fs.existsSync(imagePath)) return null;
            let img = nativeImage.createFromPath(imagePath);
            if (img.isEmpty()) return null;
            
            // 缩放
            let size = img.getSize();
            if (size.width > maxDim || size.height > maxDim) {
                const scale = maxDim / Math.max(size.width, size.height);
                img = img.resize({
                    width: Math.round(size.width * scale),
                    height: Math.round(size.height * scale),
                    quality: 'low'
                });
            }
            
            return img.toDataURL('image/png');
        } catch (e) {
            return null;
        }
    });

    ipcMain.handle('get-thumbnails', async (event, imagePaths) => {
        writeLog('DEBUG', 'IPC', `get-thumbnails 被调用，图片数: ${imagePaths.length}`);
        const thumbnails = {};
        for (const imagePath of imagePaths) {
            thumbnails[imagePath] = generateThumbnail(imagePath);
        }
        return thumbnails;
    });

    // ===== 收藏 =====
    ipcMain.handle('get-favorites', async (event, username) => {
        return loadFavorites(username);
    });

    ipcMain.handle('toggle-favorite', async (event, { username, imagePath, imageInfo }) => {
        writeLog('DEBUG', 'IPC', `toggle-favorite: ${username}, ${imagePath}`);
        const favorites = loadFavorites(username);
        const idx = favorites.findIndex(f => f.path === imagePath);
        let isFavorite = false;
        if (idx >= 0) {
            favorites.splice(idx, 1);
            isFavorite = false;
        } else {
            favorites.push(imageInfo);
            isFavorite = true;
        }
        saveFavorites(username, favorites);
        return { success: true, isFavorite };
    });

    ipcMain.handle('save-favorites', async (event, username, favorites) => {
        saveFavorites(username, favorites);
        return { success: true };
    });

    // ===== 文件操作 =====
    ipcMain.handle('delete-file', async (event, filePath) => {
        return await deleteFile(filePath);
    });

    ipcMain.handle('delete-files', async (event, filePaths) => {
        const results = [];
        for (const filePath of filePaths) {
            results.push(await deleteFile(filePath));
        }
        return results;
    });

    ipcMain.handle('copy-file-to-download', async (event, sourcePath) => {
        const targetDir = config.downloadDir || app.getPath('downloads');
        return await copyFileToDirectory(sourcePath, targetDir);
    });

    ipcMain.handle('copy-files-to-download', async (event, sourcePaths) => {
        const targetDir = config.downloadDir || app.getPath('downloads');
        const results = [];
        for (const sourcePath of sourcePaths) {
            results.push(await copyFileToDirectory(sourcePath, targetDir));
        }
        return results;
    });

    ipcMain.handle('select-download-dir', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
            title: '选择下载目录'
        });
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }
        const newDir = result.filePaths[0];
        saveConfig({ downloadDir: newDir });
        return newDir;
    });

    ipcMain.handle('clear-cache', async () => {
        clearScanCache();
        return { success: true };
    });

    ipcMain.handle('open-file-location', async (event, filePath) => {
        writeLog('INFO', 'IPC', `打开文件位置: ${filePath}`);
        try {
            shell.showItemInFolder(filePath);
            return { success: true };
        } catch (e) {
            writeLog('ERROR', 'IPC', `打开文件位置失败: ${e.message}`);
            return { success: false, message: e.message };
        }
    });

    ipcMain.handle('open-file', async (event, filePath) => {
        writeLog('INFO', 'IPC', `打开文件: ${filePath}`);
        try {
            shell.openPath(filePath);
            return { success: true };
        } catch (e) {
            writeLog('ERROR', 'IPC', `打开文件失败: ${e.message}`);
            return { success: false, message: e.message };
        }
    });

    // ===== 配置 =====
    ipcMain.handle('get-config', async () => {
        return config;
    });

    ipcMain.handle('save-config', async (event, newConfig) => {
        const success = saveConfig(newConfig);
        if (success) {
            initPaths();
        }
        return { success };
    });

    // ===== 应用信息 =====
    ipcMain.handle('get-app-info', async () => {
        return {
            version: '1.1.0',
            name: '图片搜集器',
            platform: process.platform,
            config: {
                dataDir: DATA_DIR,
                cacheDir: THUMB_DIR,
                downloadDir: config.downloadDir,
                mode: config.mode
            }
        };
    });

    ipcMain.handle('renderer-log', async (event, { level, category, message }) => {
        writeLog(level, 'Renderer', `${category}: ${message}`);
    });

    // 下载到目录
    ipcMain.handle('select-download-folder', async () => {
        writeLog('INFO', 'IPC', '选择下载目录');
        const result = await dialog.showOpenDialog(mainWindow, {
            title: '选择下载目录',
            properties: ['openDirectory', 'createDirectory']
        });
        writeLog('INFO', 'IPC', `下载目录选择结果: ${JSON.stringify(result)}`);
        return result;
    });

    ipcMain.handle('download-image', async (event, { imagePath, targetDir }) => {
        writeLog('INFO', 'IPC', `下载图片: ${imagePath} -> ${targetDir}`);
        try {
            if (!fs.existsSync(imagePath)) {
                writeLog('ERROR', 'Download', `源文件不存在: ${imagePath}`);
                return { success: false, error: '源文件不存在' };
            }

            const fileName = path.basename(imagePath);
            let targetPath = path.join(targetDir, fileName);

            // 处理文件名冲突
            let counter = 1;
            while (fs.existsSync(targetPath)) {
                const ext = path.extname(fileName);
                const base = path.basename(fileName, ext);
                targetPath = path.join(targetDir, `${base}_${counter}${ext}`);
                counter++;
            }

            fs.copyFileSync(imagePath, targetPath);
            writeLog('INFO', 'Download', `下载成功: ${targetPath}`);
            return { success: true, targetPath };
        } catch (e) {
            writeLog('ERROR', 'Download', `下载失败: ${e.message}`);
            return { success: false, error: e.message };
        }
    });

    // 批量下载图片
    ipcMain.handle('download-images', async (event, { imagePaths, targetDir }) => {
        writeLog('INFO', 'IPC', `批量下载图片: ${imagePaths.length} 张 -> ${targetDir}`);
        const results = {
            success: 0,
            failed: 0,
            errors: []
        };

        try {
            ensureDir(targetDir);

            for (let i = 0; i < imagePaths.length; i++) {
                const imagePath = imagePaths[i];
                try {
                    if (!fs.existsSync(imagePath)) {
                        results.failed++;
                        results.errors.push({ path: imagePath, error: '文件不存在' });
                        continue;
                    }

                    const fileName = path.basename(imagePath);
                    let targetPath = path.join(targetDir, fileName);

                    // 处理文件名冲突
                    let counter = 1;
                    while (fs.existsSync(targetPath)) {
                        const ext = path.extname(fileName);
                        const base = path.basename(fileName, ext);
                        targetPath = path.join(targetDir, `${base}_${counter}${ext}`);
                        counter++;
                    }

                    fs.copyFileSync(imagePath, targetPath);
                    results.success++;
                } catch (e) {
                    results.failed++;
                    results.errors.push({ path: imagePath, error: e.message });
                    writeLog('ERROR', 'Download', `下载失败: ${imagePath}, 错误: ${e.message}`);
                }
            }

            writeLog('INFO', 'Download', `批量下载完成: 成功 ${results.success}, 失败 ${results.failed}`);
            return results;
        } catch (e) {
            writeLog('ERROR', 'Download', `批量下载失败: ${e.message}`);
            return { success: false, error: e.message };
        }
    });

    // ===== 退出应用 =====
    ipcMain.handle('exit-app', async () => {
        writeLog('INFO', 'IPC', 'exit-app 被调用');
        isQuitting = true;
        app.quit();
        return { success: true };
    });

    writeLog('INFO', 'IPC', '========== IPC 处理器注册完成 ==========');
}

// ==================== 应用生命周期 ====================
app.whenReady().then(() => {
    writeLog('INFO', 'App', '========================================');
    writeLog('INFO', 'App', '图片搜集器应用启动');
    writeLog('INFO', 'App', '版本: 2.0.0');
    writeLog('INFO', 'App', '========================================');
    
    // 加载配置
    loadConfig();
    
    // 初始化路径
    initPaths();
    
    // 初始化目录
    initAppDirs();
    
    writeLog('INFO', 'App', '========== Electron 准备就绪 ==========');
    writeLog('INFO', 'App', `平台: ${process.platform} | Electron: ${process.versions.electron} | Node: ${process.versions.node}`);
    writeLog('INFO', 'App', `配置状态: ${config.initialized ? '已初始化' : '未初始化'}`);
    writeLog('INFO', 'App', `数据目录: ${DATA_DIR}`);
    writeLog('INFO', 'App', `日志目录: ${LOG_DIR}`);
    
    registerIpcHandlers();
    
    // 检查是否已初始化
    if (!config.initialized) {
        writeLog('INFO', 'App', '显示初始化设置窗口');
        createSetupWindow();
    } else {
        writeLog('INFO', 'App', '显示登录窗口');
        createLoginWindow();
    }
});

// 创建初始化设置窗口
function createSetupWindow() {
    writeLog('INFO', 'Window', '========== 创建初始化设置窗口 ==========');
    
    const setupWindow = new BrowserWindow({
        width: 520,
        height: 620,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        title: '图片搜集器 v2.0.0 · 初始化设置',
        icon: GODDESS_ICON,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            devTools: !app.isPackaged
        },
        autoHideMenuBar: true,
        show: false
    });

    setupWindow.loadFile(path.join(__dirname, 'setup.html'));
    
    setupWindow.once('ready-to-show', () => {
        writeLog('INFO', 'Window', '初始化设置窗口准备好显示');
        setupWindow.show();
    });
    
    // 监听窗口关闭事件
    setupWindow.on('close', (e) => {
        // 如果不是真正退出，阻止关闭并提示
        if (!isQuitting) {
            e.preventDefault();
            // 使用对话框确认是否退出
            const { dialog } = require('electron');
            dialog.showMessageBox(setupWindow, {
                type: 'question',
                buttons: ['退出', '取消'],
                defaultId: 1,
                title: '确认退出',
                message: '确定要退出图片搜集器吗？',
                detail: '初始化设置未完成，应用将关闭。'
            }).then(({ response }) => {
                if (response === 0) {
                    isQuitting = true;
                    setupWindow.destroy();
                    app.quit();
                }
            });
        }
    });
    
    setupWindow.on('closed', () => {
        writeLog('INFO', 'Window', '初始化设置窗口已关闭');
    });
}

app.on('window-all-closed', () => {
    writeLog('INFO', 'App', '所有窗口已关闭');
    if (process.platform !== 'darwin') {
        isQuitting = true;
        app.quit();
    }
});

app.on('before-quit', () => {
    writeLog('INFO', 'App', '========== 应用准备退出 ==========');
    isQuitting = true;
    
    if (scanWorker) {
        writeLog('INFO', 'App', '终止扫描 Worker');
        scanWorker.terminate();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createLoginWindow();
    }
});

process.on('uncaughtException', (error) => {
    writeLog('ERROR', 'App', `未捕获异常: ${error.message}`, { stack: error.stack });
});

process.on('unhandledRejection', (reason, promise) => {
    writeLog('ERROR', 'App', `未处理 Promise 拒绝: ${reason}`);
});

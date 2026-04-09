/**
 * Preload 脚本
 * 在渲染进程和主进程之间建立安全的通信桥梁
 * 版本: 2.4.0
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 日志函数 - 将渲染进程的日志发送到主进程
function rendererLog(level, category, message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] [Renderer] [${category}] ${message}`);
}

// 监听器清理
const listenerMap = {};
function safeOn(channel, callback) {
    if (listenerMap[channel]) {
        ipcRenderer.removeListener(channel, listenerMap[channel]);
    }
    const wrapper = (_event, data) => callback(data);
    listenerMap[channel] = wrapper;
    ipcRenderer.on(channel, wrapper);
}

contextBridge.exposeInMainWorld('electronAPI', {

    // ===== 渲染进程日志 =====
    log: {
        debug: (category, msg) => {
            rendererLog('DEBUG', category, msg);
            // 同时发送到主进程记录
            ipcRenderer.invoke('renderer-log', { level: 'DEBUG', category, message: msg });
        },
        info: (category, msg) => {
            rendererLog('INFO', category, msg);
            ipcRenderer.invoke('renderer-log', { level: 'INFO', category, message: msg });
        },
        warn: (category, msg) => {
            rendererLog('WARN', category, msg);
            ipcRenderer.invoke('renderer-log', { level: 'WARN', category, message: msg });
        },
        error: (category, msg) => {
            rendererLog('ERROR', category, msg);
            ipcRenderer.invoke('renderer-log', { level: 'ERROR', category, message: msg });
        }
    },

    // ===== 安装向导 =====
    getSetupDefaults: () => {
        rendererLog('DEBUG', 'Preload', 'getSetupDefaults 被调用');
        return ipcRenderer.invoke('setup:get-defaults');
    },
    
    createDirectories: (cfg) => {
        rendererLog('DEBUG', 'Preload', 'createDirectories 被调用');
        return ipcRenderer.invoke('setup:create-directories', cfg);
    },
    
    // 使用主目录创建所有子目录
    createSetupWithMainDir: (mainDir) => {
        rendererLog('DEBUG', 'Preload', `createSetupWithMainDir 被调用: ${mainDir}`);
        return ipcRenderer.invoke('setup:create-with-main-dir', mainDir);
    },
    
    saveSetupConfig: (cfg) => {
        rendererLog('DEBUG', 'Preload', 'saveSetupConfig 被调用');
        return ipcRenderer.invoke('save-setup-config', cfg);
    },
    
    selectDirectory: () => {
        rendererLog('DEBUG', 'Preload', 'selectDirectory 被调用');
        return ipcRenderer.invoke('select-directory');
    },

    // ===== 登录 =====
    checkUsers:    () => {
        rendererLog('DEBUG', 'Preload', 'checkUsers 被调用');
        return ipcRenderer.invoke('check-users');
    },
    register:      (username, password) => {
        rendererLog('DEBUG', 'Preload', `register 被调用: ${username}`);
        return ipcRenderer.invoke('register', { username, password });
    },
    login:         (username, password) => {
        rendererLog('DEBUG', 'Preload', `login 被调用: ${username}`);
        return ipcRenderer.invoke('login', { username, password });
    },
    changePassword: (username, oldPwd, newPwd) => {
        rendererLog('DEBUG', 'Preload', `change-password 被调用: ${username}`);
        return ipcRenderer.invoke('change-password', { username, oldPwd, newPwd });
    },

    // ===== 驱动器 =====
    getDrives: () => {
        rendererLog('DEBUG', 'Preload', 'getDrives 被调用');
        return ipcRenderer.invoke('get-drives');
    },

    // ===== 扫描 =====
    startScan: (drives) => {
        rendererLog('DEBUG', 'Preload', `startScan 被调用: ${drives.join(', ')}`);
        return ipcRenderer.invoke('start-scan', drives);
    },
    stopScan:  () => {
        rendererLog('DEBUG', 'Preload', 'stopScan 被调用');
        return ipcRenderer.invoke('stop-scan');
    },

    // 扫描缓存
    loadScanCache: () => {
        rendererLog('DEBUG', 'Preload', 'loadScanCache 被调用');
        return ipcRenderer.invoke('load-scan-cache');
    },
    clearScanCache: () => {
        rendererLog('DEBUG', 'Preload', 'clearScanCache 被调用');
        return ipcRenderer.invoke('clear-cache');
    },

    // 扫描事件
    onScanProgress:  (cb) => {
        rendererLog('DEBUG', 'Preload', 'onScanProgress 监听器注册');
        safeOn('scan-progress', cb);
    },
    onScanDirectory: (cb) => {
        rendererLog('DEBUG', 'Preload', 'onScanDirectory 监听器注册');
        safeOn('scan-directory', cb);
    },
    onScanBatch:     (cb) => {
        rendererLog('DEBUG', 'Preload', 'onScanBatch 监听器注册');
        safeOn('scan-batch', cb);
    },
    onScanComplete:  (cb) => {
        rendererLog('DEBUG', 'Preload', 'onScanComplete 监听器注册');
        safeOn('scan-complete', cb);
    },
    onScanError:     (cb) => {
        rendererLog('DEBUG', 'Preload', 'onScanError 监听器注册');
        safeOn('scan-error', cb);
    },

    // ===== 缩略图 =====
    getThumbnail: (imagePath) => {
        rendererLog('DEBUG', 'Preload', `getThumbnail 被调用: ${imagePath.substring(0, 50)}...`);
        return ipcRenderer.invoke('get-thumbnail', imagePath);
    },

    // ===== 二维码检测 =====
    getImageDataUrl: (imagePath, maxDim) => {
        rendererLog('DEBUG', 'Preload', `getImageDataUrl 被调用: ${imagePath.substring(0, 50)}...`);
        return ipcRenderer.invoke('get-image-data-url', { imagePath, maxDim: maxDim || 300 });
    },

    // ===== 收藏 =====
    getFavorites:   (username) => {
        rendererLog('DEBUG', 'Preload', `getFavorites 被调用: ${username}`);
        return ipcRenderer.invoke('get-favorites', username);
    },
    toggleFavorite: (username, imagePath, imageInfo) => {
        rendererLog('DEBUG', 'Preload', `toggleFavorite 被调用: ${username}, ${imagePath.substring(0, 50)}...`);
        return ipcRenderer.invoke('toggle-favorite', { username, imagePath, imageInfo });
    },

    // ===== 文件操作 =====
    openFileLocation: (filePath) => {
        rendererLog('INFO', 'Preload', `openFileLocation 被调用: ${filePath.substring(0, 50)}...`);
        ipcRenderer.invoke('open-file-location', filePath);
    },
    openFile:          (filePath) => {
        rendererLog('INFO', 'Preload', `openFile 被调用: ${filePath.substring(0, 50)}...`);
        return ipcRenderer.invoke('open-file', filePath);
    },

    // 删除（移到回收站）
    deleteFile:   (filePath) => {
        rendererLog('INFO', 'Preload', `deleteFile 被调用: ${filePath.substring(0, 50)}...`);
        return ipcRenderer.invoke('delete-file', filePath);
    },
    deleteFiles:  (filePaths) => {
        rendererLog('INFO', 'Preload', `deleteFiles 被调用: ${filePaths.length} 个文件`);
        return ipcRenderer.invoke('delete-files', filePaths);
    },

    // ===== 下载到目录 =====
    selectDownloadFolder: () => {
        rendererLog('INFO', 'Preload', 'selectDownloadFolder 被调用');
        return ipcRenderer.invoke('select-download-folder');
    },
    downloadImage: (imagePath, targetDir) => {
        rendererLog('INFO', 'Preload', `downloadImage 被调用: ${imagePath.substring(0, 50)}...`);
        return ipcRenderer.invoke('download-image', { imagePath, targetDir });
    },
    downloadImages: (imagePaths, targetDir) => {
        rendererLog('INFO', 'Preload', `downloadImages 被调用: ${imagePaths.length} 个文件`);
        return ipcRenderer.invoke('download-images', { imagePaths, targetDir });
    },

    // ===== 窗口控制 =====
    showMainWindow: (username) => {
        rendererLog('INFO', 'Preload', `showMainWindow 被调用: ${username}`);
        return ipcRenderer.invoke('show-main-window', username);
    },
    logout:         () => {
        rendererLog('INFO', 'Preload', 'logout 被调用');
        return ipcRenderer.invoke('logout');
    },
    confirmExit:    () => {
        rendererLog('INFO', 'Preload', 'confirmExit 被调用');
        return ipcRenderer.invoke('confirm-exit');
    },
    exitApp:        () => {
        rendererLog('INFO', 'Preload', 'exitApp 被调用');
        return ipcRenderer.invoke('exit-app');
    },

    // 主进程通知
    onAppClosing: (cb) => {
        rendererLog('DEBUG', 'Preload', 'onAppClosing 监听器注册');
        safeOn('app-closing', cb);
    },

    // ===== 应用信息 =====
    getAppInfo: () => {
        rendererLog('DEBUG', 'Preload', 'getAppInfo 被调用');
        return ipcRenderer.invoke('get-app-info');
    },

    // ===== 清理 =====
    removeListener: (channel) => {
        rendererLog('DEBUG', 'Preload', `removeListener 被调用: ${channel}`);
        if (listenerMap[channel]) {
            ipcRenderer.removeListener(channel, listenerMap[channel]);
            delete listenerMap[channel];
        }
    }
});

rendererLog('INFO', 'Preload', 'Preload 脚本加载完成');

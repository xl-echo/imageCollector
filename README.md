# ImageCollector - 图片搜集器

一款基于 Electron 的桌面图片管理工具，支持快速扫描磁盘图片、缩略图预览、收藏管理、分页浏览、批量下载和批量删除。

## 功能特性

- **用户认证** — 注册/登录系统，PBKDF2 加密存储密码
- **安装向导** — 首次启动引导配置数据目录、缓存目录、下载目录
- **磁盘扫描** — 多线程 Worker 扫描，支持多磁盘同时扫描
- **缩略图预览** — 自动生成缩略图，支持预览面板查看大图
- **收藏管理** — 按用户收藏图片，持久化存储
- **分页浏览** — 支持每页 10/20/30/50 条，页码快速跳转
- **多维度筛选** — 按文件名搜索、按分辨率筛选（≥4K / ≥2K / ≥1080p）
- **排序功能** — 按时间、大小、名称、分辨率排序
- **批量操作** — 批量下载、批量删除（移至回收站）
- **文件操作** — 打开文件位置、打开文件、复制到下载目录
- **扫描缓存** — 24小时缓存机制，避免重复扫描

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Electron | 28.3.x | 桌面应用框架 |
| electron-builder | 25.1.x | 应用打包 |
| electron-log | 5.2.x | 日志管理 |
| Node.js Worker Threads | - | 多线程图片扫描 |

## 项目结构

```
ImageCollector/
├── src/
│   ├── main.js           # Electron 主进程
│   ├── preload.js        # 预加载脚本（IPC 桥接）
│   ├── scanner-worker.js # 图片扫描 Worker 线程
│   ├── index.html        # 登录页面
│   ├── main.html         # 主界面（图片管理）
│   ├── setup.html        # 安装向导页面
│   └── icon.ico          # 窗口图标
├── icon.png              # 打包图标
├── package.json          # 项目配置
├── package-lock.json     # 依赖锁定
└── .gitignore            # Git 忽略规则
```

## 快速开始

### 环境要求

- Node.js >= 16
- npm >= 8

### 安装与运行

```bash
# 克隆仓库
git clone git@github.com:xl-echo/imageCollector.git
cd imageCollector

# 安装依赖
npm install

# 开发模式运行
npm start

# 开发模式（带日志输出）
npm run dev
```

### 打包构建

```bash
# 打包为 Windows 安装包
npm run build
```

打包完成后在 `dist/` 目录下生成：
- `图片搜集器 Setup x.x.x.exe` — 安装版
- `图片搜集器-x.x.x-portable.exe` — 便携版

## 安全说明

- 用户密码使用 PBKDF2（100000 次迭代）+ SHA-256 加密存储
- 加密盐使用 `crypto.randomBytes(32)` 随机生成
- 密码验证使用 `timingSafeEqual` 防止时序攻击
- 删除操作默认移至回收站，不直接删除文件
- 主进程与渲染进程通过 contextIsolation + preload 脚本隔离通信

## 许可证

MIT License

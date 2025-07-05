/* eslint-disable no-console */
import { spawn } from 'child_process';
import fs from 'fs/promises';
import { NextResponse } from 'next/server';
import os from 'os';
import path from 'path';

// Helper function to get downloader configuration based on platform
async function getDownloaderConfig() {
  const platform = os.platform();

  // 默认配置
  const defaultConfig = {
    windows: {
      path: 'N_m3u8DL-RE',
      save_dir: 'D:\\MyVideos',
    },
    linux: {
      path: '/usr/local/bin/N_m3u8DL-RE',
      save_dir: '/vol1/1000/Movies',
    },
    darwin: {
      path: '/usr/local/bin/N_m3u8DL-RE',
      save_dir: '/vol1/1000/Movies',
    },
  };

  try {
    // 尝试读取配置文件
    const configPath = path.join(process.cwd(), 'config.json');
    // 使用动态导入替代 require
    const configContent = await import(configPath);
    const downloaderConfig = configContent.downloader || defaultConfig;

    switch (platform) {
      case 'win32':
        return downloaderConfig.windows;
      case 'linux':
        return downloaderConfig.linux;
      case 'darwin':
        return downloaderConfig.darwin;
      default:
        return downloaderConfig.linux;
    }
  } catch (error) {
    // 如果配置文件读取失败，使用默认配置
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
      console.warn('无法读取下载器配置，使用默认配置:', error);
    }
    const downloaderConfig = defaultConfig;

    switch (platform) {
      case 'win32':
        return downloaderConfig.windows;
      case 'linux':
        return downloaderConfig.linux;
      case 'darwin':
        return downloaderConfig.darwin;
      default:
        return downloaderConfig.linux;
    }
  }
}

// Helper function to sanitize filename
function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

// Helper function for creating a pause
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request) {
  const isDev = process.env.NODE_ENV !== 'production';

  try {
    const body = await request.json();
    const { episodes, title, downloadPath } = body;

    // 1. 输入验证
    if (!title) {
      return NextResponse.json({ error: '缺少标题参数' }, { status: 400 });
    }
    if (!episodes || !Array.isArray(episodes) || episodes.length === 0) {
      return NextResponse.json(
        { error: '缺少有效的剧集链接数组' },
        { status: 400 }
      );
    }

    // 2. 目录和工具路径设置
    const config = await getDownloaderConfig();
    const defaultDir = path.resolve(process.cwd(), 'downloads');
    // 优先使用请求中的下载路径，其次使用配置文件中的路径，最后使用默认路径
    const baseDownloadDir = downloadPath
      ? path.resolve(downloadPath)
      : config.save_dir
      ? path.resolve(config.save_dir)
      : defaultDir;
    const sanitizedTitle = sanitizeFilename(title);
    const showDir = path.join(baseDownloadDir, sanitizedTitle);
    await fs.mkdir(showDir, { recursive: true });

    let downloadedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // 3. 逐个文件顺序下载
    for (const [index, episode] of episodes.entries()) {
      const url = typeof episode === 'string' ? episode : episode.url;
      if (!url || !url.toLowerCase().includes('m3u8')) {
        if (isDev) {
          console.warn(`跳过无效的剧集URL (索引: ${index}): ${url}`);
        }
        continue;
      }

      const episodeFileName = `第${index + 1}集`;
      const outputPath = path.join(showDir, `${episodeFileName}.mp4`);

      // 4. 检查文件是否已存在
      try {
        await fs.access(outputPath);
        if (isDev) {
          console.log(`文件已存在，跳过: ${outputPath}`);
        }
        skippedCount++;
        continue;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          if (isDev) {
            console.error(`访问文件 ${outputPath} 时出错:`, err);
          }
          failedCount++;
          continue;
        }
      }

      // 5. 调用下载器并等待其完成
      try {
        if (isDev) {
          console.log(`开始下载: ${episodeFileName}.mp4...`);
        }
        await new Promise<void>((resolve, reject) => {
          const command = config.path;
          const args = [
            url,
            '--save-name',
            episodeFileName,
            '--save-dir',
            showDir,
            '--log-level',
            'INFO',
            '--thread-count 3',
          ];

          if (isDev) {
            console.log(`[Exec] ${command} ${args.join(' ')}`);
          }

          const downloadProcess = spawn(command, args, { shell: false });

          // 捕获进程启动错误 (例如命令或文件不存在)
          downloadProcess.on('error', (err) => {
            reject(
              new Error(
                `无法启动下载进程: ${err.message}. 请检查路径: ${command}`
              )
            );
          });

          let processOutput = '';
          if (downloadProcess.stdout) {
            downloadProcess.stdout.on(
              'data',
              (data) => (processOutput += data.toString())
            );
          }
          if (downloadProcess.stderr) {
            downloadProcess.stderr.on(
              'data',
              (data) => (processOutput += data.toString())
            );
          }

          // 监听进程退出事件
          downloadProcess.on('close', (code) => {
            if (code === 0) {
              resolve(); // 退出码为 0，表示成功
            } else {
              reject(
                new Error(
                  `下载进程以错误码 ${code} 退出。\n输出: ${processOutput}`
                )
              );
            }
          });
        });

        // 下载成功
        downloadedCount++;
        if (isDev) {
          console.log(`成功下载: ${episodeFileName}.mp4`);
        }

        // 6. 暂停 20 秒 (如果需要)
        if (index < episodes.length - 1) {
          if (isDev) {
            console.log('暂停20秒...');
          }
          await sleep(20000);
        }
      } catch (error) {
        // 下载失败
        failedCount++;
        if (isDev) {
          if (error instanceof Error) {
            console.error(
              `下载失败: ${episodeFileName}.mp4. 原因:`,
              error.message
            );
          } else {
            console.error(`下载失败: ${episodeFileName}.mp4. 原因: 未知错误`);
          }
        }
      }
    }

    // 7. 所有任务处理完毕后返回最终结果
    const message = `全部任务处理完毕。成功: ${downloadedCount}个, 失败: ${failedCount}个, 跳过: ${skippedCount}个。`;
    return NextResponse.json({
      success: true,
      message: message,
      path: showDir,
    });
  } catch (error) {
    if (isDev) {
      console.error('API 发生严重错误:', error);
    }
    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json(
      { error: `服务器内部错误: ${errorMessage}` },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

// Helper function to sanitize filename
function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

// Helper function for creating a pause
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { episodes, title, downloadPath } = body;

    // 1. 输入验证 (不变)
    if (!title) {
      return NextResponse.json({ error: '缺少标题参数' }, { status: 400 });
    }
    if (!episodes || !Array.isArray(episodes) || episodes.length === 0) {
      return NextResponse.json({ error: '缺少有效的剧集链接数组' }, { status: 400 });
    }

    // 2. 目录和工具路径设置
    const defaultDir = path.resolve(process.cwd(), 'downloads');
    const baseDownloadDir = downloadPath ? path.resolve(downloadPath) : defaultDir;
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
        console.warn(`跳过无效的剧集URL (索引: ${index}): ${url}`);
        continue;
      }

      const episodeFileName = `第${index + 1}集`; // N_m3u8DL-RE 会自动添加 .mp4 后缀
      const outputPath = path.join(showDir, `${episodeFileName}.mp4`);

      // 4. 检查文件是否已存在 (不变)
      try {
        await fs.access(outputPath);
        console.log(`文件已存在，跳过: ${outputPath}`);
        skippedCount++;
        continue;
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`访问文件 ${outputPath} 时出错:`, err);
          failedCount++;
          continue;
        }
      }

      // 5. 【已修改】调用 N_m3u8DL-RE 并等待其完成
      try {
        console.log(`开始下载: ${episodeFileName}.mp4...`);
        await new Promise<void>((resolve, reject) => {

          let command: string;
          let args: string[];

          // 根据操作系统选择不同的命令和参数
          if (os.platform() === 'win32') {
            command = 'N_m3u8DL-RE'
            args = [
              url,
              '--save-name', episodeFileName,
              '--save-dir', showDir,
              '--log-level', 'INFO', // 控制台输出级别
              '--thread-count 3'
            ];
          } else { // Linux 或 macOS
            command = 'N_m3u8DL-RE';
            args = [
              'N_m3u8DL-RE',
              url,
              '--save-name', episodeFileName,
              '--save-dir', showDir,
              '--log-level', 'INFO',
              '--thread-count 3'
            ];
          }

          console.log(`[Exec] ${command} ${args.join(' ')}`);

          const process = spawn(command, args, { shell: false });

          // 捕获进程启动错误 (例如命令或文件不存在)
          process.on('error', (err) => {
            reject(new Error(`无法启动下载进程: ${err.message}. 请检查路径: ${command}`));
          });

          let processOutput = '';
          if (process.stdout) {
            process.stdout.on('data', (data) => processOutput += data.toString());
          }
          if (process.stderr) {
            process.stderr.on('data', (data) => processOutput += data.toString());
          }

          // 监听进程退出事件
          process.on('close', (code) => {
            if (code === 0) {
              resolve(); // 退出码为 0，表示成功
            } else {
              reject(new Error(`下载进程以错误码 ${code} 退出。\n输出: ${processOutput}`));
            }
          });
        });

        // 下载成功
        downloadedCount++;
        console.log(`成功下载: ${episodeFileName}.mp4`);

        // 6. 暂停 20 秒 (如果需要)
        if (index < episodes.length - 1) {
          console.log('暂停20秒...');
          await sleep(20000);
        }

      } catch (error) {
        // 下载失败
        failedCount++;
        console.error(`下载失败: ${episodeFileName}.mp4. 原因:`, error.message);
      }
    }

    // 7. 所有任务处理完毕后返回最终结果 (不变)
    const message = `全部任务处理完毕。成功: ${downloadedCount}个, 失败: ${failedCount}个, 跳过: ${skippedCount}个。`;
    return NextResponse.json({
      success: true,
      message: message,
      path: showDir,
    });

  } catch (error) {
    console.error('API 发生严重错误:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: `服务器内部错误: ${errorMessage}` }, { status: 500 });
  }
}

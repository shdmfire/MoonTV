/* eslint-disable react-hooks/exhaustive-deps, no-console */

'use client';

import { LinkIcon } from 'lucide-react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { SearchResult } from '@/lib/types';

import PageLayout from '@/components/PageLayout';

import { type VideoDetail, fetchVideoDetail } from '@/lib/fetchVideoDetail';

function AggregatePageClient() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q')?.trim() || '';
  const title = searchParams.get('title')?.trim() || '';
  const year = searchParams.get('year')?.trim() || '';
  const type = searchParams.get('type')?.trim() || '';

  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!query) {
      setError('缺少搜索关键词');
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) {
          throw new Error('搜索失败');
        }
        const data = await res.json();
        const all: SearchResult[] = data.results || [];
        const map = new Map<string, SearchResult[]>();
        all.forEach((r) => {
          // 根据传入参数进行精确匹配：
          // 1. 如果提供了 title，则按 title 精确匹配，否则按 query 精确匹配；
          // 2. 如果还提供了 year，则额外按 year 精确匹配。
          const titleMatch = title ? r.title === title : r.title === query;
          const yearMatch = year ? r.year === year : true;
          if (!titleMatch || !yearMatch) {
            return;
          }
          // 如果还传入了 type，则按 type 精确匹配
          if (type === 'tv' && r.episodes.length === 1) {
            return;
          }
          if (type === 'movie' && r.episodes.length !== 1) {
            return;
          }
          const key = `${r.title}-${r.year}`;
          const arr = map.get(key) || [];
          arr.push(r);
          map.set(key, arr);
        });
        if (map.size === 0 && type) {
          // 无匹配，忽略 type 做重新匹配
          all.forEach((r) => {
            const titleMatch = title ? r.title === title : r.title === query;
            const yearMatch = year ? r.year === year : true;
            if (!titleMatch || !yearMatch) {
              return;
            }
            const key = `${r.title}-${r.year}`;
            const arr = map.get(key) || [];
            arr.push(r);
            map.set(key, arr);
          });
        }
        if (map.size == 1) {
          setResults(Array.from(map.values()).flat());
        } else if (map.size > 1) {
          // 存在多个匹配，跳转到搜索页
          router.push(`/search?q=${encodeURIComponent(query)}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '搜索失败');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [query, router]);

  // 选出信息最完整的字段
  const chooseString = (vals: (string | undefined)[]): string | undefined => {
    return vals.reduce<string | undefined>((best, v) => {
      if (!v) return best;
      if (!best) return v;
      return v.length > best.length ? v : best;
    }, undefined);
  };
  // 出现次数最多的非 0 数字
  const chooseNumber = (vals: (number | undefined)[]): number | undefined => {
    const countMap = new Map<number, number>();
    vals.forEach((v) => {
      if (v !== undefined && v !== 0) {
        countMap.set(v, (countMap.get(v) || 0) + 1);
      }
    });
    let selected: number | undefined = undefined;
    let maxCount = 0;
    countMap.forEach((cnt, num) => {
      if (cnt > maxCount) {
        maxCount = cnt;
        selected = num;
      }
    });
    return selected;
  };

  const aggregatedInfo = {
    title: title || query,
    cover: chooseString(results.map((d) => d.poster)),
    desc: chooseString(results.map((d) => d.desc)),
    type: chooseString(results.map((d) => d.type_name)),
    year: chooseString(results.map((d) => d.year)),
    remarks: chooseString(results.map((d) => d.class)),
    douban_id: chooseNumber(results.map((d) => d.douban_id)),
  };

  const infoReady = Boolean(
    aggregatedInfo.cover ||
    aggregatedInfo.desc ||
    aggregatedInfo.type ||
    aggregatedInfo.year ||
    aggregatedInfo.remarks
  );

  const uniqueSources = Array.from(
    new Map(results.map((r) => [r.source, r])).values()
  );

  // 详情映射，便于快速获取每个源的集数
  const sourceDetailMap = new Map(results.map((d) => [d.source, d]));


  // 在组件顶部添加状态
  const [selectedSource, setSelectedSource] = useState<SearchResult | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState('');

  // --- MODIFIED: Batch Download Handler ---
  const handleDownloadToNAS = async () => {
    if (!selectedSource) return;

    setIsDialogOpen(false);
    setIsDownloading(true);
    setDownloadStatus('正在获取剧集详情，请稍候...');

    try {
      // 1. 调用函数获取包含所有剧集 URL 的详细数据
      const detailData = await fetchVideoDetail({
        source: selectedSource.source,
        id: selectedSource.id,
        fallbackTitle: selectedSource.title,
        fallbackYear: selectedSource.year,
      });

      // 2. 检查是否成功获取剧集和URL
      if (!detailData || !detailData.episodes || detailData.episodes.length === 0) {
        throw new Error('未能获取到有效的剧集链接。请检查视频源。');
      }

      setDownloadStatus(`正在提交 ${detailData.episodes.length} 个下载任务...`);

      // 3. 将所有剧集链接发送到后端
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodes: detailData.episodes, // 发送整个剧集数组
          title: aggregatedInfo.title,
          downloadPath: 'D:\\MyVideos' // 可选的自定义路径
        }),
      });

      const data = await response.json();
      if (response.ok) {
        // 使用后端返回的更详细的消息
        setDownloadStatus(data.message || `✅ ${data.submitted} 个下载任务已成功提交！`);
      } else {
        setDownloadStatus(`❌ 提交下载任务失败: ${data.error || '未知错误'}`);
      }
    } catch (error) {
      setDownloadStatus(`❌ 请求失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDownloading(false);
    }
  };


  // --- Click handler to open the dialog ---
  const handleSourceClick = (source: SearchResult) => {
    setSelectedSource(source);
    setIsDialogOpen(true);
    setDownloadStatus(''); // Clear previous status
  };

  return (
    <PageLayout activePath='/aggregate'>
      <div className='flex flex-col min-h-full px-2 sm:px-10 pt-4 sm:pt-8 pb-[calc(3.5rem+env(safe-area-inset-bottom))] overflow-visible'>
        {loading ? (
          <div className='flex items-center justify-center min-h-[60vh]'>
            <div className='animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500'></div>
          </div>
        ) : error ? (
          <div className='flex items-center justify-center min-h-[60vh]'>
            <div className='text-red-500 text-center'>
              <div className='text-lg font-semibold mb-2'>加载失败</div>
              <div className='text-sm'>{error}</div>
            </div>
          </div>
        ) : !infoReady ? (
          <div className='flex items-center justify-center min-h-[60vh]'>
            <div className='text-gray-500 text-center'>
              <div className='text-lg font-semibold mb-2'>未找到匹配结果</div>
            </div>
          </div>
        ) : (
          <div className='max-w-[95%] mx-auto'>
            {/* 主信息区：左图右文 */}
            <div className='relative flex flex-col md:flex-row gap-8 mb-0 sm:mb-8 bg-transparent rounded-xl p-2 sm:p-6 md:items-start'>
              {/* 返回按钮 */}
              <button
                onClick={() => {
                  window.history.back();
                }}
                className='absolute top-0 left-0 -translate-x-[40%] -translate-y-[30%] sm:-translate-x-[180%] sm:-translate-y-1/2 p-2 rounded transition-colors'
              >
                <svg
                  className='h-5 w-5 text-gray-500 hover:text-green-600 dark:text-gray-400 dark:hover:text-green-500 transition-colors'
                  viewBox='0 0 24 24'
                  fill='none'
                  xmlns='http://www.w3.org/2000/svg'
                >
                  <path
                    d='M15 19l-7-7 7-7'
                    stroke='currentColor'
                    strokeWidth='2'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  />
                </svg>
              </button>
              {/* 封面 */}
              <div className='flex-shrink-0 w-full max-w-[200px] sm:max-w-none md:w-72 mx-auto'>
                <Image
                  src={aggregatedInfo.cover || '/images/placeholder.png'}
                  alt={aggregatedInfo.title}
                  width={288}
                  height={432}
                  className='w-full rounded-xl object-cover'
                  style={{ aspectRatio: '2/3' }}
                  priority
                  unoptimized
                />
              </div>
              {/* 右侧信息 */}
              <div
                className='flex-1 flex flex-col min-h-0'
                style={{ height: '430px' }}
              >
                <h1 className='text-3xl font-bold mb-2 tracking-wide flex items-center flex-shrink-0 text-center md:text-left w-full'>
                  {aggregatedInfo.title}
                  {aggregatedInfo.douban_id && (
                    <a
                      href={`https://movie.douban.com/subject/${aggregatedInfo.douban_id}/`}
                      target='_blank'
                      rel='noopener noreferrer'
                      onClick={(e) => e.stopPropagation()}
                      className='ml-2'
                    >
                      <LinkIcon className='w-4 h-4' strokeWidth={2} />
                    </a>
                  )}
                </h1>
                <div className='flex flex-wrap items-center gap-3 text-base mb-4 opacity-80 flex-shrink-0'>
                  {aggregatedInfo.remarks && (
                    <span className='text-green-600 font-semibold'>
                      {aggregatedInfo.remarks}
                    </span>
                  )}
                  {aggregatedInfo.year && <span>{aggregatedInfo.year}</span>}
                  {aggregatedInfo.type && <span>{aggregatedInfo.type}</span>}
                </div>
                <div
                  className='mt-0 text-base leading-relaxed opacity-90 overflow-y-auto pr-2 flex-1 min-h-0 scrollbar-hide'
                  style={{ whiteSpace: 'pre-line' }}
                >
                  {aggregatedInfo.desc}
                </div>
              </div>
            </div>
            {/* 选播放源 */}
            {uniqueSources.length > 0 && (
              <div className='mt-0 sm:mt-8 bg-transparent rounded-xl p-2 sm:p-6'>
                <div className='flex items-center gap-2 mb-4'>
                  <div className='text-xl font-semibold'>选择播放源</div>
                  <div className='text-gray-400 ml-2'>共 {uniqueSources.length} 个</div>
                </div>
                <div className='grid grid-cols-3 gap-2 sm:grid-cols-[repeat(auto-fill,_minmax(6rem,_1fr))] sm:gap-4 justify-start'>
                  {uniqueSources.map((src) => {
                    const d = sourceDetailMap.get(src.source);
                    const epCount = d ? d.episodes.length : src.episodes.length;
                    return (
                      // 点击按钮，打开选择对话框
                      <button
                        key={src.source}
                        onClick={() => handleSourceClick(src)}
                        className='relative flex items-center justify-center w-full h-14 bg-gray-500/80 hover:bg-green-500 dark:bg-gray-700/80 dark:hover:bg-green-600 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-400'
                      >
                        <span className='px-1 text-white text-sm font-medium truncate whitespace-nowrap'>{src.source_name}</span>
                        {epCount > 1 && (
                          <span className='absolute top-[2px] right-1 text-[10px] font-semibold text-green-900 bg-green-300/90 rounded-full px-1 pointer-events-none'>
                            {epCount}集
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {/* 下载状态显示 (保持不变) */}
                {downloadStatus && (
                  <div className={`mt-4 p-3 rounded-lg text-sm text-center whitespace-pre-wrap ${downloadStatus.includes('❌') ? 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200' : 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200'}`}>
                    {downloadStatus}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* --- MODIFIED: Confirmation Dialog --- */}
      {isDialogOpen && selectedSource && (
        <div className='fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 transition-opacity'>
          <div className='bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-sm mx-4 transform transition-all'>
            <h3 className='text-lg font-semibold text-gray-900 dark:text-white'>请选择操作</h3>
            <p className='mt-2 text-sm text-gray-600 dark:text-gray-300'>
              要下载《{selectedSource.title}》还是直接在线播放？
            </p>
            <div className='mt-6 flex justify-end gap-3'>
              {/* --- NEW: "否，在线播放" Button --- */}
              <button
                onClick={() => {
                  if (selectedSource) {
                    const playUrl = `/play?source=${selectedSource.source}&id=${selectedSource.id}&title=${encodeURIComponent(selectedSource.title)}${selectedSource.year ? `&year=${selectedSource.year}` : ''}&from=aggregate`;
                    router.push(playUrl);
                  }
                  setIsDialogOpen(false);
                }}
                disabled={isDownloading}
                className='px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50'
              >
                在线播放
              </button>

              {/* "是, 下载" Button */}
              <button
                onClick={handleDownloadToNAS}
                disabled={isDownloading}
                className='px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:bg-green-400'
              >
                {isDownloading ? '处理中...' : '下载'}
              </button>
            </div>
            {/* --- NEW: A simple close button at the bottom --- */}
            <button
              onClick={() => setIsDialogOpen(false)}
              className='w-full mt-4 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500 rounded-md focus:outline-none'
            >
              取消
            </button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

export default function AggregatePage() {
  return (
    <Suspense>
      <AggregatePageClient />
    </Suspense>
  );
}

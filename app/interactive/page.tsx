'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowLeft, ExternalLink, Play } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';

interface InteractiveFile {
  id: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  objectKey: string;
  sizeBytes: number;
  thumbnailKey: string | null;
  sortOrder: number;
  createdAt: number;
}

// Thumbnail gradient configs per file index (stable, pre-defined)
const CARD_THEMES: Array<{
  gradient: string;
  icon: string;
  accent: string;
}> = [
  { gradient: 'from-blue-600/20 to-blue-900/40', icon: '🌍', accent: 'blue' },
  { gradient: 'from-red-600/20 to-red-900/40', icon: '🌀', accent: 'red' },
  { gradient: 'from-purple-600/20 to-purple-900/40', icon: '🌪️', accent: 'purple' },
  { gradient: 'from-orange-600/20 to-orange-900/40', icon: '🔧', accent: 'orange' },
  { gradient: 'from-yellow-500/20 to-yellow-900/40', icon: '⚡', accent: 'yellow' },
  { gradient: 'from-teal-600/20 to-teal-900/40', icon: '🌀', accent: 'teal' },
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface InteractiveCardProps {
  file: InteractiveFile;
  index: number;
  locale: string;
  onOpen: (id: string) => void;
}

function InteractiveCard({ file, index, locale, onOpen }: InteractiveCardProps) {
  const cardTheme = CARD_THEMES[index % CARD_THEMES.length];
  const title = locale === 'en-US' && file.titleEn ? file.titleEn : file.title;
  const description =
    locale === 'en-US' && file.descriptionEn ? file.descriptionEn : file.description;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35, ease: 'easeOut' }}
      className="group relative"
    >
      {/* Main card */}
      <div
        className={cn(
          'relative overflow-hidden rounded-2xl border border-border bg-background cursor-pointer',
          'transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-purple-500/10',
          'hover:border-purple-400/50',
        )}
        onClick={() => onOpen(file.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onOpen(file.id)}
      >
        {/* Preview area */}
        <div
          className={cn(
            'relative h-36 w-full overflow-hidden flex items-center justify-center',
            'bg-gradient-to-br',
            cardTheme.gradient,
          )}
        >
          {/* Emoji icon */}
          <span className="text-5xl select-none">{cardTheme.icon}</span>

          {/* Overlay gradient */}
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            style={{
              background:
                'linear-gradient(135deg, rgba(168,85,247,0.3) 0%, rgba(59,130,246,0.2) 100%)',
            }}
          />

          {/* Play button */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 scale-75 group-hover:scale-100">
            <div className="w-14 h-14 rounded-full bg-white/90 dark:bg-white/80 shadow-lg flex items-center justify-center">
              <Play className="w-6 h-6 text-purple-600 ml-0.5" fill="currentColor" />
            </div>
          </div>

          {/* Size badge */}
          <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/30 backdrop-blur-sm text-[10px] text-white/80 font-mono">
            {formatBytes(file.sizeBytes)}
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-1.5">
          <h3 className="text-sm font-semibold text-foreground/90 line-clamp-1 leading-snug">
            {title}
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {description}
          </p>
        </div>
      </div>

      {/* Open in new tab */}
      <Link
        href={`/api/interactive/files/${encodeURIComponent(file.id)}`}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'absolute top-3 left-3 w-8 h-8 rounded-full flex items-center justify-center',
          'bg-black/40 hover:bg-black/60 dark:bg-white/10 dark:hover:bg-white/20',
          'text-white/80 hover:text-white backdrop-blur-sm transition-all duration-200',
          'opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0',
        )}
        title="在新标签页打开"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </Link>
    </motion.div>
  );
}

interface EmptyStateProps {
  loading: boolean;
}

function EmptyState({ loading }: EmptyStateProps) {
  const { t } = useI18n();
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">{t('interactive.loading')}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <span className="text-4xl">🔬</span>
      <p className="text-sm text-muted-foreground">{t('interactive.empty')}</p>
    </div>
  );
}

export default function InteractivePage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [files, setFiles] = useState<InteractiveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/interactive/list')
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.files)) {
          setFiles(data.files);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const handleOpen = (id: string) => {
    const url = `/api/interactive/files/${encodeURIComponent(id)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background/80 dark:bg-gray-950/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors cursor-pointer"
            aria-label="返回"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-foreground truncate">
              {t('interactive.title')}
            </h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Description */}
        {!loading && files.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              {t('interactive.description')}
            </p>
          </div>
        )}

        {/* Cards grid */}
        {error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <span className="text-4xl">⚠️</span>
            <p className="text-sm text-destructive">{t('interactive.error')}</p>
          </div>
        ) : files.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {files.map((file, i) => (
              <InteractiveCard
                key={file.id}
                file={file}
                index={i}
                locale={locale}
                onOpen={handleOpen}
              />
            ))}
          </div>
        ) : (
          <EmptyState loading={loading} />
        )}

        {/* Tip */}
        {files.length > 0 && (
          <p className="text-xs text-muted-foreground/60 text-center">
            点击卡片预览 · 支持在新标签页打开
          </p>
        )}
      </main>
    </div>
  );
}

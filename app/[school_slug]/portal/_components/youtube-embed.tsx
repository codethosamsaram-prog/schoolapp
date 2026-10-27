'use client';

/* eslint-disable @next/next/no-img-element -- remote YouTube thumbnail */
import * as React from 'react';
import { Play } from 'lucide-react';
import { youtubeId } from '@/lib/youtube';

/**
 * Click-to-play YouTube player. Shows the thumbnail first, so a feed of videos
 * does not load a dozen iframes (and YouTube's cookies) on every visit.
 */
export function YouTubeEmbed({ url, title }: { url: string; title: string }) {
  const [playing, setPlaying] = React.useState(false);
  const id = youtubeId(url);
  if (!id) return null;

  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="group absolute inset-0 h-full w-full"
          aria-label={`Play ${title}`}
        >
          <img
            src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
            alt=""
            className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
            loading="lazy"
          />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition-transform group-hover:scale-110">
              <Play className="ml-1 h-6 w-6 fill-current" aria-hidden />
            </span>
          </span>
        </button>
      )}
    </div>
  );
}

const ID = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

/** The 11-character video id from any common YouTube URL shape. */
export function youtubeId(url: string): string | null {
  return ID.exec(url)?.[1] ?? null;
}

/** Privacy-enhanced embed URL: no cookies until the viewer presses play. */
export function youtubeEmbedUrl(url: string): string | null {
  const id = youtubeId(url);
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

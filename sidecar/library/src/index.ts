import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export type ProviderId = 'bundle' | 'tenor' | 'pexels';
export interface LibAsset {
  id: string;
  title: string;
  url: string; // origin url (or file:// for local)
  thumb?: string;
  kind: 'gif' | 'video' | 'image';
  provider: ProviderId;
  width?: number;
  height?: number;
}

const BUNDLE_DIR = process.env.DAWN_LIBRARY_DIR ?? resolve(process.cwd(), 'assets', 'library');
const TENOR_KEY = process.env.TENOR_API_KEY;
const PEXELS_KEY = process.env.PEXELS_API_KEY;

/** Which providers are configured in this environment. */
export function availableProviders(): ProviderId[] {
  const out: ProviderId[] = ['bundle'];
  if (TENOR_KEY) out.push('tenor');
  if (PEXELS_KEY) out.push('pexels');
  return out;
}

/** Search a provider; returns up to `limit` results. */
export async function searchLibrary(
  provider: ProviderId,
  query: string,
  limit = 24,
): Promise<LibAsset[]> {
  if (provider === 'bundle') return searchBundle(query, limit);
  if (provider === 'tenor') return searchTenor(query, limit);
  if (provider === 'pexels') return searchPexels(query, limit);
  return [];
}

/** Resolve an asset to a local file path (downloads/copies to `destDir`). */
export async function fetchAsset(asset: LibAsset, destDir: string): Promise<{ path: string }> {
  await mkdir(destDir, { recursive: true });
  const ext = asset.kind === 'video' ? 'mp4' : asset.kind === 'image' ? 'png' : 'gif';
  const out = join(destDir, `${asset.provider}-${safeName(asset.id)}.${ext}`);
  if (asset.url.startsWith('file://')) {
    await copyFile(asset.url.slice(7), out);
  } else {
    const r = await fetch(asset.url);
    if (!r.ok) throw new Error(`fetch failed (${r.status}): ${asset.url}`);
    const buf = new Uint8Array(await r.arrayBuffer());
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, buf);
  }
  return { path: out };
}

// ── providers ───────────────────────────────────────────────────────
async function searchBundle(query: string, limit: number): Promise<LibAsset[]> {
  let files: string[] = [];
  try {
    files = await readdir(BUNDLE_DIR);
  } catch {
    return [];
  }
  const q = query.trim().toLowerCase();
  const matched = files
    .filter((f) => /\.(gif|mp4|png|jpe?g|webp)$/i.test(f))
    .filter((f) => !q || f.toLowerCase().includes(q))
    .slice(0, limit);
  const out: LibAsset[] = [];
  for (const f of matched) {
    const full = resolve(BUNDLE_DIR, f);
    const s = await stat(full).catch(() => null);
    if (!s) continue;
    const kind: LibAsset['kind'] = /\.mp4$/i.test(f)
      ? 'video'
      : /\.gif$/i.test(f)
        ? 'gif'
        : 'image';
    out.push({
      id: f,
      title: f.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
      url: `file://${full}`,
      thumb: `file://${full}`,
      kind,
      provider: 'bundle',
    });
  }
  return out;
}

async function searchTenor(query: string, limit: number): Promise<LibAsset[]> {
  if (!TENOR_KEY) return [];
  const endpoint = query
    ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${TENOR_KEY}&limit=${limit}&media_filter=gif,tinygif`
    : `https://tenor.googleapis.com/v2/featured?key=${TENOR_KEY}&limit=${limit}&media_filter=gif,tinygif`;
  const r = await fetch(endpoint);
  if (!r.ok) throw new Error(`tenor: ${r.status}`);
  const data = (await r.json()) as {
    results?: Array<{
      id: string;
      title?: string;
      content_description?: string;
      media_formats?: Record<string, { url: string; dims?: number[] }>;
    }>;
  };
  return (data.results ?? [])
    .map((it) => ({
      id: it.id,
      title: it.title || it.content_description || '',
      url: it.media_formats?.gif?.url ?? '',
      thumb: it.media_formats?.tinygif?.url ?? it.media_formats?.gif?.url ?? '',
      kind: 'gif',
      provider: 'tenor',
      width: it.media_formats?.gif?.dims?.[0],
      height: it.media_formats?.gif?.dims?.[1],
    }))
    .filter((a) => a.url);
}

async function searchPexels(query: string, limit: number): Promise<LibAsset[]> {
  if (!PEXELS_KEY) return [];
  const endpoint = query
    ? `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${limit}`
    : `https://api.pexels.com/videos/popular?per_page=${limit}`;
  const r = await fetch(endpoint, { headers: { Authorization: PEXELS_KEY } });
  if (!r.ok) throw new Error(`pexels: ${r.status}`);
  const data = (await r.json()) as {
    videos?: Array<{
      id: number;
      width: number;
      height: number;
      duration: number;
      image: string;
      video_files: Array<{ link: string; quality: string; width?: number; height?: number }>;
    }>;
  };
  return (data.videos ?? []).map((v) => {
    const file = v.video_files.find((f) => f.quality === 'sd') ?? v.video_files[0]!;
    return {
      id: String(v.id),
      title: `Pexels #${v.id} (${v.duration}s)`,
      url: file.link,
      thumb: v.image,
      kind: 'video' as const,
      provider: 'pexels' as const,
      width: v.width,
      height: v.height,
    };
  });
}

function safeName(s: string): string {
  return s.replace(/[^a-z0-9._-]/gi, '_').slice(0, 60);
}

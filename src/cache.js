import {
  createWriteStream,
  mkdirSync,
  existsSync,
  statSync,
  readdirSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { supabase } from "./supabase.js";

const CACHE_DIRS = ["live", "archive"];

// ── Initialization ────────────────────────────────────────────────────────────

export function initCache() {
  const base = config.cache.dir;

  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true });
    logger.info("cache", `Created cache directory: ${base}`);
  }

  for (const dir of CACHE_DIRS) {
    const path = join(base, dir);
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  }

  logger.info("cache", `Cache initialized at ${base}`);
}

// ── Manifest sync ─────────────────────────────────────────────────────────────

export async function syncManifest() {
  logger.info("cache", "Syncing content manifest from Supabase");

  const { data: content, error } = await supabase
    .from("content")
    .select("id, title, storage_path, public_url, content_type, published_at")
    .not("storage_path", "is", null)
    .order("published_at", { ascending: false })
    .limit(100);

  if (error) {
    logger.error("cache", "Manifest fetch failed", { error: error.message });
    return [];
  }

  logger.info("cache", `Manifest: ${content.length} items`);
  return content ?? [];
}

// ── File download ─────────────────────────────────────────────────────────────

async function downloadFile(storagePath, destPath) {
  try {
    const { data, error } = await supabase.storage
      .from("village-content")
      .download(storagePath);

    if (error) throw new Error(error.message);

    const buffer = await data.arrayBuffer();
    const { writeFile } = await import("fs/promises");
    await writeFile(destPath, Buffer.from(buffer));

    logger.debug("cache", `Downloaded: ${storagePath}`);
    return true;
  } catch (err) {
    logger.warn("cache", `Download failed: ${storagePath}`, {
      error: err.message,
    });
    return false;
  }
}

// ── Full sync ─────────────────────────────────────────────────────────────────

export async function syncCache() {
  logger.info("cache", "Starting cache sync");

  const manifest = await syncManifest();
  if (!manifest.length) return;

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of manifest) {
    const subDir = item.content_type === "live" ? "live" : "archive";
    const filename = item.storage_path.split("/").pop();
    const destPath = join(config.cache.dir, subDir, filename);

    // Skip if already cached and not updated
    if (existsSync(destPath)) {
      const stat = statSync(destPath);
      const cachedAt = stat.mtimeMs;
      const updatedAt = new Date(item.published_at).getTime();
      if (cachedAt >= updatedAt) {
        skipped++;
        continue;
      }
    }

    // Check available disk space before downloading
    const usedGb = getCacheSize() / 1024 ** 3;
    if (usedGb >= config.cache.maxGb * 0.9) {
      logger.warn(
        "cache",
        `Cache near capacity (${usedGb.toFixed(1)}GB / ${config.cache.maxGb}GB) — purging old files`,
      );
      await purgeOldFiles();
    }

    const success = await downloadFile(item.storage_path, destPath);
    if (success) downloaded++;
    else failed++;
  }

  logger.info(
    "cache",
    `Sync complete — downloaded: ${downloaded}, skipped: ${skipped}, failed: ${failed}`,
  );
}

// ── Cache size ────────────────────────────────────────────────────────────────

export function getCacheSize() {
  let total = 0;
  for (const dir of CACHE_DIRS) {
    const path = join(config.cache.dir, dir);
    if (!existsSync(path)) continue;
    for (const file of readdirSync(path)) {
      try {
        total += statSync(join(path, file)).size;
      } catch {
        /* skip */
      }
    }
  }
  return total;
}

// ── Purge old files ───────────────────────────────────────────────────────────

async function purgeOldFiles() {
  const archiveDir = join(config.cache.dir, "archive");
  if (!existsSync(archiveDir)) return;

  const files = readdirSync(archiveDir)
    .map((f) => ({
      name: f,
      path: join(archiveDir, f),
      mtime: statSync(join(archiveDir, f)).mtimeMs,
    }))
    .sort((a, b) => a.mtime - b.mtime);

  const toRemove = Math.ceil(files.length * 0.2);
  for (const file of files.slice(0, toRemove)) {
    unlinkSync(file.path);
    logger.debug("cache", `Purged: ${file.name}`);
  }

  logger.info("cache", `Purged ${toRemove} old archive files`);
}

// ── Scheduled sync ────────────────────────────────────────────────────────────

let syncInterval = null;

export function startCacheSync() {
  if (syncInterval) return;
  logger.info(
    "cache",
    `Scheduled sync every ${config.timing.cacheSyncMs / 3600000}h`,
  );
  syncCache();
  syncInterval = setInterval(syncCache, config.timing.cacheSyncMs);
}

export function stopCacheSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

import { mkdir, copyFile, stat, open, rm } from "node:fs/promises";
import { join } from "node:path";

const MAX_BYTES = 1048576; // 1 MiB

const src = join(import.meta.dirname, "entry.png");

let size: number;
try {
  const info = await stat(src);
  if (!info.isFile()) {
    throw new Error(`entry.png is not a regular file: ${src}`);
  }
  size = info.size;
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error(`entry.png is missing: ${src}`);
  }
  throw err;
}
if (size === 0) {
  throw new Error(`entry.png is empty (0 bytes): ${src}`);
}
if (size > MAX_BYTES) {
  throw new Error(`entry.png is too large: ${size} bytes (max ${MAX_BYTES} bytes / 1 MiB): ${src}`);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
await mkdir(outDir, { recursive: true });
const dest = join(outDir, "entry.png");
await copyFile(src, dest);

// Post-write verification: PNG signature and size must match the source.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function failVerification(reason: string): Promise<never> {
  let cleanup = "output deleted";
  try {
    await rm(dest, { force: true });
  } catch (rmErr) {
    cleanup = `could not delete output: ${(rmErr as Error).message}`;
  }
  console.error(`error: post-write verification failed for ${dest}: ${reason} (${cleanup})`);
  process.exit(1);
}

let writtenSize: number;
let header: Buffer;
try {
  writtenSize = (await stat(dest)).size;
  const fh = await open(dest, "r");
  try {
    header = Buffer.alloc(PNG_SIGNATURE.length);
    const { bytesRead } = await fh.read(header, 0, PNG_SIGNATURE.length, 0);
    header = header.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
} catch (err) {
  await failVerification(`could not read written file: ${(err as Error).message}`);
}

if (!header!.equals(PNG_SIGNATURE)) {
  const hex = (b: Buffer) => [...b].map((x) => x.toString(16).padStart(2, "0").toUpperCase()).join(" ");
  await failVerification(
    `PNG signature mismatch: expected ${hex(PNG_SIGNATURE)}, got ${hex(header!) || "(no bytes)"}`,
  );
}
if (writtenSize! !== size) {
  await failVerification(`size mismatch: source is ${size} bytes, written file is ${writtenSize!} bytes`);
}

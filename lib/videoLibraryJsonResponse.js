import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

export const VIDEO_JSON_STREAM_THRESHOLD = 1024 * 1024;

function acceptsGzip(header = "") {
  const encodings = String(header).split(",").map(value => value.trim().toLowerCase());
  const gzip = encodings.find(value => value.split(";")[0].trim() === "gzip");
  if (!gzip) return false;
  const quality = gzip.match(/;\s*q\s*=\s*([\d.]+)/)?.[1];
  return quality === undefined || Number(quality) > 0;
}

/** Same JSON contract; send large catalogs as a stream rather than a buffered function response. */
export async function sendVideoLibraryJson(req, res, payload) {
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  if (bytes.length < VIDEO_JSON_STREAM_THRESHOLD) return res.status(200).json(payload);

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.removeHeader("Content-Length");
  const vary = String(res.getHeader("Vary") || "").split(",").map(value => value.trim()).filter(Boolean);
  if (!vary.some(value => value.toLowerCase() === "accept-encoding")) vary.push("Accept-Encoding");
  res.setHeader("Vary", vary.join(", "));
  const gzip = acceptsGzip(req.headers?.["accept-encoding"]);
  if (gzip) res.setHeader("Content-Encoding", "gzip");
  function* chunks() {
    for (let offset = 0; offset < bytes.length; offset += 64 * 1024) yield bytes.subarray(offset, offset + 64 * 1024);
  }
  try {
    const source = Readable.from(chunks());
    if (gzip) await pipeline(source, createGzip(), res);
    else await pipeline(source, res);
  } catch (error) {
    // A disconnected client cannot receive another JSON error after streaming began.
    if (!res.headersSent && !res.destroyed) throw error;
    console.warn("[video-library] Response stream closed", error?.code || error?.message);
  }
}

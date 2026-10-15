import { inflateSync } from "node:zlib";

/** Bounded, inert PNG subset. No URL, resource URI, SVG, scripts or remote decoding. */
export function decodeMcpPng(value: unknown): Buffer {
  const fail = (): never => { throw new Error("MCP_PNG_UNSUPPORTED_OR_INVALID"); };
  const c = value as Record<string, unknown>;
  if (!c || c.type !== "image" || c.mimeType !== "image/png" || typeof c.data !== "string"
    || c.data.length > 1_398_104 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(c.data)) fail();
  const b = Buffer.from(c.data as string, "base64");
  if (b.toString("base64") !== c.data || b.length < 57 || b.length > 1024 * 1024 || b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") fail();
  let offset = 8, width = 0, height = 0, channels = 0, ended = false, dataEnded = false;
  const compressed: Buffer[] = [];
  while (offset < b.length) {
    if (offset + 12 > b.length) fail();
    const size = b.readUInt32BE(offset), end = offset + 12 + size;
    if (end > b.length) fail();
    const type = b.toString("ascii", offset + 4, offset + 8), body = b.subarray(offset + 8, end - 4);
    let crc = 0xffffffff;
    for (const byte of b.subarray(offset + 4, end - 4)) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== b.readUInt32BE(end - 4)) fail();
    if (offset === 8) {
      if (type !== "IHDR" || size !== 13) fail();
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[body[9]];
      if (!width || !height || width * height > 4_000_000 || !channels || body[8] !== 8 || body[10] || body[11] || body[12]) fail();
    } else if (type === "IDAT") {
      if (dataEnded) fail();
      compressed.push(body);
    } else {
      if (compressed.length) dataEnded = true;
      if (type === "IEND") { if (size || end !== b.length || !compressed.length) fail(); ended = true; }
      // Other critical chunks and active/animation metadata are outside this subset.
      else if (!/^[a-z][A-Za-z]{3}$/.test(type) || ["acTL", "fcTL", "fdAT"].includes(type)) fail();
    }
    offset = end;
  }
  if (!ended) fail();
  const stride = width * channels + 1, expected = stride * height;
  let pixels: Buffer;
  try { pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected }); } catch { return fail(); }
  if (pixels.length !== expected) fail();
  for (let row = 0; row < height; row++) if (pixels[row * stride] > 4) fail();
  return b;
}

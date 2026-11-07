/** Independent bounded OPC package reader. No styling rules or Provider reports. */
import JSZip from "jszip";
import { posix } from "node:path";
import { parseXmlStrict, elements, RELATIONSHIPS_NS } from "./xml";
const MAX = 50 * 1024 * 1024;
export async function readSafeZip(data: Buffer): Promise<JSZip> {
	if (!data.length || data.length > MAX)
		throw new Error("DOCX input is empty or exceeds 50 MB");
	// JSZip collapses duplicates. Check the raw central directory before loading it.
	let end = -1;
	for (let p = data.length - 22; p >= Math.max(0, data.length - 65557); p--) {
		if (
			data.readUInt32LE(p) === 0x06054b50 &&
			p + 22 + data.readUInt16LE(p + 20) === data.length
		) {
			end = p;
			break;
		}
	}
	if (end < 0) throw new Error("invalid DOCX ZIP package");
	const count = data.readUInt16LE(end + 10),
		size = data.readUInt32LE(end + 12);
	let p = data.readUInt32LE(end + 16),
		expanded = 0;
	if (
		data.readUInt32LE(end + 4) ||
		count !== data.readUInt16LE(end + 8) ||
		count > 5000 ||
		p + size !== end
	)
		throw new Error("unsupported DOCX ZIP directory");
	const names = new Set<string>();
	for (let i = 0; i < count; i++) {
		if (p + 46 > end || data.readUInt32LE(p) !== 0x02014b50)
			throw new Error("invalid DOCX ZIP directory");
		const n = data.readUInt16LE(p + 28),
			extra = data.readUInt16LE(p + 30),
			comment = data.readUInt16LE(p + 32);
		const name = data.subarray(p + 46, p + 46 + n).toString("utf8");
		const pieces = name.replace(/\/$/, "").split("/");
		if (
			!name ||
			name.includes("\\") ||
			/[\x00-\x1f]/.test(name) ||
			name.startsWith("/") ||
			name.includes(":") ||
			pieces.some((x) => !x || x === "." || x === "..")
		)
			throw new Error(`unsafe ZIP entry path: ${name}`);
		if (names.has(name)) throw new Error(`duplicate DOCX ZIP entry: ${name}`);
		names.add(name);
		if (((data.readUInt32LE(p + 38) >>> 16) & 0o170000) === 0o120000)
			throw new Error("DOCX ZIP symbolic-link entry");
		if (data.readUInt16LE(p + 8) & 1)
			throw new Error("encrypted DOCX ZIP entry");
		const bytes = data.readUInt32LE(p + 24);
		expanded += bytes;
		if (bytes > 100 * 1024 * 1024 || expanded > 250 * 1024 * 1024)
			throw new Error("DOCX ZIP expanded size limit exceeded");
		if (/\.(xml|rels)$/i.test(name) && bytes > 16 * 1024 * 1024)
			throw new Error("DOCX XML size limit exceeded");
		const local = data.readUInt32LE(p + 42);
		if (
			local + 30 > data.length ||
			data.readUInt32LE(local) !== 0x04034b50 ||
			data.readUInt16LE(local + 26) !== n ||
			!data
				.subarray(local + 30, local + 30 + n)
				.equals(data.subarray(p + 46, p + 46 + n))
		)
			throw new Error("DOCX ZIP local/central name mismatch");
		p += 46 + n + extra + comment;
	}
	if (p !== end) throw new Error("invalid DOCX ZIP directory size");
	const zip = await JSZip.loadAsync(data, { checkCRC32: true });
	for (const e of Object.values(zip.files)) {
		if (e.unsafeOriginalName && e.unsafeOriginalName !== e.name)
			throw new Error("unsafe ZIP entry path");
		if (/vbaproject\.bin$/i.test(e.name))
			throw new Error("DOCX package contains macro-enabled content");
		if (/^_xmlsignatures\/|origin\.sigs/i.test(e.name))
			throw new Error("DOCX package contains digital signatures");
		if (!e.dir && /\.(xml|rels)$/i.test(e.name)) {
			const buffer = await e.async("nodebuffer");
			const xml =
				buffer[0] === 0xff && buffer[1] === 0xfe
					? buffer.subarray(2).toString("utf16le")
					: buffer[0] === 0xfe && buffer[1] === 0xff
						? Buffer.from(buffer.subarray(2)).swap16().toString("utf16le")
						: buffer.toString("utf8").replace(/^\uFEFF/, "");
			const document = parseXmlStrict(xml, e.name);
			if (e.name.endsWith(".rels")) {
				if (
					document.documentElement.namespaceURI !== RELATIONSHIPS_NS ||
					document.documentElement.localName !== "Relationships"
				)
					throw new Error("DOCX invalid relationships root");
				const rels = elements(document, RELATIONSHIPS_NS, "Relationship"),
					ids = new Set<string>();
				for (const rel of rels) {
					const id = rel.getAttribute("Id"),
						target = rel.getAttribute("Target"),
						mode = rel.getAttribute("TargetMode");
					if (
						!id ||
						ids.has(id) ||
						!target ||
						!rel.getAttribute("Type") ||
						rel.parentNode !== document.documentElement ||
						(mode && !["Internal", "External"].includes(mode))
					)
						throw new Error("DOCX malformed or duplicate relationship");
					ids.add(id);
					if (mode !== "External") {
						const normalized = posix.normalize(
							target.startsWith("/")
								? target.slice(1)
								: posix.join(posix.dirname(posix.dirname(e.name)), target),
						);
						if (
							target.includes("\\") ||
							target.includes("\0") ||
							/^[a-z][a-z0-9+.-]*:/i.test(target) ||
							normalized === ".." ||
							normalized.startsWith("../") ||
							normalized.startsWith("/")
						)
							throw new Error("DOCX unsafe internal relationship target");
					}
				}
			}
			if (e.name === "[Content_Types].xml") {
				if (/macroEnabled/i.test(xml))
					throw new Error("DOCX package declares macro-enabled content");
				if (/digital-signature/i.test(xml))
					throw new Error("DOCX package declares digital signatures");
			}
		}
	}
	return zip;
}

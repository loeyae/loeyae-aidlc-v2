import { DOMParser } from "@xmldom/xmldom";

export const WORDPROCESSINGML_NS =
	"http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const RELATIONSHIPS_NS =
	"http://schemas.openxmlformats.org/package/2006/relationships";

export function parseXmlStrict(source: string, label: string): Document {
	if (/<!DOCTYPE\b|<!ENTITY\b/i.test(source)) {
		throw new Error(`unsafe XML declaration in ${label}`);
	}
	try {
		return new DOMParser({
			locator: false,
			onError: (level, message) => {
				throw new Error(`${level}: ${message}`);
			},
		}).parseFromString(source, "application/xml") as unknown as Document;
	} catch (error) {
		throw new Error(
			`invalid XML in ${label}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function elements(
	parent: Document | Element,
	namespace: string,
	localName: string,
): Element[] {
	return Array.from(parent.getElementsByTagNameNS(namespace, localName));
}

export function wordAttribute(
	element: Element | undefined,
	localName: string,
): string | undefined {
	if (!element) return undefined;
	return element.getAttributeNS(WORDPROCESSINGML_NS, localName) ?? undefined;
}

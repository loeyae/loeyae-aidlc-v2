import {
	DOMParser,
	XMLSerializer,
	type Node as XmldomNode,
} from "@xmldom/xmldom";

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

export function serializeXml(document: Document): string {
	return new XMLSerializer().serializeToString(
		document as unknown as XmldomNode,
	);
}

export function directChildren(parent: Element): Element[] {
	const result: Element[] = [];
	for (let node = parent.firstChild; node; node = node.nextSibling) {
		if (node.nodeType === 1) result.push(node as Element);
	}
	return result;
}

export function directChild(
	parent: Element,
	namespace: string,
	localName: string,
): Element | undefined {
	return directChildren(parent).find(
		(child) =>
			child.namespaceURI === namespace && child.localName === localName,
	);
}

export function elements(
	parent: Document | Element,
	namespace: string,
	localName: string,
): Element[] {
	return Array.from(parent.getElementsByTagNameNS(namespace, localName));
}

function wordPrefix(element: Element): string {
	let current: Element | null = element;
	while (current) {
		if (current.namespaceURI === WORDPROCESSINGML_NS && current.prefix) {
			return current.prefix;
		}
		current =
			current.parentNode?.nodeType === 1
				? (current.parentNode as Element)
				: null;
	}
	return "w";
}

export function createWordElement(parent: Element, localName: string): Element {
	const prefix = wordPrefix(parent);
	return parent.ownerDocument.createElementNS(
		WORDPROCESSINGML_NS,
		`${prefix}:${localName}`,
	);
}

export function wordAttribute(
	element: Element | undefined,
	localName: string,
): string | undefined {
	if (!element) return undefined;
	return element.getAttributeNS(WORDPROCESSINGML_NS, localName) ?? undefined;
}

export function setWordAttribute(
	element: Element,
	localName: string,
	value: string,
): void {
	const prefix = wordPrefix(element);
	element.setAttributeNS(WORDPROCESSINGML_NS, `${prefix}:${localName}`, value);
}

export function removeWordAttribute(element: Element, localName: string): void {
	element.removeAttributeNS(WORDPROCESSINGML_NS, localName);
}

export function ensureWordChild(
	parent: Element,
	localName: string,
	order: readonly string[],
): Element {
	const existing = directChild(parent, WORDPROCESSINGML_NS, localName);
	if (existing) return existing;
	const created = createWordElement(parent, localName);
	const targetRank = order.indexOf(localName);
	if (targetRank < 0) {
		parent.appendChild(created);
		return created;
	}
	for (const child of directChildren(parent)) {
		if (child.namespaceURI !== WORDPROCESSINGML_NS) continue;
		const childRank = order.indexOf(child.localName);
		if (childRank >= 0 && childRank > targetRank) {
			parent.insertBefore(created, child);
			return created;
		}
	}
	parent.appendChild(created);
	return created;
}

export function removeDirectWordChild(
	parent: Element,
	localName: string,
): void {
	const child = directChild(parent, WORDPROCESSINGML_NS, localName);
	if (child) parent.removeChild(child);
}

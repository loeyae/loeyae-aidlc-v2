interface StyleDefinition {
	id: string;
	type: string;
	name?: string;
	default: boolean;
}

export interface InspectionReport {
	schema_version: "1";
	input: {
		path: string;
		size_bytes: number;
		sha256: string;
	};
	package: {
		entries: number;
		files: number;
		directories: number;
		uncompressed_bytes: number;
		content_types: number;
		relationships: number;
		external_relationships: number;
		external_relationship_types: string[];
		embedded_objects: number;
		has_macros: false;
		has_digital_signatures: false;
	};
	metadata: Record<string, string | number>;
	document: {
		paragraphs: number;
		non_empty_paragraphs: number;
		tables: number;
		table_rows: number;
		table_cells: number;
		drawings: number;
		media_files: number;
		media_bytes: number;
		hyperlinks: number;
		sections: number;
		page_breaks: number;
		fields: number;
		content_controls: number;
		comments: number;
		footnotes: number;
		endnotes: number;
		tracked_insertions: number;
		tracked_deletions: number;
		tracked_moves: number;
		headers: number;
		footers: number;
		text_characters: number;
		text_sha256: string;
	};
	styles: {
		defined: number;
		by_type: Record<string, number>;
		definitions: StyleDefinition[];
		definitions_truncated: boolean;
		used_ids: string[];
		undefined_used_ids: string[];
		default_fonts: Record<string, string>;
		default_font_refs: Record<string, string>;
		theme_fonts: Record<string, string>;
		default_size_half_points?: number;
		numbering_definitions: number;
		used_numbering_ids: string[];
	};
	direct_formatting?: {
		paragraphs_total: number;
		paragraphs_with_direct_visual_overrides: number;
		runs_total: number;
		runs_with_direct_visual_overrides: number;
		preserved: boolean;
	};
	warnings: string[];
}

export interface StyleMapping {
	role: string;
	style_id: string;
	style_name?: string;
	style_type: string;
	matched_by: "explicit" | "default" | "style-id" | "style-name";
	used_count: number;
}

export interface CoverageReport {
	paragraphs_total: number;
	paragraphs_style_mapped: number;
	paragraphs_with_direct_visual_overrides: number;
	runs_total: number;
	runs_with_direct_visual_overrides: number;
	estimated_effective_paragraphs: number;
	estimated_effective_percent: number;
}

import type { Scenario, Tree, TreeValuation } from './types';
import { SPECIES_COLORS, speciesName } from './species';
import { valueTree } from './value';

const COLUMNS: [string, (t: Tree) => unknown][] = [
  ['tag', (t) => t.tag],
  ['tag_number', (t) => t.tagNumber],
  ['prefix', (t) => t.prefix],
  ['species', (t) => t.species],
  ['species_name', (t) => (t.species ? speciesName(t.species) : '')],
  ['circumference_cm', (t) => t.circumferenceCm],
  ['dbh_cm', (t) => t.dbhCm],
  ['height_m', (t) => t.heightM],
  ['photo_count', (t) => t.photos?.length ?? 0],
  ['height_source', (t) => t.heightSource],
  ['straightness', (t) => t.straightness],
  ['twist', (t) => t.twist],
  ['branchiness', (t) => t.branchiness],
  ['defects', (t) => t.defects],
  ['leave_tree', (t) => (t.leaveTree ? 'yes' : 'no')],
  ['notes', (t) => t.notes],
  ['status', (t) => t.status],
  ['voided', (t) => (t.voided ? 'yes' : 'no')],
  ['stump_diameter_cm', (t) => t.stumpDiameterCm],
  ['lat', (t) => t.lat],
  ['lon', (t) => t.lon],
  ['accuracy_m', (t) => t.accuracyM],
  ['fix_count', (t) => t.fixCount],
  ['block_id', (t) => t.blockId],
  ['created_by', (t) => t.createdBy],
  ['device_id', (t) => t.deviceId],
  ['created_at', (t) => t.createdAt],
  ['updated_at', (t) => t.updatedAt],
  ['id', (t) => t.id],
];

const VALUE_COLUMNS: [string, (v: TreeValuation) => unknown][] = [
  ['product', (v) => v.product],
  ['pole_class', (v) => v.poleClass],
  ['volume_m3', (v) => v.volumeM3],
  ['value_cad', (v) => (v.priced ? v.value : '')],
];

/** RFC 4180 field quoting: quote when the value has a comma, quote, CR or LF (or edge spaces). */
function csvField(v: unknown): string {
  if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) return '';
  const s = String(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV of all trees given (voided ones included, see the `voided` column), header
 * row first, CRLF line endings. With a scenario, product/pole_class/volume_m3/value_cad
 * columns are appended.
 */
export function toCsv(trees: Tree[], scenario?: Scenario): string {
  const header = [...COLUMNS.map((c) => c[0]), ...(scenario ? VALUE_COLUMNS.map((c) => c[0]) : [])];
  const lines = [header.join(',')];
  for (const t of trees) {
    const row = COLUMNS.map(([, f]) => csvField(f(t)));
    if (scenario) {
      const v = valueTree(t, scenario);
      row.push(...VALUE_COLUMNS.map(([, f]) => csvField(f(v))));
    }
    lines.push(row.join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/**
 * GeoJSON FeatureCollection of Point features ([lon, lat]). Properties are the
 * tree's fields (minus lat/lon) plus speciesName and color; with a scenario also
 * product, poleClass, volumeM3 and value. Voided trees are included (voided: true).
 */
export function toGeoJson(trees: Tree[], scenario?: Scenario): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: trees
      .filter((t) => Number.isFinite(t.lat) && Number.isFinite(t.lon))
      .map((t) => {
        const { lat, lon, ...rest } = t;
        const props: Record<string, unknown> = {
          ...rest,
          speciesName: t.species ? speciesName(t.species) : null,
          color: t.species ? SPECIES_COLORS[t.species] : '#9ca3af',
          circumference_cm: t.circumferenceCm ?? null,
        };
        if (scenario) {
          const v = valueTree(t, scenario);
          props.product = v.product;
          props.poleClass = v.poleClass;
          props.volumeM3 = v.volumeM3;
          props.value = v.priced ? v.value : null;
        }
        for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
        return {
          type: 'Feature' as const,
          id: t.id,
          geometry: { type: 'Point' as const, coordinates: [lon, lat] },
          properties: props,
        };
      }),
  };
}

function xml(s: unknown): string {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** "#rrggbb" -> KML "aabbggrr". */
function kmlColor(hex: string, alpha = 'ff'): string {
  const h = hex.replace('#', '');
  return `${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toLowerCase();
}

function ringCoords(ring: GeoJSON.Position[]): string {
  return ring.map((p) => `${p[0]},${p[1]},0`).join(' ');
}

/**
 * KML 2.2 document (Google Earth / Avenza). One Placemark per non-voided tree,
 * named by tag, styled by species colour (leave trees get their own style), and
 * an optional block boundary polygon.
 */
export function toKml(trees: Tree[], opts?: { name?: string; boundary?: GeoJSON.Polygon }): string {
  const name = opts?.name ?? 'Timber tally';
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
  out.push('<Document>');
  out.push(`<name>${xml(name)}</name>`);
  for (const [code, color] of Object.entries(SPECIES_COLORS)) {
    out.push(
      `<Style id="sp-${code}"><IconStyle><color>${kmlColor(color)}</color><scale>0.8</scale>` +
        `<Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle>` +
        `<LabelStyle><scale>0.7</scale></LabelStyle></Style>`,
    );
  }
  out.push(
    '<Style id="sp-unknown"><IconStyle><color>ffafa39c</color><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>',
  );
  out.push(
    '<Style id="leave"><IconStyle><color>ffffffff</color><Icon><href>http://maps.google.com/mapfiles/kml/shapes/triangle.png</href></Icon></IconStyle></Style>',
  );
  out.push(
    '<Style id="boundary"><LineStyle><color>ff1a6bff</color><width>3</width></LineStyle><PolyStyle><color>331a6bff</color></PolyStyle></Style>',
  );
  if (opts?.boundary && opts.boundary.coordinates.length) {
    const [outer, ...holes] = opts.boundary.coordinates;
    out.push('<Placemark><name>Block boundary</name><styleUrl>#boundary</styleUrl><Polygon><tessellate>1</tessellate>');
    out.push(`<outerBoundaryIs><LinearRing><coordinates>${ringCoords(outer)}</coordinates></LinearRing></outerBoundaryIs>`);
    for (const h of holes) {
      out.push(`<innerBoundaryIs><LinearRing><coordinates>${ringCoords(h)}</coordinates></LinearRing></innerBoundaryIs>`);
    }
    out.push('</Polygon></Placemark>');
  }
  out.push('<Folder><name>Trees</name>');
  for (const t of trees) {
    if (t.voided || !Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
    const style = t.leaveTree ? 'leave' : t.species ? `sp-${t.species}` : 'sp-unknown';
    const lines = [
      t.species ? speciesName(t.species) : 'Species not recorded',
      t.dbhCm !== undefined ? `DBH ${t.dbhCm} cm` : null,
      t.heightM !== undefined ? `Height ${t.heightM} m` : null,
      t.straightness !== undefined ? `Straightness ${t.straightness}` : null,
      t.twist !== undefined ? `Twist ${t.twist}` : null,
      t.branchiness !== undefined ? `Branchiness ${t.branchiness}` : null,
      t.defects ? `Defects: ${t.defects}` : null,
      t.leaveTree ? 'Leave tree' : null,
      t.notes ? `Notes: ${t.notes}` : null,
      `Status: ${t.status}`,
    ].filter(Boolean) as string[];
    out.push(
      `<Placemark><name>${xml(t.tag)}</name><description>${xml(lines.join('\n'))}</description>` +
        `<styleUrl>#${style}</styleUrl><Point><coordinates>${t.lon},${t.lat},0</coordinates></Point></Placemark>`,
    );
  }
  out.push('</Folder>');
  out.push('</Document>');
  out.push('</kml>');
  return out.join('\n') + '\n';
}

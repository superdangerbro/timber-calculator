import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO, polygonAreaHa, toCsv, toGeoJson, toKml, treesInArea } from '../src';
import type { Tree } from '../src';

// ~500 m x ~500 m square near Kamloops
const square: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[-120.355, 50.7], [-120.348, 50.7], [-120.348, 50.7045], [-120.355, 50.7045], [-120.355, 50.7]]],
};

function tree(over: Partial<Tree>): Tree {
  return {
    id: 'id-' + (over.tag ?? 'x'),
    tag: 'J-0001',
    tagNumber: 1,
    prefix: 'J',
    blockId: null,
    lat: 50.702,
    lon: -120.35,
    accuracyM: 3,
    fixCount: 5,
    status: 'standing',
    voided: false,
    createdBy: 'u1',
    deviceId: 'dev1',
    createdAt: '2026-10-01T17:00:00.000Z',
    updatedAt: '2026-10-01T17:00:00.000Z',
    version: 1,
    species: 'FD',
    dbhCm: 42,
    heightM: 20,
    straightness: 5,
    twist: 5,
    branchiness: 4,
    ...over,
  };
}

describe('area', () => {
  it('treesInArea filters by polygon', () => {
    const inside = tree({ tag: 'J-0001' });
    const outside = tree({ tag: 'J-0002', lat: 50.71 });
    expect(treesInArea([inside, outside], square)).toEqual([inside]);
    const multi: GeoJSON.MultiPolygon = { type: 'MultiPolygon', coordinates: [square.coordinates] };
    expect(treesInArea([inside, outside], multi)).toEqual([inside]);
  });
  it('polygonAreaHa', () => {
    const ha = polygonAreaHa(square);
    // 0.007° lon * cos(50.7°) * 111.32 km ≈ 0.494 km, 0.0045° lat ≈ 0.5 km
    expect(ha).toBeGreaterThan(22);
    expect(ha).toBeLessThan(27);
  });
});

/** Minimal XML well-formedness check: balanced tags, valid entities, single root. */
function assertWellFormedXml(s: string) {
  const body = s.replace(/^<\?xml[^?]*\?>\s*/, '');
  const stack: string[] = [];
  let roots = 0;
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"<]*")*)\s*(\/?)>|<|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[0] === '<' || m[0] === '&') throw new Error(`bad markup at ${m.index}: ${body.slice(m.index, m.index + 30)}`);
    const [, close, name, , selfClose] = m;
    if (close) {
      const open = stack.pop();
      if (open !== name) throw new Error(`mismatched </${name}> (open: ${open})`);
    } else if (!selfClose) {
      if (stack.length === 0) roots++;
      stack.push(name);
    }
  }
  expect(stack).toEqual([]);
  expect(roots).toBe(1);
}

describe('export', () => {
  const trees = [
    tree({ tag: 'J-0001', defects: 'sweep, "bad" at butt', notes: 'line1\nline2' }),
    tree({ tag: 'J-L0002', leaveTree: true, species: 'PY' }),
    tree({ tag: 'J-0003', voided: true }),
  ];

  it('CSV quotes commas, quotes and newlines', () => {
    const csv = toCsv(trees);
    const lines = csv.split('\r\n');
    expect(lines[0].startsWith('tag,tag_number,prefix,species')).toBe(true);
    expect(csv).toContain('"sweep, ""bad"" at butt"');
    expect(csv).toContain('"line1\nline2"');
    expect(lines[0]).not.toContain('product');
  });
  it('CSV with scenario adds valuation', () => {
    const csv = toCsv(trees, DEFAULT_SCENARIO);
    const [header, first] = csv.split('\r\n');
    expect(header.endsWith('product,pole_class,volume_m3,value_cad')).toBe(true);
    expect(first).toContain(',pole,Class 1,');
  });
  it('GeoJSON', () => {
    const gj = toGeoJson(trees, DEFAULT_SCENARIO);
    expect(gj.type).toBe('FeatureCollection');
    expect(gj.features).toHaveLength(3);
    const f = gj.features[0];
    expect(f.geometry).toEqual({ type: 'Point', coordinates: [-120.35, 50.702] });
    expect(f.properties).toMatchObject({ tag: 'J-0001', species: 'FD', speciesName: 'Douglas-fir', product: 'pole' });
    expect(JSON.parse(JSON.stringify(gj))).toEqual(gj);
  });
  it('KML is well-formed XML and escapes text', () => {
    const kml = toKml([...trees, tree({ tag: 'J-0004 <&>' })], { name: 'CB12 & friends', boundary: square });
    assertWellFormedXml(kml);
    expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
    expect(kml).toContain('<name>CB12 &amp; friends</name>');
    expect(kml).toContain('<name>J-0004 &lt;&amp;&gt;</name>');
    expect(kml).toContain('-120.35,50.702,0');
    expect(kml).toContain('<outerBoundaryIs>');
    expect(kml).not.toContain('J-0003'); // voided excluded
    expect(kml.match(/<Placemark>/g)).toHaveLength(4); // boundary + 3 trees
  });
  it('checker rejects broken XML', () => {
    expect(() => assertWellFormedXml('<a><b></a></b>')).toThrow();
    expect(() => assertWellFormedXml('<a>x & y</a>')).toThrow();
  });
});

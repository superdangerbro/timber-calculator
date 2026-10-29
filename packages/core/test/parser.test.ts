import { describe, expect, it } from 'vitest';
import { mergeDraft, missingFields, parseUtterance, REQUIRED_FIELDS } from '../src';
import type { TreeFields, VoiceCommand } from '../src';

const p = (s: string) => parseUtterance(s);

describe('parseUtterance: plan example', () => {
  it('"Big fir, forty-two, about thirty metres, two logs, bit of sweep at the butt."', () => {
    const r = p('Big fir, forty-two, about thirty metres, two logs, bit of sweep at the butt.');
    expect(r.fields.species).toBe('FD');
    expect(r.fields.dbhCm).toBe(42);
    expect(r.fields.heightM).toBe(30);
    expect(r.fields.heightSource).toBe('spoken');
    expect(r.fields.defects).toContain('sweep');
    expect(r.fields.defects).toContain('butt');
    // "two logs" must not become a score or DBH
    expect(r.fields.straightness).toBeUndefined();
    expect(r.fields.twist).toBeUndefined();
    expect(r.fields.branchiness).toBeUndefined();
    expect(r.command).toBeNull();
    expect(r.confidence).toBeGreaterThan(0.9);
  });
});

// [utterance, expected fields subset]
const fieldCases: [string, TreeFields][] = [
  ['big fir forty two thirty metres straight five no twist clean', { species: 'FD', dbhCm: 42, heightM: 30, straightness: 5, twist: 5, branchiness: 5 }],
  ['cedar 56 cm height 28 straight, a four, twist two, limby three', { species: 'CW', dbhCm: 56, heightM: 28, straightness: 4, twist: 2, branchiness: 3 }],
  ['DBH 42', { dbhCm: 42 }],
  ['d.b.h. forty two', { dbhCm: 42 }],
  ['D B H 42', { dbhCm: 42 }],
  ['forty two dbh', { dbhCm: 42 }],
  ['36 cm DBH', { dbhCm: 36 }],
  ['forty two cm', { dbhCm: 42 }],
  ['forty-two centimetres', { dbhCm: 42 }],
  ['diameter is thirty eight centimetres', { dbhCm: 38 }],
  ['sixteen inches', { dbhCm: 40.6 }],
  ['dbh 18 inches', { dbhCm: 45.7 }],
  ['height 28', { heightM: 28 }],
  ['height is twenty six', { heightM: 26 }],
  ['height of about 30 meters', { heightM: 30 }],
  ['thirty metres tall', { heightM: 30 }],
  ['twenty eight point five metres', { heightM: 28.5 }],
  ['ninety feet', { heightM: 27.4 }],
  ['Fir 42cm 30m', { species: 'FD', dbhCm: 42, heightM: 30 }],
  ['one hundred and five', { dbhCm: 105 }],
  ['Big Fir 42 30', { species: 'FD', dbhCm: 42, heightM: 30 }],
  ['dead straight', { straightness: 5 }],
  ['no twist', { twist: 5 }],
  ['zero twist', { twist: 5 }],
  ['clean', { branchiness: 5 }],
  ['no limbs', { branchiness: 5 }],
  ['limby three', { branchiness: 3 }],
  ['branchiness 2', { branchiness: 2 }],
  ['straightness of four', { straightness: 4 }],
  ['four on straightness', { straightness: 4 }],
  ['straight for twist to', { straightness: 4, twist: 2 }],
  ['twist to three', { twist: 3 }],
  ['straight five two logs', { straightness: 5, notes: '2 logs' }],
  ['leave tree', { leaveTree: true }],
  ['not a leave tree', { leaveTree: false }],
  ['leave tree fir forty', { leaveTree: true, species: 'FD', dbhCm: 40 }],
  ['make that cedar', { species: 'CW' }],
  ['no, forty-four', { dbhCm: 44 }],
  ['fir forty two, no, forty four', { species: 'FD', dbhCm: 44 }],
  ['thirty metres, no, thirty two', { heightM: 32 }],
  ['straight four, no, five', { straightness: 5 }],
  ['alpine fir 30', { species: 'BL', dbhCm: 30 }],
  ['douglas fir 50', { species: 'FD', dbhCm: 50 }],
  ['lodge pole pine 25', { species: 'PL', dbhCm: 25 }],
  ['yellow pine forty', { species: 'PY', dbhCm: 40 }],
  ['tamarack', { species: 'LW' }],
  ['poplar 22 cm 18 metres', { species: 'AT', dbhCm: 22, heightM: 18 }],
  ['cottonwood', { species: 'AC' }],
  ['fur forty two', { species: 'FD', dbhCm: 42 }],
  ['PL 30', { species: 'PL', dbhCm: 30 }],
  ['its a fir about 40 cm', { species: 'FD', dbhCm: 40 }],
  ['Hemlock, 44. 31 metres. Straight 3. Twist 4. Branchy 2. Scar at the base.', { species: 'HW', dbhCm: 44, heightM: 31, straightness: 3, twist: 4, branchiness: 2, defects: 'scar at the base' }],
  ['larch thirty eight twenty six metres dead straight twist four branchy two frost crack', { species: 'LW', dbhCm: 38, heightM: 26, straightness: 5, twist: 4, branchiness: 2, defects: 'frost crack' }],
  ['cedar, 61 centimeters, 24 meters, straight 3, twist 5, branchy 4, catface at the butt, save', { species: 'CW', dbhCm: 61, heightM: 24, straightness: 3, twist: 5, branchiness: 4, defects: 'catface at the butt' }],
];

describe('parseUtterance: fields', () => {
  it.each(fieldCases)('%s', (text, expected) => {
    expect(p(text).fields).toMatchObject(expected);
  });
});

describe('parseUtterance: defects', () => {
  it('rot at the butt', () => {
    expect(p('rot at the butt').fields.defects).toBe('rot at the butt');
  });
  it('"fork at twenty": 20 belongs to the defect, not height or dbh', () => {
    const r = p('fork at twenty');
    expect(r.fields.defects).toBe('fork at 20');
    expect(r.fields.dbhCm).toBeUndefined();
    expect(r.fields.heightM).toBeUndefined();
  });
  it('fork at twenty with a real height after it', () => {
    const r = p('fir fork at twenty thirty metres');
    expect(r.fields).toMatchObject({ species: 'FD', heightM: 30, defects: 'fork at 20' });
    expect(r.fields.dbhCm).toBeUndefined();
  });
  it('crook at 8 metres does not set height', () => {
    const r = p('fir, 42, crook at 8 metres');
    expect(r.fields).toMatchObject({ dbhCm: 42, defects: 'crook at 8 metres' });
    expect(r.fields.heightM).toBeUndefined();
  });
  it('fork 20 feet up', () => {
    const r = p('fork 20 feet up');
    expect(r.fields.defects).toBe('fork 20 feet up');
    expect(r.fields.heightM).toBeUndefined();
  });
  it('multiple defects are joined with "; "', () => {
    expect(p('conk and fork in the top').fields.defects).toBe('conk; fork in the top');
  });
  it('dead top is a defect but dead straight is not', () => {
    expect(p('balsam dead top').fields).toMatchObject({ species: 'BL', defects: 'dead top' });
    expect(p('dead straight').fields.defects).toBeUndefined();
  });
  it('"no rot" records nothing', () => {
    const r = p('no rot');
    expect(r.fields.defects).toBeUndefined();
    expect(r.confidence).toBe(1);
  });
});

describe('parseUtterance: commands', () => {
  const cmds: [string, VoiceCommand][] = [
    ['save', 'save'],
    ['done', 'save'],
    ['tag it', 'save'],
    ['repeat', 'repeat'],
    ['say again', 'repeat'],
    ['undo', 'undo'],
    ['undo last', 'undo'],
    ['scratch that', 'undo'],
    ['measure height', 'measure_height'],
    ['cancel', 'cancel'],
    ['next tree', 'new_tree'],
    ['new tree', 'new_tree'],
  ];
  it.each(cmds)('%s -> %s', (text, cmd) => {
    const r = p(text);
    expect(r.command).toBe(cmd);
    expect(r.confidence).toBe(1);
  });
  it('"measure height" does not set a height', () => {
    expect(p('measure height').fields.heightM).toBeUndefined();
  });
  it('fields and a command in one utterance', () => {
    const r = p('larch 38 cm 26 m straight 4 twist 4 branchy 3 save');
    expect(r.command).toBe('save');
    expect(r.fields).toMatchObject({ species: 'LW', dbhCm: 38, heightM: 26, straightness: 4, twist: 4, branchiness: 3 });
  });
});

describe('parseUtterance: homophones and robustness', () => {
  it('"for"/"to" are only numbers right after a scale word', () => {
    const r = p('good for poles');
    expect(r.fields).toEqual({});
  });
  it('"straight to the top" is not a score', () => {
    expect(p('straight to the top').fields.straightness).toBeUndefined();
  });
  it('"straight for a pole" is not a score', () => {
    expect(p('straight for a pole').fields.straightness).toBeUndefined();
  });
  it('out-of-range score is ignored', () => {
    expect(p('straightness 6').fields.straightness).toBeUndefined();
  });
  it('"two logs" alone goes to notes, not dbh', () => {
    const r = p('two logs');
    expect(r.fields.dbhCm).toBeUndefined();
    expect(r.fields.notes).toBe('2 logs');
  });
  it('gibberish has low confidence and is returned as unparsed', () => {
    const r = p('banana helicopter');
    expect(r.confidence).toBe(0);
    expect(r.unparsed).toBe('banana helicopter');
    expect(r.fields).toEqual({});
  });
  it('only filler words -> confidence 0, nothing unparsed', () => {
    const r = p('um the uh');
    expect(r.confidence).toBe(0);
    expect(r.unparsed).toBe('');
  });
  it('partial understanding gives partial confidence', () => {
    const r = p('fir forty two banana');
    expect(r.fields).toMatchObject({ species: 'FD', dbhCm: 42 });
    expect(r.confidence).toBeCloseTo(2 / 3, 2);
    expect(r.unparsed).toBe('banana');
  });
  it('empty input', () => {
    expect(p('')).toEqual({ fields: {}, command: null, unparsed: '', confidence: 0 });
  });
});

describe('mergeDraft / missingFields', () => {
  it('later wins, defects appended', () => {
    const a: TreeFields = { species: 'FD', dbhCm: 42, defects: 'sweep at the butt' };
    const b: TreeFields = { dbhCm: 44, defects: 'fork at 20', heightM: 30 };
    expect(mergeDraft(a, b)).toEqual({ species: 'FD', dbhCm: 44, heightM: 30, defects: 'sweep at the butt; fork at 20' });
  });
  it('undefined values do not erase', () => {
    expect(mergeDraft({ species: 'FD' }, { species: undefined, dbhCm: 30 })).toEqual({ species: 'FD', dbhCm: 30 });
  });
  it('same defect is not duplicated', () => {
    expect(mergeDraft({ defects: 'rot' }, { defects: 'rot' }).defects).toBe('rot');
  });
  it('parse + merge across utterances', () => {
    let d: TreeFields = {};
    for (const u of ['big fir forty two', 'thirty metres', 'straight a four', 'no twist', 'limby three', 'no, forty four']) {
      d = mergeDraft(d, p(u).fields);
    }
    expect(d).toMatchObject({ species: 'FD', dbhCm: 44, heightM: 30, straightness: 4, twist: 5, branchiness: 3 });
    expect(missingFields(d)).toEqual([]);
  });
  it('missingFields lists required fields; leave trees need only species and dbh', () => {
    expect(REQUIRED_FIELDS).toEqual(['species', 'dbhCm', 'heightM', 'straightness', 'twist', 'branchiness']);
    expect(missingFields({ species: 'FD', dbhCm: 40 })).toEqual(['heightM', 'straightness', 'twist', 'branchiness']);
    expect(missingFields({ species: 'FD', dbhCm: 40, leaveTree: true })).toEqual([]);
    expect(missingFields({ leaveTree: true })).toEqual(['species', 'dbhCm']);
  });
});

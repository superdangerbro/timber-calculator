import { z } from 'zod';

const geom = z.union([
  z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.array(z.number()).min(2))).min(1) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(z.array(z.array(z.number()).min(2))).min(1)).min(1) }),
]);

export const eventSchema = z.object({
  id: z.string().uuid(),
  treeId: z.string().uuid(),
  seq: z.number().int().min(1),
  type: z.enum(['create', 'update', 'void', 'status']),
  payload: z.record(z.unknown()),
  userId: z.string().min(1),
  deviceId: z.string().min(1).max(200),
  createdAt: z.string().min(10),
  prevHash: z.string(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

export const blockSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  code: z.string().max(20).optional().nullable(),
  boundary: geom,
  createdBy: z.string().optional(),
  createdAt: z.string().optional(),
});

export const pushSchema = z.object({
  deviceId: z.string().min(1).max(200),
  deviceName: z.string().max(200).optional(),
  events: z.array(z.unknown()).max(5000),
  blocks: z.array(blockSchema).optional(),
});

export const scaleSchema = z.number().int().min(1).max(5);
export const fieldsSchema = z.object({
  species: z.enum(['FD', 'CW', 'LW', 'PL', 'PY', 'SX', 'BL', 'HW', 'AT', 'EP', 'AC']).optional(),
  dbhCm: z.number().min(1).max(400).optional(),
  circumferenceCm: z.number().min(3).max(1300).nullable().optional(),
  heightM: z.number().min(0.5).max(90).optional(),
  heightSource: z.enum(['spoken', 'clinometer', 'estimated']).optional(),
  straightness: scaleSchema.optional(),
  twist: scaleSchema.optional(),
  branchiness: scaleSchema.optional(),
  defects: z.string().max(1000).optional(),
  leaveTree: z.boolean().optional(),
  notes: z.string().max(4000).optional(),
}).strict();

export const treeEditSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('update'), payload: z.object({ fields: fieldsSchema }) }),
  z.object({ type: z.literal('void'), payload: z.object({ reason: z.string().max(500).optional() }) }),
  z.object({
    type: z.literal('status'),
    payload: z.object({ status: z.enum(['standing', 'cut', 'damaged', 'missing']), stumpDiameterCm: z.number().optional() }),
  }),
]);

export { geom as geometrySchema };

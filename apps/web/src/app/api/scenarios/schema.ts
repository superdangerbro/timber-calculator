import { z } from 'zod';

const money = z.number().min(0).max(1_000_000);
export const scenarioBody = z.object({
  name: z.string().min(1).max(100),
  polePrices: z.record(z.object({ perPiece: money, perMetre: money })),
  sawlogPricePerM3: z.record(money),
  poleSpec: z.object({
    species: z.array(z.string()),
    minLengthM: z.number().min(0).max(80),
    minStraightness: z.number().int().min(1).max(5),
    minTwist: z.number().int().min(1).max(5),
    minBranchiness: z.number().int().min(1).max(5),
    classes: z.array(z.object({ name: z.string().min(1), minDbhCm: z.number().min(0), minLengthM: z.number().min(0) })),
  }),
  volumeCoefficients: z.record(z.object({ a: z.number(), b: z.number(), c: z.number() })).optional(),
  defectDeduction: z.number().min(0).max(1),
}).passthrough();

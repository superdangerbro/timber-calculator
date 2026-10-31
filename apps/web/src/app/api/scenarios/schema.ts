import { z } from 'zod';
import { BEC_ZONES } from '@timber/core';

const money = z.number().min(0).max(1_000_000);
export const scenarioBody = z.object({
  name: z.string().min(1).max(100),
  // All prices are $/m³. Legacy per-piece `polePrices` is accepted and dropped.
  polePricePerM3: z.record(money).default({}),
  polePrices: z.unknown().optional(),
  sawlogPricePerM3: z.record(money).default({}),
  poleLengthTiers: z.array(z.object({
    minFt: z.number().min(0).max(300),
    maxFt: z.number().min(0).max(300).nullable(),
    pricePerM3: money,
  })).max(20).optional(),
  poleSpec: z.object({
    species: z.array(z.string()),
    minLengthM: z.number().min(0).max(80),
    minStraightness: z.number().int().min(1).max(5),
    minTwist: z.number().int().min(1).max(5),
    minBranchiness: z.number().int().min(1).max(5),
    classes: z.array(z.object({ name: z.string().min(1), minDbhCm: z.number().min(0), minLengthM: z.number().min(0) })),
    cards: z.array(z.object({
      name: z.string().min(1).max(100),
      species: z.array(z.string()),
      trimFt: z.number().min(0).max(20),
      rows: z.array(z.object({
        minDiam6FtIn: z.number().min(0).max(100),
        lengthsFt: z.array(z.number().min(0).max(200)).max(20),
        minTopIn: z.number().min(0).max(40),
      })).max(40),
    })).max(10).optional(),
  }),
  becZone: z.enum(BEC_ZONES as unknown as [string, ...string[]]).optional(),
  topDibCm: z.number().min(5).max(60).optional(),
  volumeCoefficients: z.record(z.object({ a: z.number(), b: z.number(), c: z.number() })).optional(),
  defectDeduction: z.number().min(0).max(1),
}).passthrough().transform(({ polePrices: _legacy, ...rest }) => rest);

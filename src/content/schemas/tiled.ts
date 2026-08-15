import { z } from 'zod';

const tiledPropertySchema = z
  .object({
    name: z.string(),
    type: z.string().optional(),
    value: z.union([z.string(), z.number(), z.boolean()]),
  })
  .passthrough();

const layerBase = {
  id: z.number().int(),
  name: z.string(),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  x: z.number().default(0),
  y: z.number().default(0),
};

export const tiledImageLayerSchema = z
  .object({
    ...layerBase,
    type: z.literal('imagelayer'),
    image: z.string(),
    properties: z.array(tiledPropertySchema).optional(),
  })
  .passthrough();

export const tiledTileLayerSchema = z
  .object({
    ...layerBase,
    type: z.literal('tilelayer'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    data: z.array(z.number().int().nonnegative()),
    properties: z.array(tiledPropertySchema).optional(),
  })
  .passthrough();

export const tiledObjectSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    class: z.string().optional(),
    type: z.string().optional(),
    point: z.boolean().optional(),
    x: z.number(),
    y: z.number(),
    properties: z.array(tiledPropertySchema).optional(),
  })
  .passthrough();

export const tiledObjectLayerSchema = z
  .object({
    ...layerBase,
    type: z.literal('objectgroup'),
    objects: z.array(tiledObjectSchema),
    properties: z.array(tiledPropertySchema).optional(),
  })
  .passthrough();

const tiledLayerSchema = z.discriminatedUnion('type', [
  tiledImageLayerSchema,
  tiledTileLayerSchema,
  tiledObjectLayerSchema,
]);

const tiledTileSchema = z
  .object({
    id: z.number().int().nonnegative(),
    properties: z.array(tiledPropertySchema).optional(),
  })
  .passthrough();

export const tiledTilesetSchema = z
  .object({
    firstgid: z.number().int().positive(),
    source: z.string().optional(),
    name: z.string().optional(),
    tilewidth: z.number().int().positive().optional(),
    tileheight: z.number().int().positive().optional(),
    tilecount: z.number().int().positive().optional(),
    columns: z.number().int().positive().optional(),
    image: z.string().optional(),
    imagewidth: z.number().int().positive().optional(),
    imageheight: z.number().int().positive().optional(),
    margin: z.number().int().nonnegative().optional(),
    spacing: z.number().int().nonnegative().optional(),
    tiles: z.array(tiledTileSchema).optional(),
    properties: z.array(tiledPropertySchema).optional(),
  })
  .passthrough();

export const tiledMapSchema = z
  .object({
    type: z.literal('map'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    infinite: z.boolean(),
    orientation: z.string(),
    renderorder: z.string(),
    tilewidth: z.number().int().positive(),
    tileheight: z.number().int().positive(),
    layers: z.array(tiledLayerSchema),
    tilesets: z.array(tiledTilesetSchema).min(1),
    properties: z.array(tiledPropertySchema).optional(),
  })
  .passthrough();

export type TiledMap = z.infer<typeof tiledMapSchema>;
export type TiledLayer = TiledMap['layers'][number];
export type TiledTileLayer = z.infer<typeof tiledTileLayerSchema>;
export type TiledObjectLayer = z.infer<typeof tiledObjectLayerSchema>;
export type TiledObject = z.infer<typeof tiledObjectSchema>;
export type TiledTileset = z.infer<typeof tiledTilesetSchema>;

import { Container } from 'pixi.js';
import type { TacticalSceneGraph } from '../types.js';

/**
 * Builds the 7-layer PixiJS scene graph hierarchy under ViewportContainer as defined in Spec 05 Section 3.1.
 */
export function createSceneGraph(stage: Container): TacticalSceneGraph {
  const viewport = new Container();
  viewport.label = 'ViewportContainer';

  const terrainLayer = new Container();
  terrainLayer.label = 'TerrainTileLayer';

  const hazardLayer = new Container();
  hazardLayer.label = 'HazardZoneLayer';

  const propLayer = new Container();
  propLayer.label = 'PropLayer';

  const pathAoeLayer = new Container();
  pathAoeLayer.label = 'PathAndAoeLayer';

  const tokenLayer = new Container();
  tokenLayer.label = 'CreatureTokenLayer';

  const fogLayer = new Container();
  fogLayer.label = 'LightingAndFogLayer';

  const floatingTextLayer = new Container();
  floatingTextLayer.label = 'FloatingTextLayer';

  // Add layers strictly in bottom-to-top z-index order
  viewport.addChild(terrainLayer);
  viewport.addChild(hazardLayer);
  viewport.addChild(propLayer);
  viewport.addChild(pathAoeLayer);
  viewport.addChild(tokenLayer);
  viewport.addChild(fogLayer);
  viewport.addChild(floatingTextLayer);

  stage.addChild(viewport);

  return {
    stage,
    viewport,
    terrainLayer,
    hazardLayer,
    propLayer,
    pathAoeLayer,
    tokenLayer,
    fogLayer,
    floatingTextLayer,
  };
}

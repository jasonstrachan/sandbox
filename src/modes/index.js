import { runHatch } from './hatch.js';
import { runContours } from './contours.js';
import { runFlow } from './flow.js';
import { runGuidedFlow } from './guided.js';
import { runSkinFlow } from './skinFlow.js';
import { runClippedFlow } from './clipFlow.js';
import { runNoiseFlow } from './noiseFlow.js';
import { runNoiseDashedFlow } from './noiseDashedFlow.js';
import { runStippleDots, runStippleDashes } from './stipple.js';
import { createExampleModes } from './examples.js';
import { runNet } from './net.js';
import { runHanddrawnCircles } from './handdrawnCircles.js';
import { runVoronoiShards } from './voronoiShards.js';
import { runSpiralBloom } from './spiralBloom.js';
import { runWatercolorWash } from './watercolorWash.js';
import { runFabricWeave } from './fabricWeave.js';
import { runIsolineGlow } from './isolineGlow.js';
import { runMosaicTessellation } from './mosaicTessellation.js';
import { runInkRibbons } from './inkRibbons.js';
import { runExpressiveBrush } from './expressiveBrush.js';
import { runExpressivePixelBrush } from './expressivePixelBrush.js';
import { runAsciiFill } from './asciiFill.js';

export function createModes() {
  return {
    hatch: (deps) => runHatch(deps),
    net: (deps) => runNet(deps),
    contours: (deps) => runContours(deps),
    flow: (deps) => runFlow(deps),
    guided: (deps) => runGuidedFlow(deps),
    skinFlow: (deps) => runSkinFlow(deps),
    clipFlow: (deps) => runClippedFlow(deps),
    noise: (deps) => runNoiseFlow(deps),
    noiseDashed: (deps) => runNoiseDashedFlow(deps),
    stippleDots: (deps) => runStippleDots(deps),
    stippleDashes: (deps) => runStippleDashes(deps),
    handdrawnCircles: (deps) => runHanddrawnCircles(deps),
    voronoiShards: (deps) => runVoronoiShards(deps),
    spiralBloom: (deps) => runSpiralBloom(deps),
    watercolorWash: (deps) => runWatercolorWash(deps),
    fabricWeave: (deps) => runFabricWeave(deps),
    isolineGlow: (deps) => runIsolineGlow(deps),
    mosaicTessellation: (deps) => runMosaicTessellation(deps),
    inkRibbons: (deps) => runInkRibbons(deps),
    expressiveBrush: (deps) => runExpressiveBrush(deps),
    pixelatedBrush: (deps) => runExpressivePixelBrush(deps),
    asciiFill: (deps) => runAsciiFill(deps),
    ...createExampleModes(),
  };
}

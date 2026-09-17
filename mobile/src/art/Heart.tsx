import { useId } from 'react'
import Svg, { Circle, ClipPath, Defs, G, Path, RadialGradient, Stop } from 'react-native-svg'

import { tokens } from '../design/tokens'

// §6.4. A carved vessel holding a light that is nearly dead at 0% and fully alive at the
// Threshold. Above the Threshold it stays bright and stops escalating, so `fraction` arrives
// already clamped to 1.
//
// The vessel is a recess in the stone field, so its bevel is inverted per §3.3: dark edge at the
// top, lit edge below. The light is clipped to the vessel's inner *cavity* rather than to its
// silhouette — clipped to the outline it read as a round lamp floating on top of the vessel
// instead of a light held inside it, and shaped by it.
//
// The light is fixed layers: an ember core plus two radial glows. No gradient stop is recomputed
// per value — only opacity and scale derive from the fraction, so item 2 can drive this from a
// shared value without touching geometry.

type HeartProps = {
  /** boardTotal / winTarget, clamped to 0..1 by the caller. */
  fraction: number
}

export function Heart({ fraction }: HeartProps) {
  // Unique per instance: duplicate ids across Svg elements render wrong on Android.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const coreId = `core${uid}`
  const glowId = `glow${uid}`
  const haloId = `halo${uid}`
  const cavityId = `cavity${uid}`

  const { art, palette } = tokens
  const { width, height } = art.heartBox
  const { x: cx, y: cy } = art.heartLightCentre
  const light = art.heartLight
  const edge = art.apertureEdge

  const f = Math.max(0, Math.min(1, fraction))

  const coreOpacity = light.coreBase + light.coreGain * f
  const glowOpacity = light.glowBase + light.glowGain * f
  const haloOpacity = light.haloBase + light.haloGain * f
  const glowScale = light.scaleBase + light.scaleGain * f

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <ClipPath id={cavityId}>
          <Path d={art.heartCavityPath} />
        </ClipPath>
        <RadialGradient id={coreId} cx="50%" cy="50%" r="50%" gradientUnits="objectBoundingBox">
          <Stop offset="0" stopColor={palette.flameWhite} stopOpacity={1} />
          <Stop offset="1" stopColor={palette.flame} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={glowId} cx="50%" cy="50%" r="50%" gradientUnits="objectBoundingBox">
          <Stop offset="0" stopColor={palette.flame} stopOpacity={1} />
          <Stop offset="1" stopColor={palette.flameDeep} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={haloId} cx="50%" cy="50%" r="50%" gradientUnits="objectBoundingBox">
          <Stop offset="0" stopColor={palette.flameCold} stopOpacity={1} />
          <Stop offset="1" stopColor={palette.flameCold} stopOpacity={0} />
        </RadialGradient>
      </Defs>

      {/* The recess floor: the vessel is cut into the field, so its face is darker than stone. */}
      <Path d={art.heartVesselPath} fill={palette.char} />

      {/* The cavity, deeper still. */}
      <Path d={art.heartCavityPath} fill={palette.void} />

      {/* The light, held inside the cavity and shaped by it. */}
      <G clipPath={`url(#${cavityId})`}>
        <Circle
          cx={cx}
          cy={cy}
          r={art.heartHaloRadius}
          fill={`url(#${haloId})`}
          opacity={haloOpacity}
          scale={glowScale}
          originX={cx}
          originY={cy}
        />
        <Circle
          cx={cx}
          cy={cy}
          r={art.heartGlowRadius}
          fill={`url(#${glowId})`}
          opacity={glowOpacity}
          scale={glowScale}
          originX={cx}
          originY={cy}
        />
        <Circle cx={cx} cy={cy} r={art.heartCoreRadius} fill={`url(#${coreId})`} opacity={coreOpacity} />
      </G>

      {/* Both edges carved as recesses: lit edge below, dark edge on top. No shadow, no glow. */}
      <Path d={art.heartCavityPath} fill="none" stroke={palette.stoneLit} strokeWidth={edge} translateY={edge} />
      <Path d={art.heartCavityPath} fill="none" stroke={palette.bevelShadow} strokeWidth={edge} />
      <Path d={art.heartVesselPath} fill="none" stroke={palette.stoneLit} strokeWidth={edge} translateY={edge} />
      <Path d={art.heartVesselPath} fill="none" stroke={palette.bevelShadow} strokeWidth={edge} />
    </Svg>
  )
}

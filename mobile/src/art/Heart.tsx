import { useId } from 'react'
import Svg, { Circle, ClipPath, Defs, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg'

import { tokens } from '../design/tokens'

// §6.4. A carved vessel containing a light that is nearly dead at 0% and fully alive at the
// Threshold. Above the Threshold it stays bright and stops escalating, so `fraction` arrives
// already clamped to 1.
//
// The light is fixed layers — an ember core plus two radial-gradient glows. No gradient stop is
// recomputed per value: only opacity and scale derive from the fraction, so item 2 can drive
// this from a shared value without touching geometry.

export type VesselVariant = 'A' | 'B'

type HeartProps = {
  /** boardTotal / winTarget, clamped to 0..1 by the caller. */
  fraction: number
  vessel?: VesselVariant
}

export function Heart({ fraction, vessel = 'B' }: HeartProps) {
  // Unique per instance: duplicate ids across Svg elements render wrong on Android.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const coreId = `core${uid}`
  const glowId = `glow${uid}`
  const haloId = `halo${uid}`
  const clipId = `vessel${uid}`

  const { art, palette } = tokens
  const { width, height } = art.heartBox
  const { x: cx, y: cy } = art.heartLightCentre
  const light = art.heartLight

  const f = Math.max(0, Math.min(1, fraction))
  const path = vessel === 'A' ? art.heartVesselPathA : art.heartVesselPathB

  const coreOpacity = light.coreBase + light.coreGain * f
  const glowOpacity = light.glowBase + light.glowGain * f
  const haloOpacity = light.haloBase + light.haloGain * f
  const glowScale = light.scaleBase + light.scaleGain * f

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <ClipPath id={clipId}>
          <Path d={path} />
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

      {/* The vessel body. */}
      <Path d={path} fill={palette.stone} />

      {/* The light, contained. */}
      <G clipPath={`url(#${clipId})`}>
        <Rect x={0} y={0} width={width} height={height} fill={palette.void} />
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

      {/* Carved, per §3.3: the dark edge sits a hair below the light one. No shadow, no glow. */}
      <Path
        d={path}
        fill="none"
        stroke={palette.bevelShadow}
        strokeWidth={art.thresholdThickness}
        translateY={art.thresholdThickness}
      />
      <Path d={path} fill="none" stroke={palette.stoneLit} strokeWidth={art.thresholdThickness} />
    </Svg>
  )
}

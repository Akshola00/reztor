import { useId } from 'react'
import Svg, { ClipPath, Defs, G, LinearGradient, Rect, Stop } from 'react-native-svg'

import { tokens } from '../design/tokens'

// §6.2. A fixed-height aperture. Built so that item 2 can animate it by changing nothing but
// transform and opacity props:
//
//   - The fill is a <rect> at full conduit height inside a clip path, scaled about its bottom
//     edge. Never animate height or y.
//   - Its gradient uses objectBoundingBox units, so the gradient squashes with the rect and the
//     top of the fill is always `flame`, whatever the units.
//   - The frontier sits outside the scaled group and moves by translateY, so scaling can never
//     squash it.
//   - The frontier's glow is a gradient rect that travels with it. No <Filter>, no blur:
//     Android re-rasterises filters and the Offering stage must hold 60fps.

type ConduitProps = {
  units: number
  capacity: number
  dormant: boolean
  height: number
  width?: number
}

export function Conduit({ units, capacity, dormant, height, width = tokens.art.conduitWidth }: ConduitProps) {
  // Unique per instance: duplicate ids across Svg elements render wrong on Android.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const fillId = `fill${uid}`
  const glowId = `glow${uid}`
  const clipId = `clip${uid}`

  const { art, palette, cold } = tokens

  const fraction = Math.max(0, Math.min(1, capacity > 0 ? units / capacity : 0))
  const consecrated = units > 0
  // react-native-svg reads scaleY={0} as falsy and falls back to 1, which draws an empty
  // conduit completely full. Floor the scale and gate the fill's opacity. See art.fillScaleFloor.
  const fillScale = Math.max(art.fillScaleFloor, fraction)

  // Where the top of the fill lands, in pixels from the top of the aperture.
  const fillTop = height - fraction * height
  const frontierY = Math.max(0, Math.min(height - art.frontierThickness, fillTop - art.frontierThickness / 2))

  // §6.2: a dormant lane keeps its fill but desaturates, and its frontier goes flat boneFaint.
  const base = dormant ? cold.flameDeep : palette.flameDeep
  const body = dormant ? cold.flame : palette.flame
  const unfilled = dormant ? cold.char : palette.char
  const frontierColour = dormant ? palette.boneFaint : palette.flameCold

  const grainOffsets: number[] = []
  for (let x = art.conduitGrainPitch; x < width; x += art.conduitGrainPitch) {
    grainOffsets.push(x)
  }

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={fillId} x1="0" y1="1" x2="0" y2="0" gradientUnits="objectBoundingBox">
          <Stop offset="0" stopColor={base} />
          <Stop offset="1" stopColor={body} />
        </LinearGradient>
        <LinearGradient id={glowId} x1="0" y1="1" x2="0" y2="0" gradientUnits="objectBoundingBox">
          <Stop offset="0" stopColor={palette.flameCold} stopOpacity={art.frontierGlowOpacity} />
          <Stop offset="1" stopColor={palette.flameCold} stopOpacity={0} />
        </LinearGradient>
        <ClipPath id={clipId}>
          <Rect x={0} y={0} width={width} height={height} />
        </ClipPath>
      </Defs>

      <G clipPath={`url(#${clipId})`}>
        {/* Unfilled stone, not a hole. */}
        <Rect x={0} y={0} width={width} height={height} fill={unfilled} />
        {grainOffsets.map((x) => (
          <Rect
            key={x}
            x={x}
            y={0}
            width={art.conduitGrainWidth}
            height={height}
            fill={palette.stoneEdge}
            opacity={art.conduitGrainOpacity}
          />
        ))}

        {/* The fill. Item 2 animates scaleY on this rect and nothing else. */}
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill={`url(#${fillId})`}
          scaleY={fillScale}
          originY={height}
          opacity={consecrated ? 1 : 0}
        />

        {/* The glow, riding above the frontier. Item 2 animates translateY. */}
        <Rect
          x={0}
          y={0}
          width={width}
          height={art.frontierGlowHeight}
          fill={`url(#${glowId})`}
          translateY={frontierY - art.frontierGlowHeight}
          opacity={consecrated && !dormant ? 1 : 0}
        />
      </G>

      {/* The frontier. Outside the scaled group, so it keeps its 2px whatever the fill does. */}
      <Rect
        x={0}
        y={0}
        width={width}
        height={art.frontierThickness}
        fill={frontierColour}
        translateY={frontierY}
        opacity={consecrated ? 1 : 0}
      />

      {/* The aperture's carved lip, per §3.3, inverted because an opening is cut inward: the dark
          edge on top and the light edge at the foot. Drawn last so the fill cannot cover it.
          Without this the conduits read as bars floating on the void rather than openings. */}
      <Rect x={0} y={0} width={width} height={art.apertureEdge} fill={palette.bevelShadow} />
      <Rect x={0} y={height - art.apertureEdge} width={width} height={art.apertureEdge} fill={palette.stoneLit} />
    </Svg>
  )
}

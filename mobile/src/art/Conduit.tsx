import { useId } from 'react'
import Svg, { ClipPath, Defs, G, LinearGradient, Rect, Stop } from 'react-native-svg'

import { tokens } from '../design/tokens'

// §6.2. A recessed aperture cut into the stone field. Built so that item 2 can animate it by
// changing nothing but transform and opacity props:
//
//   - The fill is a <rect> at full conduit height inside a clip path, scaled about its bottom
//     edge. Never animate height or y.
//   - Its gradient uses objectBoundingBox units, so the gradient squashes with the rect and the
//     top of the fill is always bright, whatever the units. flameDeep holds most of the column.
//   - The frontier sits outside the scaled group and moves by translateY, so scaling can never
//     squash it.
//   - The frontier's glow is a gradient rect that travels with it, clipped inside the aperture.
//     No <Filter>, no blur: Android re-rasterises filters and the Offering stage holds 60fps.
//
// The Threshold is drawn here, on the unfilled char and *under* the fill, so one carved line
// reads across every conduit and the fill passes in front of it.

type ConduitProps = {
  units: number
  capacity: number
  dormant: boolean
  height: number
  /** winTarget / laneCount / laneCapacity — where the Threshold crosses this aperture. */
  thresholdFraction: number
  crossed: boolean
  width?: number
}

export function Conduit({
  units,
  capacity,
  dormant,
  height,
  thresholdFraction,
  crossed,
  width = tokens.art.conduitWidth,
}: ConduitProps) {
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

  // Where the top of the fill lands, in pixels from the top of the aperture. Clamped inside the
  // carved lip at both ends, so a lane at capacity keeps a visible frontier instead of having it
  // overdrawn by the lip.
  const fillTop = height - fraction * height
  const frontierY = Math.max(
    art.apertureEdge,
    Math.min(height - art.frontierThickness - art.apertureEdge, fillTop - art.frontierThickness / 2),
  )
  const thresholdY = height * (1 - thresholdFraction)

  // §6.2: a dormant lane keeps its fill but desaturates and darkens, and its frontier goes flat.
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
          <Stop offset={String(art.fillDeepHoldOffset)} stopColor={base} />
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

        {/* The Threshold, carved across the char and passing behind the fill. Static: it does not
            move with units, so it costs nothing per tick. */}
        <Rect
          x={0}
          y={thresholdY}
          width={width}
          height={art.thresholdThickness}
          fill={crossed ? palette.flame : palette.stoneLit}
        />
        <Rect
          x={0}
          y={thresholdY + art.thresholdThickness}
          width={width}
          height={art.thresholdThickness}
          fill={crossed ? palette.flameDeep : palette.bevelShadow}
        />

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

        {/* The glow, riding above the frontier and clipped inside the aperture so it never
            escapes into the stone field. Item 2 animates translateY. */}
        <Rect
          x={0}
          y={0}
          width={width}
          height={art.frontierGlowHeight}
          fill={`url(#${glowId})`}
          translateY={frontierY - art.frontierGlowHeight}
          opacity={consecrated && !dormant ? 1 : 0}
        />

        {/* The aperture's carved lip, per §3.3, inverted because an opening is cut inward: the
            dark edge at the head and the light edge at the foot. */}
        <Rect x={0} y={0} width={width} height={art.apertureEdge} fill={palette.bevelShadow} />
        <Rect x={0} y={height - art.apertureEdge} width={width} height={art.apertureEdge} fill={palette.stoneLit} />

        {/* The frontier, drawn after the lip so a capped lane keeps it, and outside the scaled
            group so it holds its 2px whatever the fill does. */}
        <Rect
          x={0}
          y={0}
          width={width}
          height={art.frontierThickness}
          fill={frontierColour}
          translateY={frontierY}
          opacity={consecrated ? 1 : 0}
        />
      </G>
    </Svg>
  )
}

import { useId } from 'react'
import Svg, { ClipPath, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg'

import { tokens } from '../design/tokens'

// §6.2. A recessed aperture cut into the void, with a convex arc for a surface. Built so that
// item 2 can animate it by changing nothing but transform and opacity props:
//
//   - The fill is a <rect> at full conduit height inside a clip path, scaled about its bottom
//     edge. Never animate height or y.
//   - Its gradient uses objectBoundingBox units, so the gradient squashes with the rect and the
//     top of the fill is always bright, whatever the units. flameDeep holds most of the column.
//   - The surface is a separate cap shape whose top edge is the arc. It rides the frontier by
//     translateY, so scaling the fill can never squash it. The cap is solid `body`, which is
//     exactly what the fill's gradient reaches at its own top, so the two never seam.
//   - The frontier is the same arc, stroked, and its glow is that arc stroked wider and fainter.
//     No <Filter>, no blur: Android re-rasterises filters and the Offering stage holds 60fps.
//
// The Threshold is drawn here, on the unfilled char and *under* the fill, so the mark stops at
// the conduit walls and never spans the gaps between them.

type ConduitProps = {
  units: number
  capacity: number
  dormant: boolean
  width: number
  height: number
  /** winTarget / laneCount / laneCapacity — where the Threshold crosses this aperture. */
  thresholdFraction: number
  crossed: boolean
}

/**
 * Where the surface and its token sit, for a given fill. Exported so the riding token and the
 * aperture cannot drift apart: both read their vertical position from this one function.
 *
 * The two get *separate* clamps on purpose. The surface is clamped only by the carved lip, so a
 * capped lane still shows its frontier meeting the top per §6.2. The token is clamped by its own
 * radius, so it stays wholly inside the aperture at capacity and rests on the base at 0 units.
 * They therefore ride together everywhere except the last few pixels at each end.
 */
export function conduitGeometry(units: number, capacity: number, height: number, tokenDiameter: number) {
  const { art } = tokens
  const fraction = Math.max(0, Math.min(1, capacity > 0 ? units / capacity : 0))
  const fillTop = height - fraction * height

  // The arc's chord — its two ends, level with the top of the fill at the conduit walls.
  const chordY = Math.max(art.surfaceArcHeight + art.apertureEdge, Math.min(height - art.apertureEdge, fillTop))
  // The arc's highest point. In the cap's own space the apex is at y=0 and the chord at
  // y=surfaceArcHeight, so this is also the cap group's translateY.
  const apexY = chordY - art.surfaceArcHeight

  const radius = tokenDiameter / 2
  const tokenCentreY = Math.max(radius + art.apertureEdge, Math.min(height - radius - art.apertureEdge, apexY))

  return {
    fraction,
    consecrated: units > 0,
    // react-native-svg reads scaleY={0} as falsy and falls back to 1, which draws an empty
    // conduit completely full. Floor the scale and gate the fill's opacity.
    fillScale: Math.max(art.fillScaleFloor, fraction),
    surfaceTranslateY: apexY,
    tokenCentreY,
  }
}

export function Conduit({ units, capacity, dormant, width, height, thresholdFraction, crossed }: ConduitProps) {
  // Unique per instance: duplicate ids across Svg elements render wrong on Android.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const fillId = `fill${uid}`
  const clipId = `clip${uid}`

  const { art, palette, cold } = tokens

  const geometry = conduitGeometry(units, capacity, height, art.tokenDisc)
  const { consecrated, fillScale, surfaceTranslateY } = geometry
  const thresholdY = height * (1 - thresholdFraction)

  // §6.2: a dormant lane keeps its fill but desaturates and darkens, and its frontier goes flat.
  const base = dormant ? cold.flameDeep : palette.flameDeep
  const body = dormant ? cold.flame : palette.flame
  const unfilled = dormant ? cold.char : palette.char
  const frontierColour = dormant ? palette.boneFaint : palette.flameCold

  // The arc, in the cap's own space: apex at y=0, ends at y=surfaceArcHeight. A quadratic whose
  // control point sits at -surfaceArcHeight puts the apex exactly on y=0, so the shape's
  // vertical extent is exactly the arc height and the clamps above can rely on it.
  const arc = `M 0 ${art.surfaceArcHeight} Q ${width / 2} ${-art.surfaceArcHeight} ${width} ${art.surfaceArcHeight}`
  const cap = `${arc} L ${width} ${art.surfaceArcHeight + art.surfaceCapOverlap} L 0 ${art.surfaceArcHeight + art.surfaceCapOverlap} Z`

  const grainOffsets: number[] = []
  for (let x = art.conduitGrainPitch; x < width; x += art.conduitGrainPitch) {
    grainOffsets.push(x)
  }

  return (
    <Svg width={width} height={height}>
      <Defs>
        {/* §6.2's two-stop gradient, with flameDeep holding the lower seven-eighths so the ramp
            to flame crowns the surface rather than lighting the whole column. Item 1c judged
            this against a darker base and a translucent body on the phone and kept it. */}
        <LinearGradient id={fillId} x1="0" y1="1" x2="0" y2="0" gradientUnits="objectBoundingBox">
          <Stop offset="0" stopColor={base} />
          <Stop offset={String(art.fillDeepHoldOffset)} stopColor={base} />
          <Stop offset="1" stopColor={body} />
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

        {/* The Threshold mark, carved across this conduit and passing behind the fill. Static:
            it does not move with units, so it costs nothing per tick. */}
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

        {/* The aperture's carved lip, per §3.3, inverted because an opening is cut inward: the
            dark edge at the head and the light edge at the foot. Drawn before the surface so a
            capped lane keeps its frontier instead of having it overdrawn. */}
        <Rect x={0} y={0} width={width} height={art.apertureEdge} fill={palette.bevelShadow} />
        <Rect x={0} y={height - art.apertureEdge} width={width} height={art.apertureEdge} fill={palette.stoneLit} />

        {/* The surface. One group, one translateY: the glow, the cap and the frontier all ride
            together, so item 2 animates a single transform for the whole thing. */}
        <G translateY={surfaceTranslateY} opacity={consecrated ? 1 : 0}>
          {/* The glow, stroked copies of the arc under everything else, so only the part that
              spills above the surface shows. Hidden on a cold lane: a dead conduit does not
              glow. Clipped by the aperture, so at capacity it simply runs out of room. */}
          {dormant
            ? null
            : art.frontierGlowLayers.map((layer) => (
                <Path
                  key={layer.widthScale}
                  d={arc}
                  fill="none"
                  stroke={palette.flameCold}
                  strokeWidth={art.frontierGlowHeight * layer.widthScale}
                  strokeOpacity={art.frontierGlowOpacity * layer.opacityScale}
                  strokeLinecap="butt"
                />
              ))}

          {/* The cap: the bulge above the fill's top, closing the arc onto the fill beneath. */}
          <Path d={cap} fill={body} />

          {/* The frontier, following the arc. Outside the scaled fill, so it holds its 2px
              whatever the fill does. */}
          <Path d={arc} fill="none" stroke={frontierColour} strokeWidth={art.frontierThickness} strokeLinecap="butt" />
        </G>

        {/* §6.4's crossing: the marks ignite across all four conduits. The carved marks above are
            drawn *under* the fill, which is right while the Threshold is only a mark — but at the
            moment of crossing most lanes are at or past 60%, so those marks sit behind their own
            fill and the ignition is invisible on exactly the lanes that earned it. Drawn again on
            top, once, when crossed. §3.1 permits flame here; this is one of its uses. */}
        {crossed ? (
          <>
            <Rect x={0} y={thresholdY} width={width} height={art.thresholdThickness} fill={palette.flameCold} />
            <Rect
              x={0}
              y={thresholdY + art.thresholdThickness}
              width={width}
              height={art.thresholdThickness}
              fill={palette.flame}
            />
          </>
        ) : null}
      </G>
    </Svg>
  )
}

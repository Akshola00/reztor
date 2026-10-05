import { useId } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg'

import { tokens, type Palette } from '../design/tokens'

// §6.2. A recessed aperture cut into the void, with a convex arc for a surface.
//
// **Nothing here animates a react-native-svg prop.** 15.15.4 marks `scaleY`/`originY` deprecated
// and ships nothing Reanimated-aware, so the moving parts are native views and the SVG inside
// them is static. The aperture is a plain `View` with `overflow: hidden` — it does the clipping
// the old `<ClipPath>` did — holding five layers, painted in this order:
//
//   1. Base, static Svg: unfilled char, its vertical grain, and the carved Threshold mark.
//   2. Fill, Animated.View: the gradient at full aperture height, scaled by `scaleY` about its
//      bottom edge. The gradient is in objectBoundingBox units, so it squashes with the layer
//      and the top of the fill is bright at any level. flameDeep holds most of the column.
//   3. Lip, static Svg: the aperture's carved edge. Above the fill, not below it — at capacity
//      the fill covers the full height and the rim still has to read as the rim. Below the
//      surface, so a capped lane keeps its frontier instead of having it overdrawn.
//   4. Surface, Animated.View: the cap, the frontier and its glow, moved by `translateY`. One
//      layer, so the three can never drift apart, and scaling the fill can never squash them.
//   5. Crossed Threshold marks, static Svg over the fill — see §6.4 below.
//
// **The static layers stay SVG rather than becoming plain Views**, even though layers 3 and 5 are
// nothing but rectangles. A 1pt line is 3.5 device pixels on this phone; Yoga rounds a View up to
// 4 while the SVG rasteriser blends the half pixel. Measured against item 1's judged frames, the
// View spelling left the lip's and the Threshold's lower boundary row solid where the judged frame
// had it antialiased — same position, harder edge. Carved 1pt edges are §3.3's whole vocabulary,
// so they are drawn by the rasteriser that drew them when they were judged.
//
// The frontier's glow is the same arc stroked wider and fainter. No <Filter>, no blur: Android
// re-rasterises filters and the Offering stage holds 60fps.
//
// The uncrossed Threshold is drawn in the base layer, *under* the fill, so the mark stops at the
// conduit walls and never spans the gaps between them.

type ConduitProps = {
  /**
   * The lane's displayed units. Its writers are the Offering tap handler (instant, own lane only)
   * and reconciliation (a lerp, every lane) — never this component. The fill and the surface both
   * derive from it on the UI thread, through `conduitGeometry`.
   */
  units: SharedValue<number>
  capacity: number
  dormant: boolean
  width: number
  height: number
  /** winTarget / laneCount / laneCapacity — where the Threshold crosses this aperture. */
  thresholdFraction: number
  crossed: boolean
  /** The home screen's palette candidates. The match never passes one. */
  palette?: Palette
}

// Pulled out of `tokens` so the worklet below captures three numbers rather than the whole module.
const { surfaceArcHeight, apertureEdge, fillScaleFloor } = tokens.art

/**
 * Where the surface and its token sit, for a given fill. Exported so the riding token and the
 * aperture cannot drift apart: both read their vertical position from this one function.
 *
 * The two get *separate* clamps on purpose. The surface is clamped only by the carved lip, so a
 * capped lane still shows its frontier meeting the top per §6.2. The token is clamped by its own
 * radius, so it stays wholly inside the aperture at capacity and rests on the base at 0 units.
 * They therefore ride together everywhere except the last few pixels at each end.
 *
 * A worklet: the fill, the surface and the riding token all call it inside `useAnimatedStyle`,
 * so it stays the single source for every moving Y value on the UI thread.
 */
export function conduitGeometry(units: number, capacity: number, height: number, tokenDiameter: number) {
  'worklet'
  const fraction = Math.max(0, Math.min(1, capacity > 0 ? units / capacity : 0))
  const fillTop = height - fraction * height

  // The arc's chord — its two ends, level with the top of the fill at the conduit walls.
  const chordY = Math.max(surfaceArcHeight + apertureEdge, Math.min(height - apertureEdge, fillTop))
  // The arc's highest point, and the surface layer's own translateY.
  const apexY = chordY - surfaceArcHeight

  const radius = tokenDiameter / 2
  const tokenCentreY = Math.max(radius + apertureEdge, Math.min(height - radius - apertureEdge, apexY))

  return {
    fraction,
    consecrated: units > 0,
    // Kept from the SVG implementation, where react-native-svg read `scaleY={0}` as falsy and
    // fell back to 1, drawing an empty conduit completely full. A native view scales to 0
    // honestly, so this is now only belt and braces — but the fill's opacity is still gated on
    // `consecrated`, which is what actually guarantees an empty lane stays empty.
    fillScale: Math.max(fillScaleFloor, fraction),
    surfaceTranslateY: apexY,
    tokenCentreY,
  }
}

// Breathing room above and below the arc inside the surface layer's own Svg, so the widest glow
// stroke is not cut off by that Svg's bounds. Not a chosen value: the widest layer is
// `frontierGlowHeight x 2` centred on the path, which reaches exactly this far either side. The
// aperture still clips whatever spills past it, which is what §6.2's cap behaviour asks for.
const surfacePad = tokens.art.frontierGlowHeight

/**
 * The surface arc in the surface layer's own space: apex at `surfacePad`, ends `surfaceArcHeight`
 * below it. A quadratic whose control point sits an arc height above the apex puts the apex
 * exactly there, so the layer's height and the clamps in `conduitGeometry` can rely on it.
 * Exported so anything laid over a frontier draws exactly the frontier's curve.
 */
export function surfaceArc(width: number) {
  const { art } = tokens
  const arcEnds = surfacePad + art.surfaceArcHeight
  const arc = `M 0 ${arcEnds} Q ${width / 2} ${surfacePad - art.surfaceArcHeight} ${width} ${arcEnds}`
  const capFoot = arcEnds + art.surfaceCapOverlap
  return { arc, capFoot, surfaceHeight: capFoot + surfacePad, surfacePad }
}

export function Conduit({
  units,
  capacity,
  dormant,
  width,
  height,
  thresholdFraction,
  crossed,
  palette = tokens.palette,
}: ConduitProps) {
  // Unique per instance: duplicate ids across Svg elements render wrong on Android.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const fillId = `fill${uid}`

  const { art, cold } = tokens

  const thresholdY = height * (1 - thresholdFraction)

  // Hard rule 3: both moving layers derive from the one `units` shared value on the UI thread.
  // `consecrated` gates opacity here too, so an empty lane stays empty at any scale.
  const tokenDisc = art.tokenDisc
  const fillStyle = useAnimatedStyle(() => {
    const g = conduitGeometry(units.get(), capacity, height, tokenDisc)
    return { opacity: g.consecrated ? 1 : 0, transform: [{ scaleY: g.fillScale }] }
  })
  const surfaceStyle = useAnimatedStyle(() => {
    const g = conduitGeometry(units.get(), capacity, height, tokenDisc)
    return { opacity: g.consecrated ? 1 : 0, transform: [{ translateY: g.surfaceTranslateY - surfacePad }] }
  })

  // §6.2: a dormant lane keeps its fill but desaturates and darkens, and its frontier goes flat.
  const base = dormant ? cold.flameDeep : palette.flameDeep
  const body = dormant ? cold.flame : palette.flame
  const unfilled = dormant ? cold.char : palette.char
  const frontierColour = dormant ? palette.boneFaint : palette.flameCold

  const { arc, capFoot, surfaceHeight } = surfaceArc(width)
  const cap = `${arc} L ${width} ${capFoot} L 0 ${capFoot} Z`

  const grainOffsets: number[] = []
  for (let x = art.conduitGrainPitch; x < width; x += art.conduitGrainPitch) {
    grainOffsets.push(x)
  }

  return (
    <View style={[styles.aperture, { width, height }]}>
      {/* 1. Unfilled stone, not a hole, and the carved Threshold across it. Both static: neither
             moves with units, so they cost nothing per tick. */}
      <Svg width={width} height={height}>
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
      </Svg>

      {/* 2. The fill. §6.2's two-stop gradient, with flameDeep holding the lower seven-eighths so
             the ramp to flame crowns the surface rather than lighting the whole column. Item 1c
             judged this against a darker base and a translucent body on the phone and kept it. */}
      <Animated.View style={[styles.layer, styles.fill, { width, height }, fillStyle]}>
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id={fillId} x1="0" y1="1" x2="0" y2="0" gradientUnits="objectBoundingBox">
              <Stop offset="0" stopColor={base} />
              <Stop offset={String(art.fillDeepHoldOffset)} stopColor={base} />
              <Stop offset="1" stopColor={body} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={height} fill={`url(#${fillId})`} />
        </Svg>
      </Animated.View>

      {/* 3. The aperture's carved lip, per §3.3, inverted because an opening is cut inward: the
             dark edge at the head and the light edge at the foot. */}
      <Svg style={styles.layer} width={width} height={height}>
        <Rect x={0} y={0} width={width} height={art.apertureEdge} fill={palette.bevelShadow} />
        <Rect x={0} y={height - art.apertureEdge} width={width} height={art.apertureEdge} fill={palette.stoneLit} />
      </Svg>

      {/* 4. The surface. One layer, one translateY: the glow, the cap and the frontier all ride
             together, so a change in units moves a single transform for the whole thing. */}
      <Animated.View style={[styles.layer, surfaceStyle]}>
        <Svg width={width} height={surfaceHeight}>
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

          {/* The cap: the bulge above the fill's top, closing the arc onto the fill beneath. It
              is solid `body`, which is exactly what the fill's gradient reaches at its own top,
              so the two never seam. */}
          <Path d={cap} fill={body} />

          {/* The frontier, following the arc. Outside the scaled fill, so it holds its 2px
              whatever the fill does. */}
          <Path d={arc} fill="none" stroke={frontierColour} strokeWidth={art.frontierThickness} strokeLinecap="butt" />
        </Svg>
      </Animated.View>

      {/* 5. §6.4's crossing: the marks ignite across all four conduits. The carved marks in the
             base layer are drawn *under* the fill, which is right while the Threshold is only a
             mark — but at the moment of crossing most lanes are at or past 60%, so those marks
             sit behind their own fill and the ignition is invisible on exactly the lanes that
             earned it. Drawn again on top, once, when crossed. §3.1 permits flame here. */}
      {crossed ? (
        <Svg style={styles.layer} width={width} height={height}>
          <Rect x={0} y={thresholdY} width={width} height={art.thresholdThickness} fill={palette.flameCold} />
          <Rect
            x={0}
            y={thresholdY + art.thresholdThickness}
            width={width}
            height={art.thresholdThickness}
            fill={palette.flame}
          />
        </Svg>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  // Replaces the old <ClipPath>: every layer above is absolutely positioned and this is what
  // keeps the glow, the cap and the fill inside the aperture's walls.
  aperture: {
    overflow: 'hidden',
  },
  layer: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  // §6.2: the fill is anchored at the bottom and grows upward. RN 0.86 takes the CSS keyword
  // form, and Reanimated 4 carries it through its own style processor.
  fill: {
    transformOrigin: 'bottom',
  },
})

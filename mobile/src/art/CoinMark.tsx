import Svg, { Circle, G, Path } from 'react-native-svg'

import { tokens } from '../design/tokens'
import { SKR_PATH } from './SkrMark'

// The faucet's money: struck stone coins, gold-rimmed, the SKR mark on each face. A stack of
// `home.coinStack`, overlapping left to right, front coin last. Gold, because they are SKR (§3.1).

export function CoinMark({ colour }: { colour: string }) {
  const { coinSize, coinStack, coinOffset, coinInnerRing, coinMarkShare } = tokens.home
  const stroke = tokens.art.sigilStroke
  const r = coinSize / 2 - stroke
  const width = coinSize + coinOffset * (coinStack - 1)
  // The SKR mark is drawn in a sigilBox square; scale it to its share of the face, centred.
  const mark = coinSize * coinMarkShare
  const scale = mark / tokens.art.sigilBox
  const inset = (coinSize - mark) / 2

  return (
    <Svg width={width} height={coinSize}>
      {Array.from({ length: coinStack }, (_, i) => {
        const x = i * coinOffset
        return (
          <G key={i} x={x}>
            <Circle
              cx={coinSize / 2}
              cy={coinSize / 2}
              r={r}
              fill={tokens.palette.stone}
              stroke={colour}
              strokeWidth={stroke}
            />
            <Circle
              cx={coinSize / 2}
              cy={coinSize / 2}
              r={r * coinInnerRing}
              fill="none"
              stroke={colour}
              strokeWidth={stroke / 2}
            />
            <G x={inset} y={inset} scale={scale}>
              <Path d={SKR_PATH} fill="none" stroke={colour} strokeWidth={stroke} strokeLinejoin="miter" />
            </G>
          </G>
        )
      })}
    </Svg>
  )
}

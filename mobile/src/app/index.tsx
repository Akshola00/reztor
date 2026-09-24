import { Redirect } from 'expo-router'
import { useState } from 'react'

import { session } from '../net/session'
import { Home } from '../screens/Home'

export default function Index() {
  // Where the launch-time rejoin landed, taken once: a rejoined seat skips home entirely.
  const [target] = useState(() => session.takeBootTarget())
  if (target.route === 'match') return <Redirect href="/match" />
  if (target.route === 'lobby') return <Redirect href={{ pathname: '/lobby/[code]', params: { code: target.code } }} />
  return <Home initialNotice={target.route === 'home' && target.ended === true ? 'ended' : undefined} />
}

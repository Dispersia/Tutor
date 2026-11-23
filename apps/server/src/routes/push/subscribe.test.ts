import { expect, test } from 'bun:test'
import { isPushServiceEndpoint } from './subscribe'

test('only the browser push services are accepted as endpoints', () => {
  for (const ok of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://web.push.apple.com/QGk',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-by3p.notify.windows.com/w/?token=abc',
  ]) {
    expect(isPushServiceEndpoint(ok)).toBe(true)
  }
  for (const bad of [
    'https://push.example/abc',
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://127.0.0.1:4318/api/health',
    'https://169.254.169.254/latest/meta-data',
    'https://fcm.googleapis.com.evil.test/x',
    'https://evilpush.apple.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://fcm.googleapis.com@internal.host/x',
    'not a url',
  ]) {
    expect(isPushServiceEndpoint(bad)).toBe(false)
  }
})

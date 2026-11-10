// The site's certificate: one that is not accepted, or that runs out soon, takes the site off the air for visitors.
import { connect } from 'node:tls'

/** Lets Encrypt renews about 30 days before the end, so two weeks left means the renewal has failed. */
export const MIN_DAYS_LEFT = 14
const DAY_MS = 86_400_000

/** Whole days from `now` to the certificate's last day, in the form Node gives it (`Feb 10 23:59:59 2027 GMT`); NaN if it is not a date. */
export const daysLeft = (validTo: string, now: Date): number => Math.floor((Date.parse(validTo) - now.getTime()) / DAY_MS)

/** What a connection error says. Some, such as a refused connection to a name with several addresses, carry no message, only a code. */
const reasonOf = (error: Error): string => (error.message !== '' ? error.message : 'code' in error && typeof error.code === 'string' ? error.code : error.name)

/**
 * What is wrong with the certificate `host` presents on port 443, as lines a person can read: it is not accepted
 * (Node checks the chain, the name and the dates), or has fewer than `MIN_DAYS_LEFT` days left. None when all is well.
 */
export function certificateProblems(host: string, now = new Date()): Promise<string[]> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: 443, servername: host, timeout: 15_000 }, () => {
      const days = daysLeft(socket.getPeerCertificate().valid_to, now)
      socket.end()
      if (Number.isNaN(days)) resolve([`the certificate of ${host} has no end date that can be read`])
      else resolve(days < MIN_DAYS_LEFT ? [`the certificate of ${host} ends in ${days} days, fewer than ${MIN_DAYS_LEFT}: its renewal has not worked`] : [])
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve([`${host} did not answer a TLS connection within 15 seconds`])
    })
    socket.once('error', (error) => resolve([`${host} has no certificate we accept: ${reasonOf(error)}`]))
  })
}

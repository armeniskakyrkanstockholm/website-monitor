import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { daysLeft } from '../src/certificate.ts'

describe('days left on a certificate', () => {
  it('counts whole days from now to the end date in the form Node gives it', () => {
    assert.equal(daysLeft('Feb 10 23:59:59 2027 GMT', new Date('2027-01-27T23:59:59Z')), 14)
    assert.equal(daysLeft('Feb 10 23:59:59 2027 GMT', new Date('2027-01-28T12:00:00Z')), 13)
  })

  it('is negative for a certificate that has ended, and not a number for text that is no date', () => {
    assert.ok(daysLeft('Feb 10 23:59:59 2027 GMT', new Date('2027-03-01T00:00:00Z')) < 0)
    assert.ok(Number.isNaN(daysLeft('not a date', new Date())))
  })
})

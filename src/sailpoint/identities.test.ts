import type { IdentitiesApi } from 'sailpoint-api-client/identities/api'
import type { SearchApi } from 'sailpoint-api-client/search/api'
import { describe, expect, it, vi } from 'vitest'
import { FriendlyError } from './certifications'
import { buildIdentityQuery, fetchIdentityDetail, searchIdentities } from './identities'

/** Builds a fake SearchApi with only searchPostV1 under test. */
function fakeApi(searchPostV1: SearchApi['searchPostV1']): SearchApi {
  return { searchPostV1 } as unknown as SearchApi
}

describe('buildIdentityQuery', () => {
  it('requires every term across name and email fields', () => {
    const query = buildIdentityQuery('jane doe')
    // Each term is wrapped in its own OR group and the groups are AND-ed.
    expect(query).toContain(' AND ')
    expect(query).toContain('firstName:*jane*')
    expect(query).toContain('email:*doe*')
    expect(query).toContain('attributes.email:*jane*')
  })

  it('escapes query operators so they are matched literally', () => {
    expect(buildIdentityQuery('a+b')).toContain('*a\\+b*')
  })
})

describe('searchIdentities', () => {
  it('returns [] for blank or too-short input without calling the API', async () => {
    const searchPostV1 = vi.fn()
    const api = fakeApi(searchPostV1)

    expect(await searchIdentities(api, '')).toEqual([])
    expect(await searchIdentities(api, '  ')).toEqual([])
    expect(await searchIdentities(api, 'a')).toEqual([])
    expect(searchPostV1).not.toHaveBeenCalled()
  })

  it('maps rows to {id, displayName, email} and drops id-less rows', async () => {
    const searchPostV1 = vi.fn().mockResolvedValue({
      data: [
        { id: 'i1', displayName: 'Jane Doe', email: 'jane@example.com' },
        // No top-level fields, only attributes.
        { id: 'i2', attributes: { name: 'Al Roe', emailAddress: 'al@example.com' } },
        // No id: must be dropped.
        { displayName: 'Ghost', email: 'ghost@example.com' },
      ],
    })
    const api = fakeApi(searchPostV1)

    const results = await searchIdentities(api, 'jane')

    expect(searchPostV1).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ indices: ['identities'] }),
        limit: 25,
        count: false,
      }),
    )
    expect(results).toEqual([
      { id: 'i1', displayName: 'Jane Doe', email: 'jane@example.com' },
      { id: 'i2', displayName: 'Al Roe', email: 'al@example.com' },
    ])
  })

  it('wraps API errors in a FriendlyError', async () => {
    const api = fakeApi(vi.fn().mockRejectedValue({ response: { status: 500 } }))
    await expect(searchIdentities(api, 'jane')).rejects.toBeInstanceOf(FriendlyError)
  })
})

describe('fetchIdentityDetail attributes', () => {
  it('keeps every non-empty attribute and drops blanks', async () => {
    const getIdentityV1 = vi.fn().mockResolvedValue({
      data: {
        id: 'u1',
        emailAddress: 'neville.kaufman@sailpointdemo.com',
        attributes: {
          city: '',
          country: '  ',
          location: null,
          department: 'Sales',
          displayName: 'Neville.Kaufman',
          employeeNumber: 900,
          endDate: '2199-01-01T00:00:00.000Z',
          firstName: 'Neville',
          lastName: 'Kaufman',
          jobTitle: 'Sales Manager',
          types: ['Employee'],
          workPhone: '',
          googleEmail: 'neville.kaufman@example.com',
          IBMIUSERNAME: 'NKAUFMAN',
          alternatePhoneNumber: [],
          startDate: '2199-01-01T00:00:00.000Z',
          username: 'Neville.Kaufman',
        },
      },
    })
    const api = { getIdentityV1 } as unknown as IdentitiesApi
    const identity = await fetchIdentityDetail(api, 'u1')

    expect(identity.attributes).toEqual([
      ['department', 'Sales'],
      ['displayName', 'Neville.Kaufman'],
      ['employeeNumber', '900'],
      ['endDate', '2199-01-01T00:00:00.000Z'],
      ['firstName', 'Neville'],
      ['googleEmail', 'neville.kaufman@example.com'],
      ['IBMIUSERNAME', 'NKAUFMAN'],
      ['jobTitle', 'Sales Manager'],
      ['lastName', 'Kaufman'],
      ['startDate', '2199-01-01T00:00:00.000Z'],
      ['types', 'Employee'],
      ['username', 'Neville.Kaufman'],
    ])
    expect(identity.department).toBe('Sales')
    expect(identity.title).toBe('Sales Manager')
  })
})

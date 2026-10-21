// TEMPORARY real-browser harness (never committed). ?fixture=standard|dense
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import '../graph/tokens.css'
import '../index.css'
import { AccessGraphCanvas } from '../graph/AccessGraphCanvas'
import { buildFixtureGraph, statusGraph } from './reviewStatusFixture'
import type { StatusRow } from './reviewStatusFixture'
import type { AccessGraphData, AccessReviewStatus } from '../sailpoint/types'

const STATUSES: AccessReviewStatus[] = ['needsReview', 'approved', 'revoked', 'reassigned']

function row(o: Partial<StatusRow>): StatusRow {
  return {
    id: 'r',
    userId: 'u1',
    user: 'Amos Cunningham',
    role: '',
    roleId: null,
    accessProfile: '',
    accessProfileId: null,
    entitlement: '',
    entitlementId: null,
    source: '',
    sourceId: null,
    unresolved: false,
    ...o,
  }
}

function dense(): AccessGraphData {
  const rows: StatusRow[] = []
  let n = 0
  const id = () => `r${++n}`
  const src = (i: number) => ({ source: `Source ${(i % 3) + 1}`, sourceId: `s${(i % 3) + 1}` })
  // 4 first-level access profiles with nested entitlements.
  for (let p = 1; p <= 4; p++) {
    for (let e = 1; e <= 2; e++) {
      rows.push(
        row({
          id: id(),
          accessProfile: `Profile ${p}`,
          accessProfileId: `ap-${p}`,
          entitlement: `AP${p} Ent ${e}`,
          entitlementId: `ap${p}-e${e}`,
          ...src(p + e),
          ...(e === 1
            ? {
                reviewStatus: STATUSES[p % 4],
                accessItemKind: 'accessProfile' as const,
                accessItemId: `ap-${p}`,
                accessItemName: `Profile ${p}`,
              }
            : {}),
        }),
      )
    }
  }
  // 1 first-level role with a nested AP and a direct entitlement.
  rows.push(
    row({
      id: id(), role: 'Finance Role', roleId: 'role-fin',
      accessProfile: 'Finance AP', accessProfileId: 'ap-fin',
      entitlement: 'Fin Ent 1', entitlementId: 'fin-e1', ...src(1),
      reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'role-fin', accessItemName: 'Finance Role',
    }),
    row({
      id: id(), role: 'Finance Role', roleId: 'role-fin',
      entitlement: 'Fin Ent 2', entitlementId: 'fin-e2', ...src(2),
    }),
  )
  // 20 directly held entitlements across all four statuses.
  for (let i = 1; i <= 20; i++) {
    const nn = String(i).padStart(2, '0')
    rows.push(
      row({
        id: id(), entitlement: `Entitlement ${nn}`, entitlementId: `ent-${nn}`, ...src(i),
        reviewStatus: STATUSES[i % 4], accessItemKind: 'entitlement', accessItemId: `ent-${nn}`, accessItemName: `Entitlement ${nn}`,
      }),
    )
  }
  return statusGraph(rows)
}

/** One entitlement is BOTH first-level and nested under a held access profile. */
function both(): AccessGraphData {
  const base = { userId: 'u1', user: 'Beth Both' }
  return statusGraph([
    row({ ...base, id: 'b1', accessProfile: 'Foo AP', accessProfileId: 'ap-foo', entitlement: 'Read', entitlementId: 'e-read', source: 'ERP', sourceId: 's-erp', reviewStatus: 'reassigned', accessItemKind: 'accessProfile', accessItemId: 'ap-foo', accessItemName: 'Foo AP' }),
    row({ ...base, id: 'b2', accessProfile: 'Foo AP', accessProfileId: 'ap-foo', entitlement: 'Write', entitlementId: 'e-write', source: 'ERP', sourceId: 's-erp' }),
    row({ ...base, id: 'b3', entitlement: 'Read', entitlementId: 'e-read', source: 'ERP', sourceId: 's-erp', reviewStatus: 'approved', accessItemKind: 'entitlement', accessItemId: 'e-read', accessItemName: 'Read' }),
  ])
}
async function main() {
  const fixture = new URLSearchParams(location.search).get('fixture') ?? 'standard'
  const graph = fixture === 'dense' ? dense() : fixture === 'both' ? both() : await buildFixtureGraph()
  createRoot(document.getElementById('root')!).render(
    <div style={{ padding: 16 }}>
      <AccessGraphCanvas graph={graph} />
    </div>,
  )
}
void main()

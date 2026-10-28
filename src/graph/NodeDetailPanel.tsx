/**
 * The right-side fly-out detail panel for the access graph.
 *
 * Unlike the hover tooltip (which is transient and anchored to a card), this is
 * a persistent side panel that shows the full detail of whichever node the
 * reviewer last activated — ANY kind (user, role, access profile, entitlement,
 * attribute, source), including reference-only nodes. It is toggled from the
 * control panel's "detail" button and closes with its own close control or when
 * the toggle is turned off.
 *
 * It reads only the small `AccessSceneNodeData` the scene already carries (kind,
 * label, detail, review status, reference flag, and — for a user — completion);
 * the surrounding canvas owns which node is shown. With no node selected it
 * invites the reviewer to pick one rather than rendering empty, so the panel
 * always explains itself.
 *
 * Styling matches the legend panel (`.vc-graph-legend`) — a bordered, shadowed
 * card using the graph tokens — mounted inside a React Flow `top-right` panel.
 */
import type { AccessGraphNodeKind, AccessSceneNodeData } from '../sailpoint/types'
import { StatusIcon } from './AccessNode'
import { KindIcon } from './kindIcons'
import './NodeDetailPanel.css'

/** Human-readable caption per layer (mirrors AccessNode's KIND_LABEL). */
const KIND_LABEL: Record<AccessGraphNodeKind, string> = {
  user: 'User',
  role: 'Role',
  accessProfile: 'Access profile',
  entitlement: 'Entitlement',
  attribute: 'Attribute',
  source: 'Source',
}

/**
 * Letters and digits only, lowercased. "FIRST NAME", "firstName", and
 * "first_name" all become "firstname", so spelling variants compare equal.
 */
function compactKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Attribute names that mean one of the fields the panel already labels.
 * Compact form → the curated field's compact name. "jobTitle" and "TITLE"
 * are both a title; "givenName" is a first name.
 */
const ATTRIBUTE_ALIASES: Record<string, string> = {
  givenname: 'firstname',
  familyname: 'lastname',
  surname: 'lastname',
  jobtitle: 'title',
  emailaddress: 'email',
  workphone: 'phone',
  telephone: 'phone',
  telephonenumber: 'phone',
  phonenumber: 'phone',
  mobilephone: 'phone',
  mobile: 'phone',
  departmentname: 'department',
  dept: 'department',
  city: 'location',
  region: 'location',
  locality: 'location',
  worklocation: 'location',
  countryname: 'country',
  countrycode: 'country',
  identitystatus: 'identitystate',
}

/** The curated user-row label for each field that attributes must not repeat. */
const CURATED_FIELD_KEY: Record<string, string> = {
  'First name': 'firstname',
  'Last name': 'lastname',
  Title: 'title',
  Email: 'email',
  Phone: 'phone',
  Department: 'department',
  Location: 'location',
  Country: 'country',
  Manager: 'manager',
  'Is manager': 'ismanager',
  'Lifecycle state': 'lifecyclestate',
  'Identity state': 'identitystate',
  'Identity ID': 'identityid',
}

/** One comparable name for an attribute key, after alias folding. */
function canonicalKey(key: string): string {
  const compact = compactKey(key)
  return ATTRIBUTE_ALIASES[compact] ?? compact
}

/**
 * Prefer a camelCase key over a spaced one, and a spaced one over a single
 * all-caps token, so the surviving duplicate has the clearest label.
 */
function preferAttributeKey(candidate: string, current: string): boolean {
  const score = (key: string) =>
    (/[a-z]/.test(key) && /[A-Z]/.test(key) ? 2 : 0) + (/[\s_-]/.test(key) ? 1 : 0)
  return score(candidate) > score(current)
}

/**
 * A readable label for a raw identity-attribute key. camelCase, spaced, and
 * snake/kebab keys become words ("employeeNumber" → "Employee number",
 * "START DATE" → "Start date"). A single all-caps token has no word boundary
 * (IBMIUSERNAME) and is shown as stored.
 */
function attributeLabel(key: string): string {
  const hasBoundary = /[\s_-]/.test(key) || (/[a-z]/.test(key) && /[A-Z]/.test(key))
  if (!hasBoundary && !/[a-z]/.test(key)) return key
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
  if (!words) return key
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

/**
 * One row per fact. Attributes that repeat a curated field (first name, last
 * name, title / job title, and the same field under a different spelling)
 * are dropped. When the curated row is blank, the attribute's value fills it
 * so the fact still appears once. Remaining attributes collapse too:
 * "EMPLOYEE NUMBER" and "employeeNumber" become a single row.
 */
function dedupeUserDetail(
  rows: Array<[string, string, boolean]>,
  attributes: Array<[string, string]>,
): { rows: Array<[string, string, boolean]>; attributes: Array<[string, string]> } {
  const byCanonical = new Map<string, [string, string]>()
  for (const [key, value] of attributes) {
    if (!value.trim()) continue
    const canonical = canonicalKey(key)
    const existing = byCanonical.get(canonical)
    if (!existing || preferAttributeKey(key, existing[0])) {
      byCanonical.set(canonical, [key, value])
    }
  }

  const used = new Set<string>()
  const nextRows = rows.map(([label, value, always]): [string, string, boolean] => {
    const canonical = CURATED_FIELD_KEY[label]
    if (!canonical) return [label, value, always]
    const match = byCanonical.get(canonical)
    if (!match) return [label, value, always]
    used.add(canonical)
    return [label, value.trim() ? value : match[1], always]
  })

  const nextAttributes = [...byCanonical.entries()]
    .filter(([canonical]) => !used.has(canonical))
    .map(([, pair]) => pair)

  return { rows: nextRows, attributes: nextAttributes }
}

/** Review-status caption (mirrors AccessNode's STATUS_ICON_LABEL). */
const STATUS_LABEL: Record<NonNullable<AccessSceneNodeData['reviewStatus']>, string> = {
  needsReview: 'Needs review',
  approved: 'Approved',
  revoked: 'Revoked',
  reassigned: 'Reassigned',
}

interface NodeDetailPanelProps {
  /**
   * The data of the node to describe, or `null` when nothing is selected (the
   * panel then shows a short "pick a node" prompt). Carries the same payload the
   * card and tooltip read.
   */
  node: AccessSceneNodeData | null
  /** Hides the panel (turns the control-panel toggle off). */
  onClose: () => void
}

/**
 * A fly-out card describing one access-graph node. Field set adapts to the kind:
 * a user shows department/location; every other kind shows a description. A
 * reviewed first-level item adds its review status; a reference-only node is
 * flagged as context (not reviewed).
 */
export function NodeDetailPanel({ node, onClose }: NodeDetailPanelProps) {
  const kindLabel = node ? KIND_LABEL[node.kind] : ''
  const description = node?.detail?.description ?? ''
  const status = node?.reviewStatus
  const isUser = node?.kind === 'user'
  const isEntitlement = node?.kind === 'entitlement'
  // "Access items" — the three reviewable kinds. Their review status moves up
  // directly under the name (icon + status-colored text), with a rule below it
  // separating the status from the attributes.
  const isAccessItem =
    node?.kind === 'role' ||
    node?.kind === 'accessProfile' ||
    node?.kind === 'entitlement'
  // The user field set, in a fixed order that mirrors the org-graph detail
  // panel. A field renders only when it has a value, so a sparse identity never
  // shows a wall of "not set" lines; Department / Location always render (they
  // anchor the panel even when blank).
  const d = node?.detail ?? {}
  const userRows: Array<[string, string, boolean]> = [
    ['First name', d.firstName ?? '', false],
    ['Last name', d.lastName ?? '', false],
    ['Title', d.title ?? '', false],
    ['Email', d.email ?? '', false],
    ['Phone', d.phone ?? '', false],
    ['Department', d.department ?? '', true],
    ['Location', d.location ?? '', true],
    ['Country', d.country ?? '', false],
    ['Manager', d.manager ?? '', false],
    ['Is manager', d.isManager ?? '', false],
    ['Lifecycle state', d.lifecycleState ?? '', false],
    ['Identity state', d.identityState ?? '', false],
    ['Identity ID', d.identityId ?? '', false],
  ]
  // Named rows and the attribute list overlap (First name and firstName,
  // Title and jobTitle, FIRST NAME and FIRSTNAME). Collapse those to one row.
  const deduped = dedupeUserDetail(userRows, d.attributes ?? [])
  // Keep a field when it has a value or is one of the always-shown anchors
  // (Department / Location anchor the user panel even when blank).
  const visibleUserRows = deduped.rows.filter(([, value, always]) => always || value)
  const userAttributes = deduped.attributes

  // The primary field set for an access-item node (role, access profile,
  // entitlement), in a fixed per-kind order mirroring the ISC detail panels. A
  // row renders only when it has a value (every attribute is optional on
  // NodeDetail), so a sparse item shows only what it actually carries. The
  // generic kinds (user, source) do not use this list.
  const e = node?.detail ?? {}
  const entitlementRows: Array<[string, string]> = [
    ['Source', e.source ?? ''],
    ['Description', e.description ?? ''],
    ['Value', e.value ?? ''],
    ['Attribute', e.attribute ?? ''],
    ['Cloud enabled', e.cloudGoverned ?? ''],
    ['Object type', e.objectType ?? ''],
    ['Privileged', e.privileged ?? ''],
    ['Requestable', e.requestable ?? ''],
    ['Owner', e.owner ?? ''],
    ['Tags', e.tags ?? ''],
    ['Created', e.created ?? ''],
    ['Modified', e.modified ?? ''],
    ['Entitlement ID', e.entitlementId ?? ''],
  ]
  const roleRows: Array<[string, string]> = [
    ['Description', e.description ?? ''],
    ['Owner', e.owner ?? ''],
    ['Enabled', e.enabled ?? ''],
    ['Requestable', e.requestable ?? ''],
    ['Privilege level', e.privilegeLevel ?? ''],
    ['Dimensional', e.dimensional ?? ''],
    ['Created', e.created ?? ''],
    ['Modified', e.modified ?? ''],
    ['Role ID', e.roleId ?? ''],
  ]
  const accessProfileRows: Array<[string, string]> = [
    ['Source', e.source ?? ''],
    ['Description', e.description ?? ''],
    ['Owner', e.owner ?? ''],
    ['Enabled', e.enabled ?? ''],
    ['Requestable', e.requestable ?? ''],
    ['Created', e.created ?? ''],
    ['Modified', e.modified ?? ''],
    ['Access profile ID', e.accessProfileId ?? ''],
  ]
  const attributeRows: Array<[string, string]> = [
    ['Source', e.source ?? ''],
    ['Source ID', e.sourceId ?? ''],
    ['Entitlements', e.entitlementCount ?? ''],
  ]
  const sourceRows: Array<[string, string]> = [
    ['Description', e.description ?? ''],
    ['Type', e.type ?? ''],
    ['Connector', e.connector ?? ''],
    ['Connection type', e.connectionType ?? ''],
    ['Category', e.category ?? ''],
    ['Owner', e.owner ?? ''],
    ['Cluster', e.cluster ?? ''],
    ['Authoritative', e.authoritative ?? ''],
    ['Healthy', e.healthy ?? ''],
    ['Status', e.status ?? ''],
    ['Created', e.created ?? ''],
    ['Modified', e.modified ?? ''],
    ['Source ID', e.sourceId ?? ''],
  ]
  const primaryRows =
    node?.kind === 'entitlement'
      ? entitlementRows
      : node?.kind === 'role'
        ? roleRows
        : node?.kind === 'accessProfile'
          ? accessProfileRows
          : node?.kind === 'attribute'
            ? attributeRows
            : node?.kind === 'source'
              ? sourceRows
              : []
  const visiblePrimaryRows = primaryRows.filter(([, value]) => value)
  // The free-form source attributes shown under an "Additional attributes"
  // heading, mirroring the ISC panel. Empty when the entitlement carried none.
  const additionalAttributes = e.attributes ?? []

  return (
    <section
      className="vc-graph-detail"
      role="group"
      aria-label="Node details"
    >
      <header className="vc-graph-detail-head">
        <p className="vc-graph-detail-title">Details</p>
        <button
          type="button"
          className="vc-graph-detail-close"
          aria-label="Hide details"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      {node === null ? (
        <p className="vc-graph-detail-empty">
          Select a node to see its details here.
        </p>
      ) : (
        <div className="vc-graph-detail-body">
          {isUser && node.completion ? (
            <>
              <p className="vc-graph-detail-completion">
                {`${node.completion.percent}% completed ( ${node.completion.completed} of ${node.completion.total} )`}
              </p>
              <hr className="vc-graph-detail-sep" />
            </>
          ) : null}
          <div className="vc-graph-detail-kind-row">
            <KindIcon kind={node.kind} className="vc-graph-detail-kind-icon" />
            <span className={`vc-graph-detail-kind kind-${node.kind}`}>
              {kindLabel}
            </span>
          </div>
          <p className="vc-graph-detail-label">{node.label}</p>

          {isAccessItem && status ? (
            <>
              <p
                className={`vc-graph-detail-status vc-graph-detail-status-${status}`}
              >
                <StatusIcon status={status} decorative />
                <span>
                  {STATUS_LABEL[status]}
                  {node.reviewMixed
                    ? ' (mixed: some items still need review)'
                    : ''}
                </span>
              </p>
              <hr className="vc-graph-detail-sep" />
            </>
          ) : null}

          {isUser ? (
            <>
              <dl className="vc-graph-detail-fields">
                {visibleUserRows.map(([label, value]) => (
                  <div key={label} className="vc-graph-detail-row">
                    <dt>{label}</dt>
                    <dd>
                      {value || (
                        <span className="vc-graph-detail-unset">not set</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              {userAttributes.length > 0 ? (
                <>
                  <p className="vc-graph-detail-subhead">Attributes</p>
                  <dl className="vc-graph-detail-fields">
                    {userAttributes.map(([key, value]) => (
                      <div key={key} className="vc-graph-detail-row">
                        <dt>{attributeLabel(key)}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : null}
            </>
          ) : isAccessItem ? (
            <>
              <dl className="vc-graph-detail-fields">
                {visiblePrimaryRows.length > 0 ? (
                  visiblePrimaryRows.map(([label, value]) => (
                    <div key={label} className="vc-graph-detail-row">
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))
                ) : (
                  <div className="vc-graph-detail-row">
                    <dt>Description</dt>
                    <dd>
                      <span className="vc-graph-detail-unset">not set</span>
                    </dd>
                  </div>
                )}
              </dl>
              {isEntitlement && additionalAttributes.length > 0 ? (
                <>
                  <p className="vc-graph-detail-subhead">Additional attributes</p>
                  <dl className="vc-graph-detail-fields">
                    {additionalAttributes.map(([label, value]) => (
                      <div key={label} className="vc-graph-detail-row">
                        <dt>{label}</dt>
                        <dd>
                          {value || (
                            <span className="vc-graph-detail-unset">not set</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : null}
            </>
          ) : (
            // Source or attribute: the visible field set for that kind.
            <dl className="vc-graph-detail-fields">
              {visiblePrimaryRows.length > 0 ? (
                visiblePrimaryRows.map(([label, value]) => (
                  <div key={label} className="vc-graph-detail-row">
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))
              ) : (
                <div className="vc-graph-detail-row">
                  <dt>Description</dt>
                  <dd>
                    {description || (
                      <span className="vc-graph-detail-unset">not set</span>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          )}

          {node.reference ? (
            <p className="vc-graph-detail-note">
              Reference only — shown to explain how access derives, not itself
              reviewed.
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}

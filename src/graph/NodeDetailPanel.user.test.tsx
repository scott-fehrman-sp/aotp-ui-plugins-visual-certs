import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NodeDetailPanel } from './NodeDetailPanel'

describe('NodeDetailPanel user attributes', () => {
  it('shows each fact once when named fields and attribute aliases repeat it', () => {
    render(
      <NodeDetailPanel
        onClose={vi.fn()}
        node={{
          kind: 'user',
          label: 'Neville Kaufman',
          detail: {
            firstName: 'Neville',
            lastName: 'Kaufman',
            title: 'Sales Manager',
            email: 'neville.kaufman@sailpointdemo.com',
            department: 'Sales',
            attributes: [
              ['firstName', 'Neville'],
              ['FIRST NAME', 'Neville'],
              ['FIRSTNAME', 'Neville'],
              ['lastName', 'Kaufman'],
              ['LAST NAME', 'Kaufman'],
              ['jobTitle', 'Sales Manager'],
              ['TITLE', 'Sales Manager'],
              ['email', 'neville.kaufman@sailpointdemo.com'],
              ['emailAddress', 'neville.kaufman@sailpointdemo.com'],
              ['department', 'Sales'],
              ['employeeNumber', '900'],
              ['EMPLOYEE NUMBER', '900'],
              ['displayName', 'Neville.Kaufman'],
            ],
          },
        }}
      />,
    )

    const details = screen.getByRole('group', { name: 'Node details' })
    for (const label of ['First name', 'Last name', 'Title', 'Email', 'Department', 'Employee number']) {
      expect(within(details).getAllByText(label)).toHaveLength(1)
    }
    expect(within(details).getByText('Display name').nextElementSibling).toHaveTextContent(
      'Neville.Kaufman',
    )
    expect(within(details).queryByText('Job title')).not.toBeInTheDocument()
    expect(within(details).queryByText('FIRSTNAME')).not.toBeInTheDocument()
    expect(within(details).queryByText('LAST NAME')).not.toBeInTheDocument()
    expect(within(details).queryByText('EMPLOYEE NUMBER')).not.toBeInTheDocument()
  })

  it('fills a blank named row from the attribute and does not list it again', () => {
    render(
      <NodeDetailPanel
        onClose={vi.fn()}
        node={{
          kind: 'user',
          label: 'Neville Kaufman',
          detail: {
            attributes: [
              ['FIRST NAME', 'Neville'],
              ['jobTitle', 'Sales Manager'],
            ],
          },
        }}
      />,
    )

    const details = screen.getByRole('group', { name: 'Node details' })
    expect(within(details).getByText('First name').nextElementSibling).toHaveTextContent('Neville')
    expect(within(details).getByText('Title').nextElementSibling).toHaveTextContent('Sales Manager')
    expect(within(details).queryByText('Attributes')).not.toBeInTheDocument()
    expect(within(details).queryByText('Job title')).not.toBeInTheDocument()
  })
})

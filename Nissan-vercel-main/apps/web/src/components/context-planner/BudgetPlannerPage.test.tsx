import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Hoisted so the vi.mock factories below can reference them.
const { RESULT, CONTEXTS } = vi.hoisted(() => {
  const CONTEXTS = [{ context_id: 'c1', status: 'ready', company_name: 'ABC Nissan' }]
  const RESULT = {
    context_id: 'c1',
    status: 'ready',
    engine: 'deterministic',
    currency: 'INR',
    recommended_budget: 150000,
    user_budget: 100000,
    budget_summary: {
      currency: 'INR',
      recommended_budget: 150000,
      user_budget: 100000,
      recommended_budget_display: '₹1,50,000',
      user_budget_display: '₹1,00,000',
      optimized_total: 100000,
      optimized_total_display: '₹1,00,000',
      fits_recommended: false,
      explanation: 'Explanation.',
      optimization_note: 'Note.',
    },
    recommended_budget_breakdown: [],
    optimized_budget_breakdown: [],
    // The rows under test: 3 exact (must NOT be badged), 5 illustrative (must be badged).
    comparison_table: [
      { metric: 'Monthly Budget', recommended: '₹1,50,000', optimized: '₹1,00,000' },
      { metric: 'Activities Included', recommended: '9', optimized: '6' },
      { metric: 'Activities Removed', recommended: '0', optimized: '3' },
      { metric: 'Expected Timeline', recommended: '3–6 months', optimized: '5–8 months' },
      { metric: 'Estimated SEO Improvement', recommended: '+32%', optimized: '+19%' },
      { metric: 'Estimated AEO Improvement', recommended: '+28%', optimized: '+17%' },
      { metric: 'Expected Lead Growth', recommended: '+45%', optimized: '+27%' },
      { metric: 'Expected Sales Growth', recommended: '+23%', optimized: '+14%' },
    ],
    execution_plan: [],
    recommendations: [],
    errors: [],
  }
  return { RESULT, CONTEXTS }
})

vi.mock('#/lib/marketing-budget-planner', () => ({
  planBudget: vi.fn(async () => RESULT),
}))
vi.mock('#/lib/context-planner', () => ({
  listContexts: vi.fn(async () => CONTEXTS),
}))

// Imported after the mocks are registered.
import { BudgetPlannerPage } from './BudgetPlannerPage'

const ILLUSTRATIVE = [
  'Expected Timeline',
  'Estimated SEO Improvement',
  'Estimated AEO Improvement',
  'Expected Lead Growth',
  'Expected Sales Growth',
]
const EXACT = ['Monthly Budget', 'Activities Included', 'Activities Removed']

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <BudgetPlannerPage />
    </QueryClientProvider>,
  )
}

async function generatePlan() {
  renderPage()
  const btn = await screen.findByRole('button', { name: /generate plan/i })
  // Enabled only after listContexts resolves and the effect selects the context.
  await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(btn)
  await screen.findByText('Recommended vs your budget')
}

function rowOf(metric: string): HTMLElement {
  const cell = screen.getByText(metric)
  const tr = cell.closest('tr')
  if (!tr) throw new Error(`no row for ${metric}`)
  return tr as HTMLElement
}

describe('BudgetPlannerPage comparison table', () => {
  it('badges exactly the 5 illustrative rows and none of the exact rows', async () => {
    await generatePlan()

    // One "Illustrative" badge per projection row, none elsewhere.
    expect(screen.getAllByText('Illustrative')).toHaveLength(5)

    for (const metric of ILLUSTRATIVE) {
      expect(within(rowOf(metric)).queryByText('Illustrative')).not.toBeNull()
    }
    for (const metric of EXACT) {
      expect(within(rowOf(metric)).queryByText('Illustrative')).toBeNull()
    }
  })

  it('attaches the directional-estimate tooltip to each illustrative metric', async () => {
    await generatePlan()

    for (const metric of ILLUSTRATIVE) {
      const tip = rowOf(metric).querySelector('span[title]') as HTMLElement | null
      expect(tip).not.toBeNull()
      expect(tip!.getAttribute('title')).toMatch(/directional estimate/i)
    }
    // Exact rows carry no tooltip.
    for (const metric of EXACT) {
      expect(rowOf(metric).querySelector('span[title]')).toBeNull()
    }
  })
})

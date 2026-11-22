import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ReviewError from './ReviewError'

describe('ReviewError', () => {
  it('announces that the review failed and that no files changed', () => {
    render(<ReviewError onRetry={() => {}} />)

    expect(screen.getByRole('alert')).toHaveTextContent('The review could not be built. Your files were not changed.')
  })

  it('calls onRetry from the Try again button', async () => {
    const onRetry = vi.fn()
    render(<ReviewError onRetry={onRetry} />)

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

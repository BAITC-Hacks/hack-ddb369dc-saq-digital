import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('EKT Match interface', () => {
  it('does not open the confirmation dialog for an empty query', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Найти позицию' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Опишите товар')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

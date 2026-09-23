import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'

afterEach(cleanup)

describe('EKT Match interface', () => {
  it('does not open the confirmation dialog for an empty query', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Найти позицию' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Опишите товар')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('adds a product only after an explicit confirmation', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Запустить demo-запрос' }))
    const choices = await screen.findAllByRole('button', { name: 'Выбрать позицию' })
    fireEvent.click(choices[1])

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Корзина пуста')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить в корзину EKT' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Корзина EKT.kz' })).toHaveTextContent('SafeLine')
  })

  it('does not allow selecting an unavailable exact product', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Запустить demo-запрос' }))
    const choices = await screen.findAllByRole('button', { name: 'Выбрать позицию' })

    expect(choices[0]).toBeDisabled()
    expect(choices[1]).toBeEnabled()
  })

  it('answers a purchase-terms question without offering products', async () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Технический запрос'), { target: { value: 'Какие условия доставки и оплаты?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Найти позицию' }))

    expect(await screen.findByText(/доступен самовывоз/i)).toBeInTheDocument()
    expect(screen.getByText(/Для точного расчёта доставки/i)).toBeInTheDocument()
  })
})

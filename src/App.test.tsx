import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
afterEach(cleanup)

describe('EKT embedded assistant', () => {
  it('appears as a chat widget over the catalogue page', () => { render(<App />); expect(screen.getByRole('dialog', { name: 'Чат с помощником EKT' })).toBeInTheDocument(); expect(screen.getByRole('heading', { name: 'Автоматические выключатели' })).toBeInTheDocument() })
  it('blocks unavailable goods and requires confirmation before adding an alternative', async () => { render(<App />); fireEvent.click(screen.getByRole('button', { name: 'Demo' })); const choices = await screen.findAllByRole('button', { name: /Выбрать|Недоступно/ }); expect(choices[0]).toBeDisabled(); fireEvent.click(choices[1]); expect(screen.getByRole('dialog', { name: 'Добавить товар в корзину?' })).toBeInTheDocument(); expect(screen.getByRole('link', { name: /Корзина 0/ })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' })); expect(screen.getByText('Товар добавлен в корзину.')).toBeInTheDocument(); expect(screen.getByRole('link', { name: 'Перейти к оформлению' })).toHaveAttribute('href', 'https://ekt.kz/personal/cart/') })
  it('answers purchase-terms questions in the chat', async () => { render(<App />); fireEvent.change(screen.getByLabelText('Сообщение помощнику EKT'), { target: { value: 'Какие условия доставки и оплаты?' } }); fireEvent.click(screen.getByRole('button', { name: 'Отправить' })); expect(await screen.findByText(/доступен самовывоз/i)).toBeInTheDocument() })
})

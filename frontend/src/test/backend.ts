import type { Server } from 'node:http'
import { once } from 'node:events'
import { createApp } from '../../../backend/src/app.js'
import { validateCatalog } from '../../../backend/src/catalog.js'
import catalog from '../../../data/catalog.json'
import purchaseTerms from '../../../backend/purchase-terms.json'

export async function startBackend() {
  const server = createApp(validateCatalog(catalog), { cartUrl: '/cart', purchaseTerms }).listen(0, '127.0.0.1') as Server
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
      server.closeAllConnections()
    }),
  }
}
